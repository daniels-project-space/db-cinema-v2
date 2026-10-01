import { query,mutation,internalQuery,internalMutation } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import { accountForToken } from "./lib/rentalChat";
import { ensureReferralCode,referralEligibility,availableReferralReward,issueReferralReward } from "./lib/referrals";

export const ensureMine=mutation({args:{token:v.string()},handler:async(ctx,{token})=>{
 const account=await accountForToken(ctx,token);if(!account)throw Error("Sign in to your account.");return ensureReferralCode(ctx,account._id);
}});
export const mine=query({args:{token:v.string()},handler:async(ctx,{token})=>{
 const account=await accountForToken(ctx,token);if(!account)return null;
 const reward=await availableReferralReward(ctx,account),rows=await ctx.db.query("referral_redemptions").withIndex("by_referrer",q=>q.eq("referrerAccountId",account._id)).collect();
 return {code:account.referralCode??null,qualified:rows.filter(r=>r.state==="qualified").length,waiting:rows.filter(r=>["reserved","paid"].includes(r.state)).length,reward:reward?{id:reward._id,percent:40,expiresAt:reward.expiresAt}:null,rewardGranted:!!account.referralRewardGrantedAt,rewardUsed:!!account.referralRewardUsedAt};
}});
export const offers=internalQuery({args:{accountId:v.optional(v.id("accounts")),code:v.optional(v.string())},handler:async(ctx,{accountId,code})=>{
 const account=accountId?await ctx.db.get(accountId):null,friend=code?.toUpperCase().startsWith("DBC-")?await referralEligibility(ctx,account,code):null;
 const reward=await availableReferralReward(ctx,account);return {friend,reward:reward?{id:reward._id,expiresAt:reward.expiresAt}:null};
}});
export const backfill=internalMutation({args:{cursor:v.optional(v.union(v.string(),v.null()))},handler:async(ctx,{cursor})=>{
 const page=await ctx.db.query("accounts").paginate({numItems:100,cursor:cursor??null});let assigned=0;
 for(const a of page.page)if(!a.referralCode){await ensureReferralCode(ctx,a._id);assigned++;}
 if(!page.isDone)await ctx.scheduler.runAfter(0,internal.referrals.backfill,{cursor:page.continueCursor});return {assigned,done:page.isDone};
}});
export const expire=internalMutation({args:{},handler:async ctx=>{
 const rows=await ctx.db.query("referral_rewards").withIndex("by_state_expiry",q=>q.eq("state","available").lte("expiresAt",Date.now())).collect();let expired=0;
 for(const r of rows){const b=r.reservedBookingId?await ctx.db.get(r.reservedBookingId):null;if(b?.status==="pending_payment"&&b._creationTime<r.expiresAt)continue;await ctx.db.patch(r._id,{state:"expired",reservedBookingId:undefined});expired++;}return {expired};
}});
/** Provider reads attest payment identity. No card number is stored. */
export const paymentContext=internalQuery({args:{bookingId:v.id("bookings")},handler:async(ctx,{bookingId})=>{
 const booking=await ctx.db.get(bookingId);if(!booking||booking.status==="pending_payment"||booking.status==="cancelled")return null;
 const account=await ctx.db.query("accounts").withIndex("by_email",q=>q.eq("email",booking.guestEmail??"")).first();if(!account)return null;
 const redemption=await ctx.db.query("referral_redemptions").withIndex("by_booking",q=>q.eq("bookingId",bookingId)).first();
 const referrer=redemption?await ctx.db.get(redemption.referrerAccountId):null;
 return {booking,account,redemption,referrer};
}});
export const recordPayment=internalMutation({args:{bookingId:v.id("bookings"),paymentHash:v.string()},handler:async(ctx,{bookingId,paymentHash})=>{
 const b=await ctx.db.get(bookingId);if(!b||!["confirmed","active","returned"].includes(b.status))return;
 const account=await ctx.db.query("accounts").withIndex("by_email",q=>q.eq("email",b.guestEmail??"")).first();if(!account)return;
 await ctx.db.patch(b._id,{referralPaymentHash:paymentHash});
 await ctx.db.patch(account._id,{paymentIdentityHashes:[...new Set([...(account.paymentIdentityHashes??[]),paymentHash])].slice(-20)});
 const r=await ctx.db.query("referral_redemptions").withIndex("by_booking",q=>q.eq("bookingId",b._id)).first();if(!r||r.state==="void")return;
 const referrer=await ctx.db.get(r.referrerAccountId);
 if(!referrer||referrer._id===account._id||referrer.paymentIdentityHashes?.includes(paymentHash)){
  await ctx.db.patch(r._id,{state:"void",rejectionReason:"Self-referral or shared payment identity."});return;
 }
 await ctx.db.patch(r._id,{paymentHash});
}});
export const qualify=internalMutation({args:{bookingId:v.id("bookings")},handler:async(ctx,{bookingId})=>{
 const b=await ctx.db.get(bookingId),r=await ctx.db.query("referral_redemptions").withIndex("by_booking",q=>q.eq("bookingId",bookingId)).first();
 if(!b||!r||r.state!=="paid"||b.status!=="returned"||b.cancellationDecision||!b.returnStatement||!b.pickedUpAt||b.idVerifyStatus!=="verified"||!r.paymentHash)return null;
 const account=await ctx.db.get(r.referrerAccountId);if(!account||account.paymentIdentityHashes?.includes(r.paymentHash)){await ctx.db.patch(r._id,{state:"void",rejectionReason:"Shared payment identity."});return null;}
 const rewardId=await issueReferralReward(ctx,r);await ctx.db.patch(r._id,{state:"qualified",qualifiedAt:Date.now()});return {rewardId};
}});
export const reconcile=internalMutation({args:{},handler:async ctx=>{
 const rows=await ctx.db.query("referral_redemptions").withIndex("by_state",q=>q.eq("state","paid")).collect();
 for(const r of rows)await ctx.scheduler.runAfter(0,internal.referralPayments.attest,{bookingId:r.bookingId});return {checked:rows.length};
}});

export const rememberIdentity=internalMutation({args:{accountId:v.id("accounts"),paymentHash:v.string()},handler:async(ctx,{accountId,paymentHash})=>{const a=await ctx.db.get(accountId);if(a)await ctx.db.patch(a._id,{paymentIdentityHashes:[...new Set([...(a.paymentIdentityHashes??[]),paymentHash])].slice(-20)});}});
