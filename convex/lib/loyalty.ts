import { qualifyingRentalCount } from "../../shared/loyalty";
import { loyaltyPercent } from "../../shared/rentalBenefits";
import { belongsToRentalAccount } from "./rentalAccount";
import { customerReviewGate, reviewSettlementFingerprint } from "./reviewEligibility";
import { reviewContext } from "./reviewContext";
export const ENCORE_POLICY_VERSION="review-earned-v1";
const MAX_ENCORE_REVIEW_SCAN=100;

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
async function calculateLoyaltyProgress(ctx:any,account:any,maxBookings:number | null){
 const qualifying:any[]=[],seen=new Set<string>();
 let examined=0;
 const resolve=(completed:number)=>{const level=account.adminEncoreLevel??completed;return {eligible:completed>0||level>0,completed,level,percent:loyaltyPercent(level)}};
 const feeds=[ctx.db.query("bookings").withIndex("by_account",(q:any)=>q.eq("accountId",account._id)).order("desc"),
  ctx.db.query("bookings").withIndex("by_guestEmail",(q:any)=>q.eq("guestEmail",account.email.trim().toLowerCase())).order("desc")];
 for(const feed of feeds)for await(const booking of feed){
  if(maxBookings !== null && examined++ >= maxBookings)return null;
  if(seen.has(booking._id)||!belongsToRentalAccount(booking,account))continue;seen.add(booking._id);
  if(encoreGate(booking))continue;
  const review=await ctx.db.query("reviews").withIndex("by_booking",(q:any)=>q.eq("verifiedBookingId",booking._id)).first();
  if(!review || review.source!=="native" || review.authorAccountId!==account._id)continue;
  // Publishing/moderation and positive star ratings never decide the reward.
  if(booking.reviewEligibilityFingerprint!==reviewSettlementFingerprint(await reviewContext(ctx,booking)))continue;
  qualifying.push(booking);
  if(qualifyingRentalCount(qualifying)===3)return resolve(3);
 }
 return resolve(qualifyingRentalCount(qualifying));
}
export async function loyaltyProgress(ctx:any,account:any){
 return (await calculateLoyaltyProgress(ctx,account,null))!;
}
export async function loyaltyProgressWithin(ctx:any,account:any,maxBookings:number){
 if(!Number.isInteger(maxBookings) || maxBookings < 1)throw Error("Invalid loyalty history limit.");
 return calculateLoyaltyProgress(ctx,account,maxBookings);
}

/** Computes the earned tier from indexed native reviews, not all booking history.
 * Exact 1/2 results require checking all of an account's authored native reviews;
 * tier 3 can stop as soon as three distinct qualifying rental windows are found.
 * This intentionally ignores manual admin assignments.
 */
export async function earnedEncoreProgress(ctx:any,account:any){
 const qualifying:any[]=[],seenBookings=new Set<string>(),seenRentalWindows=new Set<string>();
 const reviews=await ctx.db.query("reviews")
  .withIndex("by_author_account_source",(q:any)=>q.eq("authorAccountId",account._id).eq("source","native"))
  .order("desc").take(MAX_ENCORE_REVIEW_SCAN+1);
 for(const review of reviews.slice(0,MAX_ENCORE_REVIEW_SCAN)){
  if(!review.verifiedBookingId || review.authorAccountId!==account._id)continue;
  const bookingKey=String(review.verifiedBookingId);
  if(seenBookings.has(bookingKey))continue;
  seenBookings.add(bookingKey);
  const booking=await ctx.db.get(review.verifiedBookingId);
  if(!booking || !belongsToRentalAccount(booking,account) || encoreGate(booking))continue;
  if(booking.reviewEligibilityFingerprint!==reviewSettlementFingerprint(await reviewContext(ctx,booking)))continue;
  if(!booking.lineItems?.length)continue;
  const start=Math.min(...booking.lineItems.map((line:any)=>line.start));
  const end=Math.max(...booking.lineItems.map((line:any)=>line.end));
  if(!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || end<start)continue;
  const checkout=booking.stripeCheckoutSessionId || booking.stripePaymentIntentId;
  if(!checkout && booking.rentalPaidPence===undefined)continue;
  const windowKey=`${checkout || booking._id}:${Math.floor(start/86400000)}:${Math.floor(end/86400000)}`;
  if(seenRentalWindows.has(windowKey))continue;
  seenRentalWindows.add(windowKey);
  qualifying.push(booking);
  const completed=qualifyingRentalCount(qualifying);
  if(completed===3)return {eligible:true,completed,level:completed,percent:loyaltyPercent(completed)};
 }
 // A long tail of native reviews is not evidence for any particular tier.
 // Keep numeric filters exact by treating a truncated calculation as unknown.
 if(reviews.length>MAX_ENCORE_REVIEW_SCAN)return {eligible:false,completed:null,level:null,percent:0};
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
