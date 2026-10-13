import {query,mutation,internalQuery,internalMutation} from "./_generated/server";
import {v} from "convex/values";
import {assertAdmin,checkAdminToken} from "./adminAuth";
import {accountForToken,ownedBooking,postRentalMessage} from "./lib/rentalChat";
import {accountForRental} from "./lib/rentalAccount";
import {rentalControlsSnapshot} from "./lib/rentalControlsSnapshot";
import {confirmedRentalRefundPence} from "./lib/rentalPaymentPlan";
import {rentalPriceChange} from "../shared/rentalPriceChange";
import {queueRmv2Sync} from "./lib/rmv2SyncQueue";
import {depositReturnReceipt} from "./lib/depositReturnReceipt";
import {internal} from "./_generated/api";

async function state(ctx:any,bookingId:any,ownRequest?:any){
 const b=await ctx.db.get(bookingId);
 if(!b||!["confirmed","active"].includes(b.status)||b.returnDecision||b.cancellationDecision||b.activeAdditionId||b.activeExtensionId||(b.activePriceAdjustmentId&&b.activePriceAdjustmentId!==ownRequest))throw Error("Finish the current rental operation before changing its price.");
 const refunds=await ctx.db.query("rental_refunds").withIndex("by_booking",(q:any)=>q.eq("bookingId",bookingId)).take(101);
 if(refunds.length>100||refunds.some((r:any)=>["prepared","pending"].includes(r.status)))throw Error("Wait for the rental refund to settle before changing the price.");
 return {b,refunds,snapshot:rentalControlsSnapshot(b,refunds),refundedPence:confirmedRentalRefundPence(refunds)};
}
export const preview=query({args:{token:v.string(),bookingId:v.id("bookings"),newTotal:v.number()},handler:async(ctx,a)=>{
 if(!checkAdminToken(a.token))throw Error("unauthorized");const s=await state(ctx,a.bookingId);return {...rentalPriceChange(s.b.total,s.b.depositAmount??0,s.refundedPence,a.newTotal),snapshot:s.snapshot,deposit:s.b.depositAmount??0};
}});
export const propose=mutation({args:{token:v.string(),bookingId:v.id("bookings"),requestId:v.string(),newTotal:v.number(),expectedSnapshot:v.string(),confirmed:v.boolean(),note:v.optional(v.string())},handler:async(ctx,a)=>{
 await assertAdmin(ctx,a.token,"rentalPriceState.propose");if(!a.confirmed||!a.expectedSnapshot||!/^[a-zA-Z0-9-]{16,80}$/.test(a.requestId))throw Error("Review and confirm the new rental price first.");
 const prior=await ctx.db.query("rental_price_adjustments").withIndex("by_request",q=>q.eq("bookingId",a.bookingId).eq("requestId",a.requestId)).unique();
 if(prior){if(prior.newTotal!==a.newTotal||prior.baseSnapshot!==a.expectedSnapshot||(prior.note??"")!==(a.note?.trim()??""))throw Error("This request belongs to a different price decision.");return prior._id}
 const s=await state(ctx,a.bookingId);if(s.snapshot!==a.expectedSnapshot)throw Error("The rental changed after price review. Refresh and review again.");
 const quote=rentalPriceChange(s.b.total,s.b.depositAmount??0,s.refundedPence,a.newTotal);if(quote.direction!=="increase")throw Error("Use the rental refund control to decrease the price.");
 const account=await accountForRental(ctx,s.b);if(!account||account.blockedAt!=null)throw Error("The rental account is unavailable.");
 const now=Date.now(),id=await ctx.db.insert("rental_price_adjustments",{bookingId:a.bookingId,accountId:account._id,requestId:a.requestId,baseSnapshot:s.snapshot,currentTotal:quote.current,newTotal:quote.newTotal,delta:quote.delta,note:a.note?.trim()||undefined,status:"awaiting_acceptance",reconcileAfter:now+7*86400000,createdAt:now,updatedAt:now,expiresAt:now+7*86400000});
 await ctx.db.patch(a.bookingId,{activePriceAdjustmentId:id});
 await postRentalMessage(ctx,{accountId:account._id,bookingId:a.bookingId,sender:"system",text:`The team proposes a rental payment of £${quote.newTotal.toFixed(2)} (an additional £${quote.delta.toFixed(2)}). Your refundable deposit is unchanged. Review and accept the proposal before paying; no extra money has been taken.`,meta:{type:"rental_price_proposal",priceAdjustmentId:id}});
 await queueRmv2Sync(ctx,a.bookingId);return id;
}});
export const list=query({args:{token:v.string(),bookingId:v.id("bookings"),admin:v.optional(v.boolean())},handler:async(ctx,a)=>{
 if(a.admin){if(!checkAdminToken(a.token))throw Error("unauthorized")}else{const account=await accountForToken(ctx,a.token);if(!account)throw Error("Please sign in.");await ownedBooking(ctx,account,a.bookingId)}
 const rows=await ctx.db.query("rental_price_adjustments").withIndex("by_booking",q=>q.eq("bookingId",a.bookingId)).order("desc").take(30);
 return rows.map(r=>({id:r._id,currentTotal:r.currentTotal,newTotal:r.newTotal,delta:r.delta,note:r.note,status:r.status,createdAt:r.createdAt,expiresAt:r.expiresAt,acceptedAt:r.acceptedAt,paymentUrl:["accepted","awaiting_payment","payment_review"].includes(r.status)?r.paymentUrl:undefined,...(a.admin?{approvalUrl:r.refundReceipt?.status==="awaiting_approval"?r.refundReceipt.approvalUrl:undefined}: {})}));
}});
export const accept=internalMutation({args:{token:v.string(),id:v.id("rental_price_adjustments"),expectedNewTotal:v.number(),expectedDelta:v.number()},handler:async(ctx,a)=>{
 const account=await accountForToken(ctx,a.token);const r=await ctx.db.get(a.id);if(!account||account.blockedAt!=null||!r||r.accountId!==account._id)throw Error("This price proposal is not available for your account.");
 await ownedBooking(ctx,account,r.bookingId);if(r.newTotal!==a.expectedNewTotal||r.delta!==a.expectedDelta)throw Error("The price proposal changed. Review it again.");
 if(r.status==="applied")return r;if(!["awaiting_acceptance","accepted","awaiting_payment"].includes(r.status)||r.expiresAt<=Date.now())throw Error("This price proposal is closed or expired.");
 const s=await state(ctx,r.bookingId,r._id),quote=rentalPriceChange(s.b.total,s.b.depositAmount??0,s.refundedPence,r.newTotal);if(quote.current!==r.currentTotal||quote.delta!==r.delta)throw Error("The original rental payment changed. Ask the team to review a fresh proposal.");
 if(r.status!=="awaiting_acceptance")return r;
 const acceptedAt=Date.now(),acceptanceText=`I accept the revised rental payment of £${r.newTotal.toFixed(2)}, including an additional £${r.delta.toFixed(2)} to pay now. Existing dates, equipment, refundable deposit and saved-card damage/late-fee permission are unchanged. This is a separate rental payment, not a damage or late-fee collection.`;
 const patch={status:"accepted" as const,acceptedAt,acceptedEmail:account.email,acceptanceText,expiresAt:acceptedAt+45*60000,reconcileAfter:acceptedAt+5*60000,updatedAt:acceptedAt};await ctx.db.patch(r._id,patch);return {...r,...patch};
}});
export const context=internalQuery({args:{id:v.id("rental_price_adjustments")},handler:async(ctx,{id})=>{const r=await ctx.db.get(id);return r?{request:r,booking:await ctx.db.get(r.bookingId)}:null}});
export const refundRetry=internalQuery({args:{bookingId:v.id("bookings"),requestId:v.string(),newTotal:v.number()},handler:async(ctx,a)=>{const r=await ctx.db.query("rental_refunds").withIndex("by_request",q=>q.eq("requestId",a.requestId)).unique();if(!r)return null;if(r.bookingId!==a.bookingId||r.reason!==`Rental price adjusted to £${a.newTotal.toFixed(2)}`)throw Error("This refund request belongs to a different price decision.");return {amountPence:r.amountPence,reason:r.reason};}});
export const bindSession=internalMutation({args:{id:v.id("rental_price_adjustments"),sessionId:v.string(),url:v.string()},handler:async(ctx,a)=>{
 const r=await ctx.db.get(a.id);if(!r||!["accepted","awaiting_payment","expired","withdrawn"].includes(r.status)||!r.acceptedAt)throw Error("The renter must accept this price first.");if(r.sessionId&&r.sessionId!==a.sessionId)throw Error("The original price payment cannot be replaced.");await ctx.db.patch(r._id,{sessionId:a.sessionId,paymentUrl:a.url,reconcileAfter:Date.now()+5*60000,reconcileAttempts:0,reconcileError:undefined,status:["expired","withdrawn"].includes(r.status)?r.status:"awaiting_payment",updatedAt:Date.now()});
}});
export const applyPaid=internalMutation({args:{id:v.id("rental_price_adjustments"),sessionId:v.string(),paymentIntentId:v.string(),amountPence:v.number()},handler:async(ctx,a)=>{
 const r=await ctx.db.get(a.id);if(!r)throw Error("Price proposal missing.");if(r.status==="applied"){if(r.sessionId!==a.sessionId||r.paymentIntentId!==a.paymentIntentId)throw Error("Paid price receipt mismatch.");return {bookingId:r.bookingId,applied:true,already:true}}
 if(!["awaiting_payment","payment_review"].includes(r.status)||!r.acceptedAt||!r.acceptanceText||r.sessionId!==a.sessionId||a.amountPence!==Math.round(r.delta*100))return {bookingId:r.bookingId,closed:true};
 const booking=await ctx.db.get(r.bookingId);if(!booking||!["confirmed","active"].includes(booking.status)||booking.activePriceAdjustmentId!==r._id||booking.returnDecision||booking.cancellationDecision)return {bookingId:r.bookingId,closed:true};
 const s=await state(ctx,r.bookingId,r._id);const baseline=rentalPriceChange(s.b.total,s.b.depositAmount??0,s.refundedPence,r.newTotal);if(baseline.current!==r.currentTotal||baseline.delta!==r.delta)return {bookingId:r.bookingId,closed:true};
 const start=Math.min(...s.b.lineItems.map((l:any)=>l.start)),end=Math.max(...s.b.lineItems.map((l:any)=>l.end));
 await ctx.db.patch(r.bookingId,{total:Math.round((s.b.total+r.delta)*100)/100,subtotal:Math.round((s.b.subtotal+r.delta)*100)/100,activePriceAdjustmentId:undefined,priceAdjustmentCharges:[...(s.b.priceAdjustmentCharges??[]),{id:r._id,title:"Accepted rental price adjustment",start,end,qty:1,lineTotal:r.delta}]});
 await ctx.db.patch(r._id,{status:"applied",reconcileAfter:undefined,reconcileError:undefined,paymentIntentId:a.paymentIntentId,paidAt:Date.now(),updatedAt:Date.now()});
 await postRentalMessage(ctx,{accountId:r.accountId,bookingId:r.bookingId,sender:"system",text:`Your additional rental payment of £${r.delta.toFixed(2)} is confirmed. The revised rental payment is £${r.newTotal.toFixed(2)}. Deposit and saved-card security are unchanged.`});
 await queueRmv2Sync(ctx,r.bookingId);await ctx.scheduler.runAfter(0,internal.notify.changeEmail,{bookingId:r.bookingId,kind:"rental price updated",detail:`Additional payment £${r.delta.toFixed(2)} received; revised rental payment £${r.newTotal.toFixed(2)}.`});return {bookingId:r.bookingId,applied:true};
}});
export const close=internalMutation({args:{id:v.id("rental_price_adjustments"),status:v.union(v.literal("withdrawn"),v.literal("expired"))},handler:async(ctx,a)=>{const r=await ctx.db.get(a.id);if(!r||r.status==="applied")throw Error("A paid price change cannot be withdrawn. Use the refund control.");await ctx.db.patch(r._id,{status:a.status,reconcileAfter:undefined,updatedAt:Date.now()});const b=await ctx.db.get(r.bookingId);if(b?.activePriceAdjustmentId===r._id)await ctx.db.patch(b._id,{activePriceAdjustmentId:undefined});}});
export const pending=internalQuery({args:{},handler:async(ctx)=>{const rows=[];for(const status of ["awaiting_acceptance","accepted","awaiting_payment","refund_pending"]as const)rows.push(...await ctx.db.query("rental_price_adjustments").withIndex("by_status_due",q=>q.eq("status",status).lte("reconcileAfter",Date.now())).take(20));return rows}});

