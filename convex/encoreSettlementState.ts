import { internalMutation, internalQuery } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import { reviewContext } from "./lib/reviewContext";
import { reviewSettlementFingerprint } from "./lib/reviewEligibility";
import { encoreGate, encoreAccountOwnsRental, loyaltyProgress } from "./lib/loyalty";
import { accountForRental } from "./lib/rentalAccount";
import { queueRentalEmail } from "./lib/rentalEmailQueue";
import { queueOwnerNotification } from "./lib/adminPush";
import { qualifyingRentalCount } from "../shared/loyalty";
import { queueEncoreRollup } from "./lib/encoreRollup";
import { queueEncoreNotice } from "./encoreNotices";
import { encoreGuestClaimEligible } from "./lib/encoreGuestClaim";

export const claim=internalMutation({args:{checkId:v.id("encore_settlement_checks")},handler:async(ctx,{checkId})=>{
 const row=await ctx.db.get(checkId),now=Date.now();
 if(!row||!["pending","checking"].includes(row.state)||row.dueAt>now)return null;
 const generation=row.generation+1;
 await ctx.db.patch(checkId,{state:"checking",generation,attempts:row.attempts+1,dueAt:now+5*60000,updatedAt:now});
 return {bookingId:row.bookingId,generation};
}});
export const context=internalQuery({args:{bookingId:v.id("bookings")},handler:async(ctx,{bookingId})=>{
 const booking=await ctx.db.get(bookingId);return booking?await reviewContext(ctx,booking):null;
}});
export const finish=internalMutation({args:{checkId:v.id("encore_settlement_checks"),generation:v.number(),fingerprint:v.optional(v.string()),result:v.union(v.literal("eligible"),v.literal("ineligible"),v.literal("retry")),error:v.optional(v.string())},handler:async(ctx,args)=>{
 const row=await ctx.db.get(args.checkId),now=Date.now();
 if(!row||row.state!=="checking"||row.generation!==args.generation||row.dueAt<=now)return false;
 const booking=await ctx.db.get(row.bookingId);
 let result=args.result;
 if(result==="eligible"&&(!booking||!args.fingerprint||args.fingerprint!==reviewSettlementFingerprint(await reviewContext(ctx,booking))||encoreGate(booking)))result="retry";
 if(result==="eligible"&&booking){
  const account=await accountForRental(ctx,booking);
  const owned=!!account&&encoreAccountOwnsRental(booking,account);
  const before=owned&&row.notifyEligible!==false?await loyaltyProgress(ctx,account):null;
  await ctx.db.patch(booking._id,{reviewEligibilityFingerprint:args.fingerprint,reviewEligibilityCheckedAt:now});
  const evidence=await ctx.db.query("encore_eligibility_evidence").withIndex("by_booking",q=>q.eq("bookingId",booking._id)).unique();
  const clean=owned&&qualifyingRentalCount([booking])===1&&!await ctx.db.query("rental_damage_cases").withIndex("by_booking",q=>q.eq("bookingId",booking._id)).first();
  if(clean&&account){const proof={bookingId:booking._id,accountId:account._id,checkoutKey:booking.stripeCheckoutSessionId??booking.stripePaymentIntentId??String(booking._id),fingerprint:args.fingerprint!,verifiedAt:now};const changed=!evidence||evidence.accountId!==proof.accountId||evidence.checkoutKey!==proof.checkoutKey||evidence.fingerprint!==proof.fingerprint;if(evidence)await ctx.db.patch(evidence._id,proof);else await ctx.db.insert("encore_eligibility_evidence",proof);if(changed){if(evidence&&evidence.accountId!==account._id)await queueEncoreRollup(ctx,evidence.accountId);await queueEncoreRollup(ctx,account._id);}}
  else if(evidence){await ctx.db.delete(evidence._id);await queueEncoreRollup(ctx,evidence.accountId);}
  if(clean&&account&&before&&process.env.ENCORE_EVIDENCE_READ_ENABLED==="true")await queueEncoreNotice(ctx,booking._id,account._id,before.level);
  if(process.env.ENCORE_EVIDENCE_READ_ENABLED==="true"&&!owned&&account&&row.notifyEligible!==false&&await encoreGuestClaimEligible(ctx,{...booking,reviewEligibilityFingerprint:args.fingerprint},account))await queueRentalEmail(ctx,booking._id,"encore_guest_claim",{encoreAccountId:account._id});
 }
 if(result==="ineligible"){const evidence=await ctx.db.query("encore_eligibility_evidence").withIndex("by_booking",q=>q.eq("bookingId",row.bookingId)).unique();if(evidence){await ctx.db.delete(evidence._id);await queueEncoreRollup(ctx,evidence.accountId);}}
 if(result==="retry"&&row.attempts>=12){
  await ctx.db.patch(row._id,{state:"attention",updatedAt:now,error:"Settlement evidence needs review"});
  const account=booking?await accountForRental(ctx,booking):null;
  await queueOwnerNotification(ctx,{eventKey:`encore-settlement:${row._id}:${row.generation}`,kind:"verification_failure",...(account?{accountId:account._id}:{}),bookingId:row.bookingId,title:"Encore settlement needs attention",body:"A completed rental's security settlement could not be confirmed. Review the rental before granting benefits."});
  return true;
 }
 await ctx.db.patch(row._id,{state:result==="retry"?"pending":"complete",updatedAt:now,dueAt:result==="retry"?now+Math.min(6*3600000,60000*2**Math.min(row.attempts-1,8)):now,error:result==="retry"?args.error:undefined});
 return true;
}});
export const retryDue=internalMutation({args:{},handler:async ctx=>{
 for(const state of ["pending","checking"]){const rows=await ctx.db.query("encore_settlement_checks").withIndex("by_state_due",q=>q.eq("state",state).lte("dueAt",Date.now())).take(20);
  for(const row of rows)await ctx.scheduler.runAfter(0,internal.encoreSettlement.processCheck,{checkId:row._id});}
}});
