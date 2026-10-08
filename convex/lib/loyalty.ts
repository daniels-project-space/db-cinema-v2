import { qualifyingRentalCount } from "../../shared/loyalty";
import { loyaltyPercent } from "../../shared/rentalBenefits";
import { belongsToRentalAccount } from "./rentalAccount";
import { customerReviewGate, reviewSettlementFingerprint } from "./reviewEligibility";
import { reviewContext } from "./reviewContext";
export const ENCORE_POLICY_VERSION="review-earned-v1";

/** A reward needs a documented clean return, independently of review rating. */
export function encoreGate(booking:any):string|null {
 const blocked=customerReviewGate(booking);if(blocked)return blocked;
 if(booking.cancellationDecision)return "cancelled";
 const inspection=booking.returnDecision?.inspection ?? booking.returnStatement?.inspection;
 if(!booking.actualReturnedAt || !inspection?.length)return "inspection_unrecorded";
 if(new Set(inspection.map((item:any)=>item.key)).size!==inspection.length)return "inspection_invalid";
 if(inspection.some((item:any)=>item.condition!=="good" || item.openCase || item.details?.trim()))return "return_issue";
 if((booking.lateFeeAmount??0)>0)return "late_return";
 return null;
}
export function celebratedLoyaltyLevel(account:any){
 return account.loyaltyPolicyVersion===ENCORE_POLICY_VERSION ? (account.loyaltyCelebratedLevel??0) : 0;
}
/** Cached legacy levels are not evidence of a review. Ownership follows accountId
 * after email changes; only genuinely unlinked history uses the legacy email. */
export async function loyaltyProgress(ctx:any,account:any){
 const qualifying:any[]=[],seen=new Set<string>();
 const feeds=[ctx.db.query("bookings").withIndex("by_account",(q:any)=>q.eq("accountId",account._id)).order("desc"),
  ctx.db.query("bookings").withIndex("by_guestEmail",(q:any)=>q.eq("guestEmail",account.email.trim().toLowerCase())).order("desc")];
 for(const feed of feeds)for await(const booking of feed){
  if(seen.has(booking._id)||!belongsToRentalAccount(booking,account))continue;seen.add(booking._id);
  if(encoreGate(booking))continue;
  const review=await ctx.db.query("reviews").withIndex("by_booking",(q:any)=>q.eq("verifiedBookingId",booking._id)).first();
  if(!review || review.source!=="native" || review.authorAccountId!==account._id)continue;
  // Publishing/moderation and positive star ratings never decide the reward.
  if(booking.reviewEligibilityFingerprint!==reviewSettlementFingerprint(await reviewContext(ctx,booking)))continue;
  qualifying.push(booking);
  if(qualifyingRentalCount(qualifying)===3)return {eligible:true,completed:3,level:3,percent:loyaltyPercent(3)};
 }
 const completed=qualifyingRentalCount(qualifying);
 return {eligible:completed>0,completed,level:completed,percent:loyaltyPercent(completed)};
}
/** Called in the same transaction that saves the authenticated rental review. */
export async function unlockLoyalty(ctx:any,account:any){
 const progress=await loyaltyProgress(ctx,account);if(!progress.eligible)return progress;
 const current=account.loyaltyPolicyVersion===ENCORE_POLICY_VERSION;
 await ctx.db.patch(account._id,{loyaltyLevel:progress.level,loyaltyPolicyVersion:ENCORE_POLICY_VERSION,
  ...(!current?{loyaltyCelebratedLevel:0,loyaltyCelebratedAt:undefined}:{}),
  loyaltyUnlockedAt:progress.level===3?(current?account.loyaltyUnlockedAt??Date.now():Date.now()):undefined});
 return progress;
}
