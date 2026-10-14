"use node";
import {action,internalAction} from "./_generated/server";
import {internal} from "./_generated/api";
import {v} from "convex/values";
import {createHmac,timingSafeEqual} from "node:crypto";
import {operatorCancellationOptions,type OperatorCancellationPreview} from "../shared/operatorCancellationCredit";
import {emailEscape,emailMoney,emailRows,rentalEmail} from "../shared/rentalEmail";
import type {MailInput} from "./lib/mailer";
import {RefundReviewRequired} from "./lib/approvedRefund";
function proofFor(offer:any){
 const secret=process.env.INVOICE_SECRET;if(!secret)throw Error("Secure cancellation links are unavailable.");
 return createHmac("sha256",secret).update(JSON.stringify(["operator-choice-v1",offer._id,offer.accountId,offer.recipientEmail,offer.choiceDeadline,offer.cashRemainingPence,offer.securityRemainingPence,offer.spentCreditPence])).digest("hex");
}
function verify(offer:any,proof:string){
 if(!offer||!offer.choiceDeadline||Date.now()>=offer.choiceDeadline||! /^[a-f0-9]{64}$/.test(proof))throw Error("This cancellation link has expired or is invalid. Open your account or contact the team.");
 if(!timingSafeEqual(Buffer.from(proof,"hex"),Buffer.from(proofFor(offer),"hex")))throw Error("This cancellation link is invalid.");
}
function amounts(offer:any){return operatorCancellationOptions({cashRemainingPence:offer.cashRemainingPence,securityRemainingPence:offer.securityRemainingPence,spentCreditPence:offer.spentCreditPence});}
export const prepareEmail=internalAction({args:{bookingId:v.id("bookings"),deliveryKey:v.string()},handler:async(ctx,a):Promise<MailInput|null>=>{
 const b:any=await ctx.runQuery(internal.bookings.getForCancel,{bookingId:a.bookingId});if(!b?.cancellationDecision?.operatorOfferId)return null;
 const context:any=await ctx.runQuery(internal.operatorCancellationState.byId,{offerId:b.cancellationDecision.operatorOfferId});
 if(!context||context.offer.state!=="email_pending"||context.account?.blockedAt!=null||context.account?.email!==context.offer.recipientEmail||Date.now()<context.offer.decisionAfter)return null;
 const offer=context.offer,options=amounts(offer),origin=new URL(process.env.APP_URL??"https://dbcinemarentals.com").origin;
 const link=(choice:string)=>`${origin}/cancellation-choice#${new URLSearchParams({offer:String(offer._id),proof:proofFor(offer),choice})}`;
 const deadline=new Date(offer.choiceDeadline).toLocaleString("en-GB",{timeZone:"Europe/London",dateStyle:"medium",timeStyle:"short"});
 const body=`<p>We’re sorry: your equipment is unexpectedly unavailable, so we have cancelled the rental before pickup. Please choose how you would like us to settle it.</p>${emailRows([["Original-payment refund",emailMoney(options.refund.cardRefundPence/100)],["Or account credit, including 30% extra",emailMoney(options.credit.creditPence/100)],["Credit validity","365 days from issue"]])}<p>Choose credit and ${emailMoney(options.credit.cardRefundPence/100)} refundable deposit returns separately to the original card. Previously used credit is included once in the review. Membership fees are separate.</p><p><a href="${emailEscape(link("credit"))}" style="display:inline-block;padding:13px 20px;background:#1b7161;border-radius:4px;color:white;text-decoration:none;font-weight:600">Review account credit +30%</a></p><p>Credit replaces the rental cash refund and cannot be withdrawn as cash; statutory rights remain unchanged. Both buttons open a review page and require your confirmation.</p><p style="font-size:12px">Please respond by ${emailEscape(deadline)} London time. If you do not choose, we process the original-payment refund and restore previously used credit. Bank posting times vary.</p>`;
 return {to:offer.recipientEmail,subject:"Your cancelled rental · refund or account credit +30%",deliveryKey:a.deliveryKey,html:rentalEmail({title:"Let’s put this right",preview:"Review a full refund or account credit with 30% extra, valid for 365 days.",body,url:link("refund"),button:"Review original-payment refund"})};
}});
const linkArgs={offerId:v.id("operator_cancellation_offers"),proof:v.string()};
export const preview=action({args:linkArgs,handler:async(ctx,a):Promise<OperatorCancellationPreview>=>{
 const context:any=await ctx.runQuery(internal.operatorCancellationState.byId,{offerId:a.offerId});verify(context?.offer,a.proof);
 if(!context.account||context.account.email!==context.offer.recipientEmail)throw Error("The account changed. Contact the team to review this cancellation.");
 const options=amounts(context.offer);return {state:context.offer.state,choice:context.offer.choice??null,choiceDeadline:context.offer.choiceDeadline,refund:options.refund,credit:options.credit,creditAllowed:context.account.blockedAt==null,bookingTitle:context.booking?.lineItems.map((i:any)=>i.title).join(", ")??"Rental"};
}});
export const choose=action({args:{...linkArgs,choice:v.union(v.literal("refund"),v.literal("credit")),confirmed:v.boolean()},handler:async(ctx,a):Promise<{state:OperatorCancellationPreview["state"];choice:"refund"|"credit"}>=>{
 if(!a.confirmed)throw Error("Review and confirm your settlement choice.");
 const context:any=await ctx.runQuery(internal.operatorCancellationState.byId,{offerId:a.offerId});verify(context?.offer,a.proof);
 const row:any=await ctx.runMutation(internal.operatorCancellationState.choose,{offerId:a.offerId,choice:a.choice,recipientEmail:context.offer.recipientEmail});
 // The existing minute reconciliation clock executes the chosen settlement.
 // Saving a choice is atomic; a lost browser response never changes it.
 return {state:row.state,choice:row.choice};
}});
export const reconcile=internalAction({args:{},handler:async(ctx):Promise<{checked:number}>=>{
 const due:any[]=await ctx.runQuery(internal.operatorCancellationState.due,{});
 for(const candidate of due){
  const row:any=await ctx.runMutation(internal.operatorCancellationState.claim,{offerId:candidate._id});if(!row)continue;
  try{
   if(row.state==="waiting"){
    const value:any=await ctx.runAction(internal.checkout.operatorCancellationBalance,{offerId:row._id});
    await ctx.runMutation(internal.operatorCancellationState.prepare,{offerId:row._id,generation:row.generation,amounts:value});
   }else if(row.state==="email_pending"||row.state==="offered")await ctx.runMutation(internal.operatorCancellationState.advance,{offerId:row._id,generation:row.generation});
   else if(row.state==="chosen"){
    await ctx.runAction(internal.checkout.settleOperatorCancellation,{offerId:row._id});
    await ctx.runMutation(internal.operatorCancellationState.finishAttempt,{offerId:row._id,generation:row.generation,complete:true});
   }
  }catch(error){await ctx.runMutation(internal.operatorCancellationState.finishAttempt,{offerId:row._id,generation:row.generation,complete:false,review:error instanceof RefundReviewRequired||["CANCELLATION_REVIEW","OPERATOR_CANCELLATION_REVIEW"].includes((error as any)?.data?.code)});}
 }
 return {checked:due.length};
}});
