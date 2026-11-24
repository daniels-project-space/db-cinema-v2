import { qualifyingRentalCount } from "../../shared/loyalty";
import { loyaltyPercent } from "../../shared/rentalBenefits";
import { belongsToRentalAccount } from "./rentalAccount";
import { customerReviewGate } from "./reviewEligibility";
import { cleanCompletedRental } from "./cleanCompletedRental";
export const ENCORE_POLICY_VERSION="reviewed-clean-completed-rental-earned-v6";
const LEGACY_ENCORE_POLICY_VERSIONS=["clean-completed-rental-earned-v5","clean-completed-rental-earned-v4","reviewed-clean-rental-earned-v3","review-earned-v1"];
const MAX_ENCORE_BOOKING_SCAN=100;

/** A tier requires a documented clean return and the renter's own honest review. */
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
 return [ENCORE_POLICY_VERSION,...LEGACY_ENCORE_POLICY_VERSIONS].includes(account.loyaltyPolicyVersion) ? (account.loyaltyCelebratedLevel??0) : 0;
}
const tier=(value:any)=>Number.isInteger(value)&&value>=0&&value<=3?value:0;
function legacyLevel(account:any){
 const persisted=tier(account.loyaltyHistoricalLevel);
 const previousPolicy=LEGACY_ENCORE_POLICY_VERSIONS.includes(account.loyaltyPolicyVersion);
 return Math.max(persisted,previousPolicy?tier(account.loyaltyLevel):0);
}
const unresolved=(account:any,historicalLevel=legacyLevel(account),hasCleanCompletedRental:boolean|null=null)=>{
 const assigned=tier(account.adminEncoreLevel)||null;
 const level=assigned??historicalLevel;
 return {eligible:level>0,completed:null,hasCleanCompletedRental,level,percent:loyaltyPercent(level),earnedLevel:historicalLevel,historicalLevel,adminAssigned:assigned!==null};
};
const resolved=(account:any,completed:number,historicalLevel=legacyLevel(account),hasCleanCompletedRental:boolean|null=null)=>{
 const earnedLevel=Math.max(completed,historicalLevel);
 const assigned=tier(account.adminEncoreLevel)||null;
 const level=assigned??earnedLevel;
 return {eligible:level>0,completed,hasCleanCompletedRental,level,percent:loyaltyPercent(level),earnedLevel,historicalLevel,adminAssigned:assigned!==null};
};
function validEncoreReview(review:any,booking:any,account:any){
 return !!review&&review.source==="native"&&String(review.verifiedBookingId)===String(booking._id)&&
  String(review.authorAccountId)===String(account._id)&&Number.isInteger(review.rating)&&review.rating>=1&&review.rating<=5&&
  typeof review.text==="string"&&review.text.trim().length>=10&&review.text.trim().length<=2000&&
  review.moderationStatus!=="rejected";
}
/** Only clean, settled rentals count. Checkout and account reads share
 * a strict index-read ceiling; overflow is unknown rather than a guessed tier.
 * The email compatibility feed is capped before filtering linked rows. */
async function calculateLoyaltyProgress(ctx:any,account:any,maxBookings=MAX_ENCORE_BOOKING_SCAN){
 if(!Number.isInteger(maxBookings)||maxBookings<1||maxBookings>MAX_ENCORE_BOOKING_SCAN)throw Error("Invalid loyalty history limit.");
 const [linked,byEmail]=await Promise.all([
  ctx.db.query("bookings").withIndex("by_account_status",(q:any)=>q.eq("accountId",account._id).eq("status","returned")).order("desc").take(maxBookings+1),
  ctx.db.query("bookings").withIndex("by_guestEmail_status",(q:any)=>q.eq("guestEmail",account.email.trim().toLowerCase()).eq("status","returned")).order("desc").take(maxBookings+1),
 ]);
 const legacy=byEmail.filter((booking:any)=>booking.accountId==null);
 const bookings=[...new Map([...linked,...legacy].map((booking:any)=>[String(booking._id),booking])).values()]
  .sort((a:any,b:any)=>b._creationTime-a._creationTime);
 const overLimit=linked.length>maxBookings||byEmail.length>maxBookings||bookings.length>maxBookings;
 const qualifying:any[]=[];
 const legacyClean:any[]=[];
 const preserveLegacy=LEGACY_ENCORE_POLICY_VERSIONS.includes(account.loyaltyPolicyVersion);
 let hasCleanCompletedRental=false;
 for(const booking of bookings.slice(0,maxBookings)){
  if(!belongsToRentalAccount(booking,account)||encoreGate(booking))continue;
  const review=await ctx.db.query("reviews").withIndex("by_booking",(q:any)=>q.eq("verifiedBookingId",booking._id)).first();
  const reviewed=validEncoreReview(review,booking,account);
  if(!reviewed&&hasCleanCompletedRental&&!preserveLegacy)continue;
  if(!await cleanCompletedRental(ctx,booking,account))continue;
  hasCleanCompletedRental=true;
  if(preserveLegacy)legacyClean.push(booking);
  if(reviewed)qualifying.push(booking);
  const completed=qualifyingRentalCount(qualifying);
  const retainedLevel=Math.max(legacyLevel(account),preserveLegacy?qualifyingRentalCount(legacyClean):0);
  // Three reviewed returns cap the earned level; older rows cannot change it.
  if(completed===3)return resolved(account,3,retainedLevel,true);
 }
 const completed=qualifyingRentalCount(qualifying);
 const historicalLevel=Math.max(legacyLevel(account),preserveLegacy?qualifyingRentalCount(legacyClean):0);
 if(overLimit&&completed<3)return unresolved(account,historicalLevel,hasCleanCompletedRental?true:null);
 return resolved(account,completed,historicalLevel,hasCleanCompletedRental);
}
export async function loyaltyProgress(ctx:any,account:any){
 return calculateLoyaltyProgress(ctx,account);
}
export async function loyaltyProgressWithin(ctx:any,account:any,maxBookings:number){
 const progress=await calculateLoyaltyProgress(ctx,account,maxBookings);
 return progress.completed===null?null:progress;
}

/** Computes earned tiers from bounded clean rental history; manual assignments
 * never alter earned progress. */
export async function earnedEncoreProgress(ctx:any,account:any){
 const progress=await calculateLoyaltyProgress(ctx,account);
 if(progress.completed===null)return {eligible:progress.historicalLevel>0,completed:null,level:progress.earnedLevel||null,percent:loyaltyPercent(progress.earnedLevel)};
 return {eligible:progress.earnedLevel>0,completed:progress.completed,level:progress.earnedLevel,percent:loyaltyPercent(progress.earnedLevel)};
}
/** Called in the same transaction that saves the authenticated rental review. */
export async function unlockLoyalty(ctx:any,account:any){
 const progress=await loyaltyProgress(ctx,account);
 if(progress.completed===null)return progress;
 const current=[ENCORE_POLICY_VERSION,...LEGACY_ENCORE_POLICY_VERSIONS].includes(account.loyaltyPolicyVersion);
 await ctx.db.patch(account._id,{loyaltyLevel:progress.earnedLevel,loyaltyHistoricalLevel:progress.historicalLevel||undefined,loyaltyPolicyVersion:ENCORE_POLICY_VERSION,
  ...(!current?{loyaltyCelebratedLevel:0,loyaltyCelebratedAt:undefined}:{}),
  ...(progress.completed===3?{loyaltyUnlockedAt:account.loyaltyUnlockedAt??Date.now()}:{})});
 return progress;
}
