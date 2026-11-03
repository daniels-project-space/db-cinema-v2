import { loyaltyProgress } from "./loyalty";
import { membershipReadSettled } from "./membershipReadFence";
import { encoreGate } from "./encoreEligibility";
import { belongsToRentalAccount } from "./rentalAccount";

const CLEAN_RENTAL_HISTORY_PAGE_SIZE = 100;

async function historyHasCleanRental(query:any, matches:(booking:any)=>boolean){
  let cursor:string|null=null;
  while(true){
    const result:any=await query.paginate({numItems:CLEAN_RENTAL_HISTORY_PAGE_SIZE,cursor});
    if(result.page.some(matches))return true;
    if(result.isDone)return false;
    cursor=result.continueCursor;
  }
}

async function hasCleanCompletedRental(ctx:any,account:any){
  const clean=(booking:any)=>belongsToRentalAccount(booking,account)&&encoreGate(booking)===null;
  const owned=ctx.db.query("bookings").withIndex("by_account",(query:any)=>query.eq("accountId",account._id)).order("desc");
  if(await historyHasCleanRental(owned,clean))return true;
  const email=(account.email??"").trim().toLowerCase();
  if(!email)return false;
  const legacy=ctx.db.query("bookings").withIndex("by_guestEmail",(query:any)=>query.eq("guestEmail",email)).order("desc");
  return historyHasCleanRental(legacy,(booking:any)=>!booking.accountId&&clean(booking));
}

export async function strictDepositWaiver(ctx:any,account:any,valuePence:number,now=Date.now()){
  if(!account||account.blockedAt!=null||account.emailVerificationRequired&&!account.emailVerifiedAt||!Number.isSafeInteger(valuePence)||valuePence<0||valuePence>=400000)return null;
  if(!await hasCleanCompletedRental(ctx,account))return null;
  const progress=await loyaltyProgress(ctx,account);
  if(progress.eligible&&progress.level>=3)return "encore" as const;
  if(!account.stripeSubscriptionId||!account.membershipActive||account.membershipStatus!=="active"||account.membershipSource==="collective-comp"||account.membershipPerksPendingBookingId||(account.membershipPaidThrough??0)<=now)return null;
  if(!await membershipReadSettled(ctx,account.stripeSubscriptionId))return null;
  const receipt=await ctx.db.query("membership_credit_grants").withIndex("by_account_subscription_period",(query:any)=>query.eq("accountId",account._id).eq("subscriptionId",account.stripeSubscriptionId).gt("periodEnd",now)).order("desc").first();
  if(!receipt||!Number.isSafeInteger(receipt.waiverProofReadyAt)||receipt.waiverProofReadyAt>now||receipt.waiverProofReadyAt<=now-24*3600000||!Number.isSafeInteger(receipt.paidMembershipPence)||receipt.paidMembershipPence<=0||(receipt.membershipRefundedPence??0)>=receipt.paidMembershipPence)return null;
  return "paid_membership" as const;
}