export const recordRefund=internalMutation({args:{id:v.id("rental_price_adjustments"),receipt:depositReturnReceipt},handler:async(ctx,a)=>{const r=await ctx.db.get(a.id);if(!r||r.status==="applied"||a.receipt.amountPence!==Math.round(r.delta*100))throw Error("Price refund receipt mismatch.");const old=r.refundReceipt;if(old&&(old.paymentIntentId!==a.receipt.paymentIntentId||old.attemptedAt!==a.receipt.attemptedAt||(old.stripeRefundId&&old.stripeRefundId!==a.receipt.stripeRefundId)||(old.approvalRequestId&&old.approvalRequestId!==a.receipt.approvalRequestId)))throw Error("Price refund receipt cannot be replaced.");await ctx.db.patch(r._id,{refundReceipt:a.receipt,reconcileAfter:a.receipt.status==="pending"?Date.now()+5*60000:undefined,paymentIntentId:a.receipt.paymentIntentId,status:a.receipt.status==="succeeded"?"refunded":a.receipt.status==="pending"?"refund_pending":"refund_review",updatedAt:Date.now()});const b=await ctx.db.get(r.bookingId);if(b?.activePriceAdjustmentId===r._id)await ctx.db.patch(b._id,{activePriceAdjustmentId:undefined});}});

