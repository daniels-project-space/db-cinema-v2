import { encoreGate } from "./lib/loyalty";
import { customerReviewGate, reviewSettlementFingerprint } from "./lib/reviewEligibility";
import { reviewContext } from "./lib/reviewContext";
import { internalMutation, internalQuery } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { queueOwnerNotification } from "./lib/adminPush";
import { accountForRental } from "./lib/rentalAccount";
import { handoverScheduleFingerprint, pickupScheduleFingerprint } from "./lib/rentalEmailQueue";
const LEASE_MS=10*60_000, MAX_ATTEMPTS=8;

async function current(ctx: QueryCtx | MutationCtx, row: Doc<"rental_email_deliveries">) {
  const b=await ctx.db.get(row.bookingId); if(!b)return false;
  const account=await accountForRental(ctx,b);
  const recipient=account?.email ?? (b.accountId ? null : b.guestEmail);
  if(!recipient || (row.recipientEmail && row.recipientEmail!==recipient)) return false;
  if(row.kind==="paid_verification"||row.kind==="verification_reminder")return b.status==="pending_verification"&&!!b.checkoutPaidAt&&b.idVerifyStatus!=="verified"&&!b.cancellationDecision&&!b.returnDecision&&account?.blockedAt==null;
  if(row.kind === "cancellation_choice"){
    const offer=b.cancellationDecision?.operatorOfferId?await ctx.db.get(b.cancellationDecision.operatorOfferId):null;
    return !!offer&&offer.emailDeliveryId===row._id&&offer.state==="email_pending"&&account?.blockedAt==null&&offer.recipientEmail===recipient&&Date.now()<(offer.choiceDeadline??0);
  }
  if(row.kind === "review"){
    if(b.remindedReview || b.reviewFollowUpStatus==="sent")return false;
    if(customerReviewGate(b) || b.reviewEligibilityFingerprint!==reviewSettlementFingerprint(await reviewContext(ctx,b)))return false;
    if(row.preparedPromotional && !account?.marketingEmails || row.preparedCleanReturnRequired && encoreGate(b))return false;
    return !await ctx.db.query("reviews").withIndex("by_booking",q=>q.eq("verifiedBookingId",b._id)).first();
  }
  if(row.kind === "cancellation")return b.status === "cancelled";
  if(row.kind === "time_change") {
    const latest=(await ctx.db.query("rental_email_deliveries").withIndex("by_booking_kind",q=>q.eq("bookingId",b._id).eq("kind","time_change")).order("desc").take(1))[0];
    return latest?._id===row._id && ["confirmed","active"].includes(b.status) && !!row.changeSchedule && (row.changeSchedule===handoverScheduleFingerprint(b) || row.changeSchedule===pickupScheduleFingerprint(b));
  }
  if(row.kind === "verification") {
    const latest=(await ctx.db.query("rental_email_deliveries").withIndex("by_booking_kind",q=>q.eq("bookingId",b._id).eq("kind","verification")).order("desc").take(1))[0];
    const pendingResolution=b.status==="pending_verification"&&!!b.checkoutPaidAt&&row.verificationStatus!=="verified";
    return latest?._id===row._id && b.idVerifyStatus === row.verificationStatus && (["confirmed","active"].includes(b.status)||pendingResolution) && (!row.verificationSchedule || row.verificationSchedule===pickupScheduleFingerprint(b));
  }
  if(row.kind === "payment")return ["confirmed","active"].includes(b.status);
  // A payment receipt remains useful after a paid rental is returned/cancelled.
  return ["confirmed","active","returned","cancelled"].includes(b.status) && !!(b.stripePaymentIntentId || b.total === 0);
}
async function markReviewState(ctx:MutationCtx,bookingId:Id<"bookings">,patch:any){
 const booking=await ctx.db.get(bookingId);
 if(booking && booking.reviewFollowUpStatus!=="sent")await ctx.db.patch(bookingId,patch);
}
async function flagFailure(ctx:MutationCtx,row:Doc<"rental_email_deliveries">) {
 const booking=await ctx.db.get(row.bookingId),account=await accountForRental(ctx,booking);
 await queueOwnerNotification(ctx,{eventKey:`rental-email-failed:${row._id}`,kind:"email_failure",...(account?{accountId:account._id}:{}),bookingId:row.bookingId,
  title:"Booking email needs attention",body:`The ${row.kind} notice could not be sent after ${row.attempts} attempts. Open this rental to follow up with the renter.`});
}
async function dispatch(ctx:MutationCtx,id:Id<"rental_email_deliveries">) {
  const row=await ctx.db.get(id),now=Date.now();
  if(!row || !["pending","sending"].includes(row.state) || row.dueAt>now)return false;
  if(!await current(ctx,row)){await ctx.db.patch(id,{state:"skipped",updatedAt:now,lastError:"Notice no longer applicable"});if(row.kind==="review")await markReviewState(ctx,row.bookingId,{reviewFollowUpStatus:"suppressed",remindedReview:true,reviewFollowUpReason:"notice_no_longer_applicable"});return false;}
  if(row.attempts>=MAX_ATTEMPTS){await ctx.db.patch(id,{state:"failed",updatedAt:now,lastError:"Delivery attempts exhausted; requires support"});await flagFailure(ctx,row);if(row.kind==="review")await markReviewState(ctx,row.bookingId,{reviewFollowUpStatus:"failed",reviewFollowUpReason:"email_failed"});return false;}
  const generation=row.generation+1;
  await ctx.db.patch(id,{state:"sending",attempts:row.attempts+1,generation,dueAt:now+LEASE_MS,updatedAt:now});
  await ctx.scheduler.runAfter(0,internal.rentalEmailMail.deliver,{deliveryId:id,generation});return true;
}
export const dispatchOne=internalMutation({args:{deliveryId:v.id("rental_email_deliveries")},handler:async(ctx,a)=>dispatch(ctx,a.deliveryId)});
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
export const finish=internalMutation({args:{deliveryId:v.id("rental_email_deliveries"),generation:v.number(),result:v.union(v.literal("sent"),v.literal("retry"),v.literal("skipped")),providerMessageId:v.optional(v.string())},handler:async(ctx,a)=>{
  const row=await ctx.db.get(a.deliveryId);
  if(!row || row.state!=="sending" || row.generation!==a.generation || row.dueAt<=Date.now())return false;
  const now=Date.now(),failed=a.result==="retry" && row.attempts>=MAX_ATTEMPTS;
  await ctx.db.patch(row._id,{state:a.result==="retry"?(failed?"failed":"pending"):a.result,
    updatedAt:now,sentAt:a.result==="sent"?now:undefined,
    dueAt:a.result==="retry"?now+Math.min(6*60,2**(row.attempts-1))*60_000:now,
    ...(a.result==="sent"&&a.providerMessageId?{providerMessageId:a.providerMessageId,providerDeliveryStatus:"accepted",providerCheckDueAt:now+2*60_000,providerCheckGeneration:0}:{}),
    lastError:a.result==="retry"?(failed?"Delivery attempts exhausted; requires support":"Transport did not accept email"):undefined});
  if(row.kind==="review")await markReviewState(ctx,row.bookingId,{reviewFollowUpStatus:a.result==="sent"?"sent":a.result==="skipped"?"suppressed":failed?"failed":"sending",
    remindedReview:a.result==="sent"||a.result==="skipped",reviewFollowUpSentAt:a.result==="sent"?now:undefined,
    reviewFollowUpReason:a.result==="retry"?(failed?"email_failed":"email_retry"):a.result==="skipped"?"notice_no_longer_applicable":undefined});
  if(a.result === "sent") {
    const booking = await ctx.db.get(row.bookingId), account = await accountForRental(ctx, booking);
    await queueOwnerNotification(ctx, {eventKey:`rental-email-sent:${row._id}`,kind:"email_sent",...(account?{accountId:account._id}:{}),bookingId:row.bookingId,title:"Booking email sent",body:`The ${row.kind} email was accepted for delivery. This does not confirm that it was read.`});
  }
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
export const recordProviderStatus=internalMutation({args:{deliveryId:v.id("rental_email_deliveries"),generation:v.number(),status:v.string()},handler:async(ctx,a)=>{
 const row=await ctx.db.get(a.deliveryId),now=Date.now();
 if(!row||row.state!=="sent"||row.providerCheckGeneration!==a.generation||!row.providerMessageId||row.providerCheckDueAt===undefined)return false;
 const failed=["bounced","suppressed","failed","complained"].includes(a.status);
 const delivered=["delivered","opened","clicked"].includes(a.status)||row.providerDeliveryStatus==="delivered";
 const expired=now-(row.sentAt??now)>=24*60*60_000;
 const done=failed||expired,notify=failed||(!delivered&&expired)||(delivered&&row.providerDeliveryStatus!=="delivered");
 await ctx.db.patch(row._id,{providerDeliveryStatus:failed?a.status:delivered?"delivered":expired?"unconfirmed":"accepted",providerCheckDueAt:done?undefined:now+(delivered?60:15)*60_000,updatedAt:now});
 if(notify){
  const booking=await ctx.db.get(row.bookingId),account=await accountForRental(ctx,booking);
  const failureDetail:Record<string,string>={bounced:"The recipient's mail server rejected the email.",suppressed:"The email provider blocked delivery because of an earlier problem with this address.",failed:"The email provider could not send the message.",complained:"The recipient marked the email as spam."};
  await queueOwnerNotification(ctx,{eventKey:`rental-email-provider:${row._id}:${failed?"failure":delivered?"delivered":"unconfirmed"}`,kind:failed||(expired&&!delivered)?"email_failure":"email_sent",...(account?{accountId:account._id}:{}),bookingId:row.bookingId,
   title:failed?"Booking email could not be delivered":expired&&!delivered?"Booking email delivery needs checking":"Booking email delivered",
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
