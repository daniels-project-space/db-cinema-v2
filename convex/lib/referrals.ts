import { referralCodeFor,threeMonthsAfter } from "../../shared/rentalBenefits";
export async function ensureReferralCode(ctx:any,accountId:any){
  const account=await ctx.db.get(accountId);if(!account)throw Error("Account missing");
  if(account.referralCode)return account.referralCode;
  for(let salt=0;salt<8;salt++){
    const code=referralCodeFor(String(accountId),salt),owner=await ctx.db.query("accounts").withIndex("by_referral_code",(q:any)=>q.eq("referralCode",code)).first();
    if(!owner){await ctx.db.patch(accountId,{referralCode:code});return code;}
  }
  throw Error("Could not allocate a referral code. Please try again.");
}
export async function referralEligibility(ctx:any,account:any,code:string,excludeBookingId?:any){
  if(!account)return {valid:false,reason:"Sign in or create an account to use a referral code."};
  const norm=code.trim().toUpperCase(),owner=await ctx.db.query("accounts").withIndex("by_referral_code",(q:any)=>q.eq("referralCode",norm)).first();
  if(!owner)return {valid:false,reason:"Unknown referral code."};
  if(owner._id===account._id||owner.email.trim().toLowerCase()===account.email.trim().toLowerCase())return {valid:false,reason:"You cannot refer yourself."};
  if(account.referralFirstUsedAt||account.firstRentalPaidAt)return {valid:false,reason:"Referral savings are for your first rental only."};
  const bookings=await ctx.db.query("bookings").withIndex("by_guestEmail",(q:any)=>q.eq("guestEmail",account.email.trim().toLowerCase())).collect();
  if(bookings.some((b:any)=>b._id!==excludeBookingId&&(b.stripePaymentIntentId||b.accountCreatedAtCheckout||["confirmed","active","returned","pending_payment"].includes(b.status))))return {valid:false,reason:"Referral savings are for your first rental only. Finish or cancel any existing unpaid checkout."};
  const claims=await ctx.db.query("referral_redemptions").withIndex("by_friend",(q:any)=>q.eq("friendAccountId",account._id)).collect();
  if(claims.some((r:any)=>r.bookingId!==excludeBookingId&&r.state!=="void"))return {valid:false,reason:"Your first-rental referral has already been claimed."};
  return {valid:true,code:norm,referrerAccountId:owner._id};
}
export async function availableReferralReward(ctx:any,account:any){
  if(!account||account.referralRewardUsedAt)return null;
  const rows=await ctx.db.query("referral_rewards").withIndex("by_account",(q:any)=>q.eq("accountId",account._id)).collect();
  for(const r of rows){
    if(r.state!=="available"||r.expiresAt<=Date.now())continue;
    if(r.reservedBookingId){const b=await ctx.db.get(r.reservedBookingId);if(b&&["pending_payment","confirmed","active","returned"].includes(b.status))continue;}
    return r;
  }
  return null;
}
export async function issueReferralReward(ctx:any,redemption:any){
  const account=await ctx.db.get(redemption.referrerAccountId);if(!account)return null;
  const prior=await ctx.db.query("referral_rewards").withIndex("by_account",(q:any)=>q.eq("accountId",account._id)).first();
  if(prior||account.referralRewardGrantedAt)return prior?._id??null;
  const now=Date.now(),id=await ctx.db.insert("referral_rewards",{accountId:account._id,redemptionId:redemption._id,percent:40,state:"available",createdAt:now,expiresAt:threeMonthsAfter(now)});
  await ctx.db.patch(account._id,{referralRewardGrantedAt:now});return id;
}
