import { legacyQualifyingRentalCount } from "../../shared/loyalty";
import { loyaltyPercent } from "../../shared/rentalBenefits";
import { belongsToRentalAccount } from "./rentalAccount";
import { reviewSettlementFingerprint } from "./reviewEligibility";
import { reviewContext } from "./reviewContext";
import { validEncoreEvidence } from "./encoreRollup";
import { encoreGate } from "./encoreEligibility";
export { encoreGate, encoreAccountOwnsRental } from "./encoreEligibility";
export function encorePolicyVersion(){return process.env.ENCORE_EVIDENCE_READ_ENABLED==="true"?"clean-return-v2":"review-earned-v1";}

export function celebratedLoyaltyLevel(account:any){
 return account.loyaltyPolicyVersion===encorePolicyVersion() ? (account.loyaltyCelebratedLevel??0) : 0;
}
export async function loyaltyProgress(ctx:any,account:any){
 if(process.env.ENCORE_EVIDENCE_READ_ENABLED==="true"){
  const rollup=await ctx.db.query("encore_account_rollups").withIndex("by_account",(query:any)=>query.eq("accountId",account._id)).unique();
  const keys=new Set<string>();
  for(const candidate of rollup?.published??[]){
   const evidence=await ctx.db.get(candidate.evidenceId);
   if(evidence?.bookingId===candidate.bookingId&&evidence.checkoutKey===candidate.checkoutKey&&evidence.fingerprint===candidate.fingerprint&&await validEncoreEvidence(ctx,account,evidence))keys.add(candidate.checkoutKey);
  }
  const completed=Math.min(3,keys.size);return {eligible:completed>0,completed,level:completed,percent:loyaltyPercent(completed)};
 }
 const qualifying:any[]=[],seen=new Set<string>();
 const feeds=[ctx.db.query("bookings").withIndex("by_account",(q:any)=>q.eq("accountId",account._id)).order("desc"),ctx.db.query("bookings").withIndex("by_guestEmail",(q:any)=>q.eq("guestEmail",account.email.trim().toLowerCase())).order("desc")];
 for(const feed of feeds)for await(const booking of feed){
  if(seen.has(booking._id)||!belongsToRentalAccount(booking,account))continue;seen.add(booking._id);
  if(encoreGate(booking))continue;
  const review=await ctx.db.query("reviews").withIndex("by_booking",(q:any)=>q.eq("verifiedBookingId",booking._id)).first();
  if(!review||review.source!=="native"||review.authorAccountId!==account._id)continue;
  if(booking.reviewEligibilityFingerprint!==reviewSettlementFingerprint(await reviewContext(ctx,booking)))continue;
  qualifying.push(booking);
  if(legacyQualifyingRentalCount(qualifying)===3)return {eligible:true,completed:3,level:3,percent:loyaltyPercent(3)};
 }
 const completed=legacyQualifyingRentalCount(qualifying);
 return {eligible:completed>0,completed,level:completed,percent:loyaltyPercent(completed)};
}
export async function unlockLoyalty(ctx:any,account:any){
 const progress=await loyaltyProgress(ctx,account);if(!progress.eligible)return progress;
 const policyVersion=encorePolicyVersion(),current=account.loyaltyPolicyVersion===policyVersion;
 await ctx.db.patch(account._id,{loyaltyLevel:progress.level,loyaltyPolicyVersion:policyVersion,
  ...(!current?{loyaltyCelebratedLevel:0,loyaltyCelebratedAt:undefined}:{}),
  loyaltyUnlockedAt:progress.level===3?(current?account.loyaltyUnlockedAt??Date.now():Date.now()):undefined});
 return progress;
}
