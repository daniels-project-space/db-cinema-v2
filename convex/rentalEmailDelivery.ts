import { encoreGate } from "./lib/loyalty";
import { customerReviewGate, reviewFollowUpDueAt, reviewSettlementFingerprint } from "./lib/reviewEligibility";
import { reviewContext } from "./lib/reviewContext";
import { internalMutation, internalQuery } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { queueOwnerNotification } from "./lib/adminPush";
import { accountForRental } from "./lib/rentalAccount";
import { renterRentalActionReady } from "./lib/renterRentalActionGate";
import { bookingVerificationExpired, verificationWindowClosed } from "../shared/verificationProgress";
import { handoverScheduleFingerprint, pickupScheduleFingerprint, queueRentalEmail } from "./lib/rentalEmailQueue";
import { findReviewInvitationMessage } from "./lib/reviewInvitationState";
const LEASE_MS=10*60_000, MAX_ATTEMPTS=8;

function reminderDue(booking:any,kind:"pickup_reminder"|"return_reminder",now=Date.now()) {
  if(!booking || !["confirmed","active"].includes(booking.status) || !Array.isArray(booking.lineItems) || !booking.lineItems.length) return false;
  if(booking.status==="confirmed" && booking.idVerifyStatus!=="verified") return false;
  const start=Math.min(...booking.lineItems.map((line:any)=>line.start));
  const end=Math.max(...booking.lineItems.map((line:any)=>line.end));
  const date=(value:number)=>new Date(value).toISOString().slice(0,10);
  if(kind==="pickup_reminder") return !booking.remindedPickup && date(start)===date(now+86_400_000);
  return !booking.remindedReturn && date(end)===date(now);
}

