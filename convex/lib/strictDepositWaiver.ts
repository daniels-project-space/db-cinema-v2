import { loyaltyProgress } from "./loyalty";
import { membershipReadSettled } from "./membershipReadFence";

export async function strictDepositWaiver(ctx:any,account:any,valuePence:number,now=Date.now()){
  if(!account||account.blockedAt!=null||account.emailVerificationRequired&&!account.emailVerifiedAt||!Number.isSafeInteger(valuePence)||valuePence<0||valuePence>=400000)return null;
  const progress=await loyaltyProgress(ctx,account);
  if(!progress.eligible||progress.completed<1)return null;
  if(progress.level>=3)return "encore" as const;
  if(!account.stripeSubscriptionId||!account.membershipActive||account.membershipStatus!=="active"||account.membershipSource==="collective-comp"||account.membershipPerksPendingBookingId||(account.membershipPaidThrough??0)<=now)return null;
  if(!await membershipReadSettled(ctx,account.stripeSubscriptionId))return null;
  const receipt=await ctx.db.query("membership_credit_grants").withIndex("by_account_subscription_period",(query:any)=>query.eq("accountId",account._id).eq("subscriptionId",account.stripeSubscriptionId).gt("periodEnd",now)).order("desc").first();
  if(!receipt||!Number.isSafeInteger(receipt.waiverProofReadyAt)||receipt.waiverProofReadyAt>now||receipt.waiverProofReadyAt<=now-24*3600000||!Number.isSafeInteger(receipt.paidMembershipPence)||receipt.paidMembershipPence<=0||(receipt.membershipRefundedPence??0)>=receipt.paidMembershipPence)return null;
  return "paid_membership" as const;
}