export const reconciliationResult=internalMutation({args:{id:v.id("rental_price_adjustments"),error:v.optional(v.string())},handler:async(ctx,a)=>{const r=await ctx.db.get(a.id);if(!r||!["accepted","awaiting_payment","refund_pending"].includes(r.status))return;const attempts=a.error?(r.reconcileAttempts??0)+1:0;await ctx.db.patch(r._id,{reconcileAttempts:attempts,reconcileError:a.error?.slice(0,240),reconcileAfter:attempts>=3?undefined:Date.now()+(a.error?Math.min(30,2**attempts)*60000:5*60000),...(attempts>=3?{status:r.status==="refund_pending"?"refund_review" as const:"payment_review" as const}:{})});}});

export const resumeReview=internalMutation({args:{id:v.id("rental_price_adjustments")},handler:async(ctx,{id})=>{const r=await ctx.db.get(id);if(!r||!["payment_review","refund_review","refund_pending","accepted","awaiting_payment"].includes(r.status))throw Error("This price request does not need resuming.");await ctx.db.patch(id,{status:r.status==="payment_review"?(r.sessionId?"awaiting_payment":"accepted"):r.status==="refund_review"?"refund_pending":r.status,reconcileAfter:Date.now()+5*60000,reconcileAttempts:0,reconcileError:undefined});return await ctx.db.get(id);}});