async function current(ctx: QueryCtx | MutationCtx, row: Doc<"rental_email_deliveries">) {
  const b=await ctx.db.get(row.bookingId); if(!b)return false;
  const account=await accountForRental(ctx,b);
  const recipient=account?.email ?? (b.accountId ? null : b.guestEmail);
  if(!recipient || (row.recipientEmail && row.recipientEmail!==recipient)) return false;
  if(row.kind === "pickup_reminder" || row.kind === "return_reminder") return reminderDue(b,row.kind);
  if(row.kind === "paid_verification" || row.kind === "verification_reminder")
    return b.status === "pending_verification" && !!b.checkoutPaidAt && b.idVerifyStatus !== "verified" && b.idVerifyStatus !== "rejected" && !b.cancellationDecision && !b.returnDecision && !verificationWindowClosed(b) && account?.blockedAt == null;
  // Legacy payment/receipt jobs could say verification was still pending and
  // send a second invoice after approval. Only allow a legacy job when its
  // booking is already fully ready and no canonical approval email exists.
  if(row.kind === "payment" || row.kind === "receipt") {
    if(!renterRentalActionReady(b) || b.idVerifyStatus!=="verified" || bookingVerificationExpired(b)) return false;
    const approval=(await ctx.db.query("rental_email_deliveries")
      .withIndex("by_booking_kind",q=>q.eq("bookingId",b._id).eq("kind","verification"))
      .order("desc").take(1))[0];
    return !approval;
  }
  if(row.kind === "cancellation_choice"){
    const offer=b.cancellationDecision?.operatorOfferId?await ctx.db.get(b.cancellationDecision.operatorOfferId):null;
    return !!offer&&offer.emailDeliveryId===row._id&&offer.state==="email_pending"&&account?.blockedAt==null&&offer.recipientEmail===recipient&&Date.now()<(offer.choiceDeadline??0);
  }
  if(row.kind === "review"){
    // Account renters receive one canonical invitation in their rental chat.
    // A delayed or retried legacy email job must not send a second request.
    if(b.reviewInvitationMessageId)return false;
    if(b.remindedReview || b.reviewFollowUpStatus==="sent")return false;
    if(b.reviewFollowUpStatus==="failed")return false;
    if(await findReviewInvitationMessage(ctx,b))return false;
    if(Date.now()<reviewFollowUpDueAt(b))return false;
    const context=await reviewContext(ctx,b);
    if(customerReviewGate(context) || b.reviewEligibilityFingerprint!==reviewSettlementFingerprint(context))return false;
    if(row.preparedPromotional && !account?.marketingEmails || row.preparedCleanReturnRequired && encoreGate(b))return false;
    return !await ctx.db.query("reviews").withIndex("by_booking",q=>q.eq("verifiedBookingId",b._id)).first();
  }
  if(row.kind === "cancellation")return b.status === "cancelled";
  if(row.kind === "time_change") {
    const latest=(await ctx.db.query("rental_email_deliveries").withIndex("by_booking_kind",q=>q.eq("bookingId",b._id).eq("kind","time_change")).order("desc").take(1))[0];
    return latest?._id===row._id && ["confirmed","active"].includes(b.status) && !!row.changeSchedule && (row.changeSchedule===handoverScheduleFingerprint(b) || row.changeSchedule===pickupScheduleFingerprint(b));
  }
  if(row.kind === "refund_invoice") {
    if(!row.refundId || !["confirmed","active","returned","cancelled"].includes(b.status) || !(b.stripePaymentIntentId || b.total===0))return false;
    const refund=await ctx.db.get(row.refundId);
    if(!refund || refund.bookingId!==b._id || refund.status!=="succeeded" || refund.refundAmbiguity || refund.requestId.startsWith("swap-"))return false;
    const hasProviderReceipt=!!refund.stripeRefundId || Array.isArray(refund.allocations) && refund.allocations.length>0 && Array.isArray(refund.parts) && refund.parts.length===refund.allocations.length && refund.parts.every((part:any)=>part.status==="succeeded"&&!!part.stripeRefundId);
    if(!hasProviderReceipt || (!refund.expectedAccountId && refund.expectedRecipientEmail===undefined))return false;
    if(refund.expectedAccountId && account?._id!==refund.expectedAccountId)return false;
    if(refund.expectedRecipientEmail!==undefined && recipient.trim().toLowerCase()!==refund.expectedRecipientEmail)return false;
    return true;
  }
  if(row.kind === "verification") {
    const latest=(await ctx.db.query("rental_email_deliveries").withIndex("by_booking_kind",q=>q.eq("bookingId",b._id).eq("kind","verification")).order("desc").take(1))[0];
    const pendingResolution=b.status==="pending_verification"&&!!b.checkoutPaidAt&&row.verificationStatus!=="verified"&&!verificationWindowClosed(b);
    return latest?._id===row._id && b.idVerifyStatus === row.verificationStatus && (["confirmed","active"].includes(b.status)||pendingResolution) && (!row.verificationSchedule || row.verificationSchedule===pickupScheduleFingerprint(b));
  }
  // A payment receipt remains useful after a paid rental is returned/cancelled.
  return ["confirmed","active","returned","cancelled"].includes(b.status) && !!(b.stripePaymentIntentId || b.total === 0);
}
async function markReviewState(ctx:MutationCtx,bookingId:Id<"bookings">,patch:any){
 const booking=await ctx.db.get(bookingId);
 if(booking && booking.reviewFollowUpStatus!=="sent")await ctx.db.patch(bookingId,patch);
}
async function deferReviewIfNotDue(ctx:MutationCtx,row:Doc<"rental_email_deliveries">,now=Date.now()){
 if(row.kind!=="review")return false;
 const booking=await ctx.db.get(row.bookingId);
 if(!booking||booking.remindedReview||booking.reviewInvitationMessageId||["sent","failed","suppressed"].includes(booking.reviewFollowUpStatus??""))return false;
 const dueAt=reviewFollowUpDueAt(booking,now);
 if(now>=dueAt)return false;
 await ctx.db.patch(row._id,{state:"pending",dueAt,updatedAt:now,lastError:"Review follow-up deferred to the current return deadline"});
 await markReviewState(ctx,row.bookingId,{reviewFollowUpStatus:"waiting",reviewFollowUpReason:"review_not_due",reviewFollowUpCheckedAt:now,reviewFollowUpDueAt:dueAt});
 return true;
}
async function flagFailure(ctx:MutationCtx,row:Doc<"rental_email_deliveries">) {
 const booking=await ctx.db.get(row.bookingId),account=await accountForRental(ctx,booking);
 await queueOwnerNotification(ctx,{eventKey:`rental-email-failed:${row._id}`,kind:"email_failure",...(account?{accountId:account._id}:{}),bookingId:row.bookingId,
  title:"Booking email needs attention",body:`The ${row.kind} notice could not be sent after ${row.attempts} attempts. Open this rental to follow up with the renter.`});
}
async function flagUncertain(ctx:MutationCtx,row:Doc<"rental_email_deliveries">) {
 const booking=await ctx.db.get(row.bookingId),account=await accountForRental(ctx,booking);
 await queueOwnerNotification(ctx,{eventKey:`rental-email-uncertain:${row._id}`,kind:"email_failure",...(account?{accountId:account._id}:{}),bookingId:row.bookingId,
  title:"Booking email delivery needs checking",body:`The ${row.kind} email may have reached the renter. It is paused to avoid a duplicate; check its email thread before sending anything again.`});
}
async function flagRefundContactChange(ctx:MutationCtx,row:Doc<"rental_email_deliveries">) {
 if(row.kind!=="refund_invoice"||!row.refundId)return;
 const refund=await ctx.db.get(row.refundId),booking=await ctx.db.get(row.bookingId);
 if(!refund||refund.bookingId!==row.bookingId||!booking)return;
 const account=await accountForRental(ctx,booking),email=account?.email??(booking.accountId?null:booking.guestEmail);
 const changed=(!refund.expectedAccountId&&refund.expectedRecipientEmail===undefined)||
   (!!refund.expectedAccountId&&account?._id!==refund.expectedAccountId)||
   (refund.expectedRecipientEmail!==undefined&&(!email||email.trim().toLowerCase()!==refund.expectedRecipientEmail));
 if(changed)await queueOwnerNotification(ctx,{eventKey:`refund-email-contact-changed:${refund._id}`,kind:"checkout_failure",bookingId:booking._id,title:"Refund invoice needs review",body:"The original renter contact changed before the updated invoice could be delivered. Check the payment and contact before notifying the renter."});
}
async function dispatch(ctx:MutationCtx,id:Id<"rental_email_deliveries">) {
  const row=await ctx.db.get(id),now=Date.now();
  if(!row || !["pending","sending"].includes(row.state) || row.dueAt>now)return false;
  if(await deferReviewIfNotDue(ctx,row,now))return false;
  if(!await current(ctx,row)){await ctx.db.patch(id,{state:"skipped",updatedAt:now,lastError:"Notice no longer applicable"});await flagRefundContactChange(ctx,row);if(row.kind==="review")await markReviewState(ctx,row.bookingId,{reviewFollowUpStatus:"suppressed",remindedReview:true,reviewFollowUpReason:"notice_no_longer_applicable"});return false;}
  if(row.attempts>=MAX_ATTEMPTS){await ctx.db.patch(id,{state:"failed",updatedAt:now,lastError:"Delivery attempts exhausted; requires support"});await flagFailure(ctx,row);if(row.kind==="review")await markReviewState(ctx,row.bookingId,{reviewFollowUpStatus:"failed",reviewFollowUpReason:"email_failed"});return false;}
  const generation=row.generation+1;
  await ctx.db.patch(id,{state:"sending",attempts:row.attempts+1,generation,dueAt:now+LEASE_MS,updatedAt:now});
  await ctx.scheduler.runAfter(0,internal.rentalEmailMail.deliver,{deliveryId:id,generation});return true;
}
export const dispatchOne=internalMutation({args:{deliveryId:v.id("rental_email_deliveries")},handler:async(ctx,a)=>dispatch(ctx,a.deliveryId)});
export const queueReminder=internalMutation({args:{bookingId:v.id("bookings"),kind:v.union(v.literal("pickup_reminder"),v.literal("return_reminder"))},handler:async(ctx,{bookingId,kind})=>{
 const booking=await ctx.db.get(bookingId),account=await accountForRental(ctx,booking);
 const recipient=account?.email??(booking?.accountId?null:booking?.guestEmail);
 if(!reminderDue(booking,kind)||!recipient||!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(recipient))return {queued:false as const};
 const priorRows=await ctx.db.query("rental_email_deliveries").withIndex("by_booking_kind",q=>q.eq("bookingId",bookingId).eq("kind",kind)).order("desc").take(1),prior=priorRows[0];
 if(prior && prior.state!=="skipped")return {queued:false as const,deliveryId:prior._id};
 const deliveryId=await queueRentalEmail(ctx,bookingId,kind);
 return {queued:true as const,deliveryId};
}});
export const dispatchDue=internalMutation({args:{},handler:async ctx=>{
  let dispatched=0;
  for(const state of ["pending","sending"] as const){
    const rows=await ctx.db.query("rental_email_deliveries").withIndex("by_state_due",q=>q.eq("state",state).lte("dueAt",Date.now())).take(20);
    for(const row of rows)if(await dispatch(ctx,row._id))dispatched++;
  }return {dispatched};
}});
export const ready=internalQuery({args:{deliveryId:v.id("rental_email_deliveries"),generation:v.number()},handler:async(ctx,a)=>{
  const row=await ctx.db.get(a.deliveryId);
  return row && row.state === "sending" && row.generation===a.generation && row.dueAt>Date.now() && await current(ctx,row) ? row : null;
}});
export const deferReviewIfNotDueForDelivery=internalMutation({args:{deliveryId:v.id("rental_email_deliveries"),generation:v.number()},handler:async(ctx,a)=>{
 const row=await ctx.db.get(a.deliveryId);
 if(!row||row.state!=="sending"||row.generation!==a.generation)return false;
 return deferReviewIfNotDue(ctx,row);
}});
export const finish=internalMutation({args:{deliveryId:v.id("rental_email_deliveries"),generation:v.number(),result:v.union(v.literal("sent"),v.literal("retry"),v.literal("skipped"),v.literal("uncertain")),providerMessageId:v.optional(v.string())},handler:async(ctx,a)=>{
  const row=await ctx.db.get(a.deliveryId);
  if(!row || row.state!=="sending" || row.generation!==a.generation || row.dueAt<=Date.now())return false;
  const now=Date.now(),failed=a.result==="retry" && row.attempts>=MAX_ATTEMPTS;
  await ctx.db.patch(row._id,{state:a.result==="retry"?(failed?"failed":"pending"):a.result,
    updatedAt:now,sentAt:a.result==="sent"?now:undefined,
    dueAt:a.result==="retry"?now+Math.min(6*60,2**(row.attempts-1))*60_000:now,
    ...(a.result==="sent"&&a.providerMessageId?{providerMessageId:a.providerMessageId,providerDeliveryStatus:"accepted",providerCheckDueAt:now+2*60_000,providerCheckGeneration:0}:{}),
    lastError:a.result==="retry"?(failed?"Delivery attempts exhausted; requires support":"Transport did not accept email"):a.result==="uncertain"?"Provider may have accepted this email; check delivery before retrying.":undefined});
  if(row.kind==="review")await markReviewState(ctx,row.bookingId,{reviewFollowUpStatus:a.result==="sent"?"sent":a.result==="skipped"?"suppressed":a.result==="uncertain"||failed?"failed":"sending",
    remindedReview:a.result==="sent"||a.result==="skipped",reviewFollowUpSentAt:a.result==="sent"?now:undefined,
    reviewFollowUpReason:a.result==="retry"?(failed?"email_failed":"email_retry"):a.result==="uncertain"?"delivery_uncertain":a.result==="skipped"?"notice_no_longer_applicable":undefined});
  if(a.result==="sent" && row.kind==="pickup_reminder")await ctx.db.patch(row.bookingId,{remindedPickup:true});
  if(a.result==="sent" && row.kind==="return_reminder")await ctx.db.patch(row.bookingId,{remindedReturn:true});
  if(a.result==="skipped")await flagRefundContactChange(ctx,row);
  if(a.result === "sent" && row.kind !== "review") {
    const booking = await ctx.db.get(row.bookingId), account = await accountForRental(ctx, booking);
    await queueOwnerNotification(ctx, {eventKey:`rental-email-sent:${row._id}`,kind:"email_sent",...(account?{accountId:account._id}:{}),bookingId:row.bookingId,title:"Booking email accepted",body:`${row.kind} email accepted; inbox delivery isn’t confirmed.`});
  }
  if(a.result==="uncertain")await flagUncertain(ctx,row);
  if(failed)await flagFailure(ctx,row);
  return true;
}});

