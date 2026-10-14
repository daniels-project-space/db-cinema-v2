import {internalMutation,internalQuery,query,mutation} from "./_generated/server";
import {v,ConvexError} from "convex/values";
import {accountForRental} from "./lib/rentalAccount";
import {londonRentalInstant} from "../shared/rentalWindow";
import {OPERATOR_CANCEL_GRACE_MS,operatorCancellationOptions} from "../shared/operatorCancellationCredit";
import {queueRentalEmail} from "./lib/rentalEmailQueue";
import {queueRmv2Sync} from "./lib/rmv2SyncQueue";
import {queueOwnerNotification} from "./lib/adminPush";
import {assertAdmin,checkAdminToken} from "./adminAuth";
const DAY=86400000;
const money=v.object({cashRemainingPence:v.number(),securityRemainingPence:v.number(),spentCreditPence:v.number()});
export const ownerStatus=query({args:{token:v.string(),bookingId:v.id("bookings")},handler:async(ctx,a)=>{
 if(!checkAdminToken(a.token))throw Error("Unauthorized");
 const row=await ctx.db.query("operator_cancellation_offers").withIndex("by_booking",q=>q.eq("bookingId",a.bookingId)).unique();
 return row?{id:row._id,state:row.state,decisionAfter:row.decisionAfter,choiceDeadline:row.choiceDeadline??null,choice:row.choice??null}:null;
}});
export const resumeAdmin=mutation({args:{token:v.string(),offerId:v.id("operator_cancellation_offers"),confirmed:v.boolean()},handler:async(ctx,a)=>{
 await assertAdmin(ctx,a.token,"operatorCancellationState.resumeAdmin");if(!a.confirmed)throw Error("Confirm resuming this recorded cancellation first.");
 const row=await ctx.db.get(a.offerId),now=Date.now();if(!row||row.state!=="review")throw Error("This cancellation does not need manual recovery.");
 const account=await ctx.db.get(row.accountId),booking=await ctx.db.get(row.bookingId);
 if(!account||booking?.cancellationDecision?.operatorOfferId!==row._id)throw Error("The cancellation ownership changed.");
 if(row.choice)await ctx.db.patch(row._id,{state:"chosen",dueAt:now,leaseUntil:0,attempts:0,lastError:undefined,updatedAt:now});
 else await ctx.db.patch(row._id,{state:"waiting",recipientEmail:account.email,choiceDeadline:undefined,emailDeliveryId:undefined,cashRemainingPence:undefined,securityRemainingPence:undefined,spentCreditPence:undefined,dueAt:Math.max(now,row.decisionAfter),leaseUntil:0,attempts:0,lastError:undefined,updatedAt:now});
 return {state:row.choice?"chosen":"waiting"};
}});
export const begin=internalMutation({args:{bookingId:v.id("bookings"),reason:v.string()},handler:async(ctx,a)=>{
 const prior=await ctx.db.query("operator_cancellation_offers").withIndex("by_booking",q=>q.eq("bookingId",a.bookingId)).unique();if(prior)return prior;
 if(process.env.CANCELLATION_PROTECTION_POLICY_ENABLED!=="true")throw Error("Cancellation protection is not enabled.");
 const b=await ctx.db.get(a.bookingId),account=await accountForRental(ctx,b),now=Date.now();
 if(!b||b.status!=="confirmed"||!account||!b.lineItems.length||b.pickedUpAt)throw Error("A paid, unstarted direct rental with a permanent account is required.");
 if((b.currency??"GBP").toUpperCase()!=="GBP"||!b.stripePaymentIntentId&&b.total>0)throw Error("The original GBP rental payment needs review.");
 const reservations=await ctx.db.query("reservations").withIndex("by_booking",q=>q.eq("bookingId",b._id)).take(501);
 if(reservations.length>500||reservations.some(r=>r.source!=="site"))throw Error("Only direct website rental stock can be cancelled here.");
 if(b.cancellationDecision||b.returnDecision||b.activeAdditionId||b.activeExtensionId||b.activePriceAdjustmentId||["starting","processing"].includes(b.depositHoldRenewalStatus??""))throw Error("Finish the active rental operation first.");
 const pickupAt=Math.min(...b.lineItems.map(line=>londonRentalInstant(line.start,line.pickupTime??b.pickupTime??"00:00")));
 if(pickupAt<=now)throw Error("The rental has already reached its pickup time.");
 const refunds=await ctx.db.query("rental_refunds").withIndex("by_booking",q=>q.eq("bookingId",b._id)).take(101);
 if(refunds.length>100||refunds.some(r=>["prepared","pending"].includes(r.status)))throw Error("Finish or review the existing refund first.");
 const id=await ctx.db.insert("operator_cancellation_offers",{bookingId:b._id,accountId:account._id,recipientEmail:account.email,reason:a.reason.trim().slice(0,400)||"Equipment unexpectedly unavailable",state:"waiting",cancelledAt:now,decisionAfter:now+OPERATOR_CANCEL_GRACE_MS,pickupAt,dueAt:now+OPERATOR_CANCEL_GRACE_MS,generation:0,attempts:0,leaseUntil:0,updatedAt:now});
 await ctx.db.patch(b._id,{status:"cancelled",cancelledAt:now,adminCancellationReason:a.reason.trim().slice(0,400),accountId:account._id,cancellationDecision:{kind:"full_refund",createdAt:now,operatorOfferId:id}});
 for(const r of reservations){if(r.status==="hold")await ctx.db.delete(r._id);else if(r.status!=="cancelled")await ctx.db.patch(r._id,{status:"cancelled"});}
 await queueOwnerNotification(ctx,{eventKey:`operator-cancel-start:${id}`,kind:"booking_cancelled",accountId:account._id,bookingId:b._id,title:"Rental cancelled · settlement waiting",body:"The one-hour account decision window has started. No refund or account credit has been issued."});
 await queueRmv2Sync(ctx,b._id);
 return ctx.db.get(id);
}});
export const byId=internalQuery({args:{offerId:v.id("operator_cancellation_offers")},handler:async(ctx,a)=>{
 const offer=await ctx.db.get(a.offerId);if(!offer)return null;const account=await ctx.db.get(offer.accountId),booking=await ctx.db.get(offer.bookingId);return {offer,account,booking};
}});
export const due=internalQuery({args:{},handler:async(ctx)=>ctx.db.query("operator_cancellation_offers").withIndex("by_due",q=>q.gt("dueAt",0).lte("dueAt",Date.now())).take(20)});
export const claim=internalMutation({args:{offerId:v.id("operator_cancellation_offers")},handler:async(ctx,a)=>{
 const row=await ctx.db.get(a.offerId),now=Date.now();if(!row||row.dueAt==null||row.dueAt>now||row.leaseUntil>now||["settled","review"].includes(row.state))return null;
 const generation=row.generation+1;await ctx.db.patch(row._id,{generation,attempts:row.attempts+1,leaseUntil:now+120000,dueAt:now+120000,updatedAt:now});return {...row,generation};
}});
export const prepare=internalMutation({args:{offerId:v.id("operator_cancellation_offers"),generation:v.number(),amounts:money},handler:async(ctx,a)=>{
 const row=await ctx.db.get(a.offerId),now=Date.now();if(!row||row.generation!==a.generation||row.leaseUntil<=now||row.state!=="waiting")return null;
 if(now<row.decisionAfter)throw Error("The one-hour decision window is still open.");
 operatorCancellationOptions(a.amounts);
 const b=await ctx.db.get(row.bookingId),account=await ctx.db.get(row.accountId);
 if(!account||!b||b.cancellationDecision?.operatorOfferId!==row._id)throw new ConvexError({code:"OPERATOR_CANCELLATION_REVIEW",message:"The cancellation account or rental changed."});
 if(account.blockedAt!=null){await ctx.db.patch(row._id,{...a.amounts,state:"chosen",choice:"refund",choiceAt:now,dueAt:now,leaseUntil:0,updatedAt:now});return {refundOnly:true};}
 if(account.email!==row.recipientEmail)throw new ConvexError({code:"OPERATOR_CANCELLATION_REVIEW",message:"The recipient changed. Review the account before sending the cancellation choice."});
 const emailDeliveryId=await queueRentalEmail(ctx,row.bookingId,"cancellation_choice");
 await ctx.db.patch(row._id,{...a.amounts,state:"email_pending",choiceDeadline:now+7*DAY,emailDeliveryId,dueAt:now+60000,attempts:0,leaseUntil:0,updatedAt:now});return {refundOnly:false};
}});
export const advance=internalMutation({args:{offerId:v.id("operator_cancellation_offers"),generation:v.number()},handler:async(ctx,a)=>{
 const row=await ctx.db.get(a.offerId),now=Date.now();if(!row||row.generation!==a.generation||row.leaseUntil<=now)return null;
 if(row.state!=="email_pending"&&row.state!=="offered")return null;
 const email=row.emailDeliveryId?await ctx.db.get(row.emailDeliveryId):null;
 if(email?.state==="sent"){
  if(now>=(row.choiceDeadline??Infinity))await ctx.db.patch(row._id,{state:"chosen",choice:"refund",choiceAt:now,dueAt:now,leaseUntil:0,updatedAt:now});
  else await ctx.db.patch(row._id,{state:"offered",dueAt:row.choiceDeadline,attempts:0,leaseUntil:0,updatedAt:now});
 }else if(!email||["failed","skipped"].includes(email.state)){
  await ctx.db.patch(row._id,{state:"review",dueAt:undefined,leaseUntil:0,lastError:"The choice email was not delivered. Review before settlement.",updatedAt:now});
  await queueOwnerNotification(ctx,{eventKey:`operator-cancel-email-review:${row._id}`,kind:"email_failure",accountId:row.accountId,bookingId:row.bookingId,title:"Cancellation choice needs attention",body:"The cancellation email was not accepted for delivery. No automatic refund or credit has been issued."});
 }else await ctx.db.patch(row._id,{dueAt:now+60000,leaseUntil:0,updatedAt:now});
 return ctx.db.get(row._id);
}});
export const choose=internalMutation({args:{offerId:v.id("operator_cancellation_offers"),choice:v.union(v.literal("refund"),v.literal("credit")),recipientEmail:v.string()},handler:async(ctx,a)=>{
 const row=await ctx.db.get(a.offerId),now=Date.now();if(!row||row.recipientEmail!==a.recipientEmail)throw Error("This cancellation link is invalid.");
 if(row.choice){if(row.choice!==a.choice)throw Error("A different settlement was already selected.");return row;}
 const account=await ctx.db.get(row.accountId),email=row.emailDeliveryId?await ctx.db.get(row.emailDeliveryId):null;
 if(!account||account.email!==row.recipientEmail||email?.state!=="sent"||!["email_pending","offered"].includes(row.state)||now>=(row.choiceDeadline??0))throw Error("This choice is not currently available. Contact the team.");
 if(a.choice==="credit"&&account.blockedAt!=null)throw Error("Only the original-payment refund is available for this account.");
 await ctx.db.patch(row._id,{state:"chosen",choice:a.choice,choiceAt:now,dueAt:now,leaseUntil:0,updatedAt:now});return ctx.db.get(row._id);
}});
export const finishAttempt=internalMutation({args:{offerId:v.id("operator_cancellation_offers"),generation:v.number(),complete:v.boolean(),review:v.optional(v.boolean())},handler:async(ctx,a)=>{
 const row=await ctx.db.get(a.offerId);if(!row||row.generation!==a.generation||row.state==="settled")return;
 const now=Date.now(),review=a.review||row.attempts>=8;
 await ctx.db.patch(row._id,{state:a.complete?"settled":review?"review":row.state,dueAt:a.complete||review?undefined:now+Math.min(30,2**Math.min(row.attempts,5))*60000,leaseUntil:0,updatedAt:now,lastError:review?"Cancellation settlement needs manual review; no repeated automatic execution.":undefined});
 if(review&&!a.complete){const job=await ctx.db.query("rental_cancellations").withIndex("by_booking",q=>q.eq("bookingId",row.bookingId)).unique();if(job&&job.status!=="succeeded")await ctx.db.patch(job._id,{status:"attention",retryAt:undefined,leaseUntil:0,updatedAt:now});}
 if(review)await queueOwnerNotification(ctx,{eventKey:`operator-cancel-review:${row._id}`,kind:"booking_cancelled",accountId:row.accountId,bookingId:row.bookingId,title:"Cancellation settlement needs attention",body:"Open the rental and review the recorded choice and provider receipts before resuming."});
}});