/** Lease provider checks so a transient action failure is recovered by cron. */
export const checkProviderDue=internalMutation({args:{},handler:async ctx=>{
 const now=Date.now();
 const rows=await ctx.db.query("rental_email_deliveries").withIndex("by_provider_check",q=>q.eq("state","sent").gte("providerCheckDueAt",0).lte("providerCheckDueAt",now)).take(20);
 for(const row of rows){
  if(!row.providerMessageId)continue;
  const generation=(row.providerCheckGeneration??0)+1;
  await ctx.db.patch(row._id,{providerCheckGeneration:generation,providerCheckDueAt:now+10*60_000});
  await ctx.scheduler.runAfter(0,internal.rentalEmailMail.checkProvider,{deliveryId:row._id,generation});
 }
 return rows.length;
}});
export const providerCheckContext=internalQuery({args:{deliveryId:v.id("rental_email_deliveries"),generation:v.number()},handler:async(ctx,a)=>{
 const row=await ctx.db.get(a.deliveryId);
 return row?.state==="sent"&&row.providerCheckGeneration===a.generation&&row.providerMessageId?{providerMessageId:row.providerMessageId}:null;
}});
export const recordProviderStatus=internalMutation({args:{deliveryId:v.id("rental_email_deliveries"),generation:v.number(),status:v.string(),messageId:v.optional(v.string())},handler:async(ctx,a)=>{
 const row=await ctx.db.get(a.deliveryId),now=Date.now();
 if(!row||row.state!=="sent"||row.providerCheckGeneration!==a.generation||!row.providerMessageId||row.providerCheckDueAt===undefined)return false;
 const failed=["bounced","suppressed","failed","complained"].includes(a.status);
 const delivered=["delivered","opened","clicked"].includes(a.status)||row.providerDeliveryStatus==="delivered";
 const expired=now-(row.sentAt??now)>=24*60*60_000;
 const done=failed||expired,notify=failed||(!delivered&&expired)||(delivered&&row.providerDeliveryStatus!=="delivered");
 await ctx.db.patch(row._id,{providerDeliveryStatus:failed?a.status:delivered?"delivered":expired?"unconfirmed":"accepted",providerCheckDueAt:done?undefined:now+(delivered?60:15)*60_000,...(a.messageId?{providerRfcMessageId:a.messageId}:{}),updatedAt:now});
 if(a.messageId){
  const mirrored=await ctx.db.query("email_messages").withIndex("by_provider",q=>q.eq("providerId",`rental-email:${row._id}`)).first();
  if(mirrored&&!mirrored.messageId)await ctx.db.patch(mirrored._id,{messageId:a.messageId});
 }
 if(notify){
  const booking=await ctx.db.get(row.bookingId),account=await accountForRental(ctx,booking);
  const failureDetail:Record<string,string>={bounced:"The recipient's mail server rejected the email.",suppressed:"The email provider blocked delivery because of an earlier problem with this address.",failed:"The email provider could not send the message.",complained:"The recipient marked the email as spam."};
  await queueOwnerNotification(ctx,{eventKey:`rental-email-provider:${row._id}:${failed?"failure":delivered?"delivered":"unconfirmed"}`,kind:failed||(expired&&!delivered)?"email_failure":"email_sent",...(account?{accountId:account._id}:{}),bookingId:row.bookingId,
   title:a.status==="complained"?"Booking email marked as spam":failed?"Booking email could not be delivered":expired&&!delivered?"Booking email delivery needs checking":"Booking email delivered",
   body:failed?`${failureDetail[a.status]} Open this rental and contact the renter another way.`:expired&&!delivered?"The provider accepted the email, but delivery could not be confirmed. Check before relying on it.":"The recipient's mail server accepted the booking email. This does not confirm it was read."});
 }
 return true;
}});

/** Attach the immutable prepared message before any provider send. */
export const prepare=internalMutation({args:{deliveryId:v.id("rental_email_deliveries"),generation:v.number(),storageId:v.id("_storage"),recipientEmail:v.string(),promotional:v.optional(v.boolean()),cleanReturnRequired:v.optional(v.boolean())},handler:async(ctx,a)=>{
 const row=await ctx.db.get(a.deliveryId);
 if(!row || row.state!=="sending" || row.generation!==a.generation || row.dueAt<=Date.now() || !await current(ctx,row))return null;
 const booking=await ctx.db.get(row.bookingId),account=await accountForRental(ctx,booking);
 if(a.recipientEmail!==(account?.email ?? (booking?.accountId ? null : booking?.guestEmail)))return null;
 if(row.payloadStorageId)return row.payloadStorageId;
 await ctx.db.patch(row._id,{payloadStorageId:a.storageId,recipientEmail:a.recipientEmail,preparedPromotional:a.promotional,preparedCleanReturnRequired:a.cleanReturnRequired,updatedAt:Date.now()});return a.storageId;
}});
