import { internalMutation, query } from "./_generated/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { accountForToken } from "./lib/rentalChat";
import { bump } from "./rateLimit";
import { assertVerificationArchive } from "./verificationArchive";
import { saveAccountDiditVerification, verificationDetail, verificationReuseIdentityDigest, VERIFICATION_REUSE_DAYS } from "./lib/verificationReuse";
import { accountVerificationReady } from "./lib/accountVerificationReady";

function profileMatches(account:any,booking:any) {
  return !!verificationDetail(account.name) && !!verificationDetail(account.address) && verificationDetail(account.name)===verificationDetail(booking.agreementName) && verificationDetail(account.address)===verificationDetail(booking.billingAddress);
}
async function eligible(ctx:any,account:any,booking:any,requireProfile=true) {
  if(process.env.VERIFICATION_ARCHIVE_REUSE_ENABLED!=="true" || !account || account.blockedAt!=null || account.emailVerificationRequired && !account.emailVerifiedAt || !booking || booking.accountId!==account._id || booking.accountAccessRequired!==true ||
    !booking.diditSessionId || booking.verificationReuseBlockedSessionId===booking.diditSessionId || booking.idVerificationSource!=="didit" || booking.idVerifyStatus!=="verified" ||
    !["identity","selfie","address"].every(key=>booking.verificationChecks?.[key]==="approved") || !booking.renterPersonKey || !booking.idVerifiedAt || !booking.documentExpiresAt ||
    Math.min(booking.idVerifiedAt+VERIFICATION_REUSE_DAYS*86400000,booking.documentExpiresAt)<=Date.now())return false;
  const email=(account.email??"").trim().toLowerCase();
  if(!email || email!==(booking.guestEmail??"").trim().toLowerCase() || !verificationDetail(booking.agreementName) || !verificationDetail(booking.billingAddress) ||
    requireProfile && !profileMatches(account,booking))return false;
  try{return !!await assertVerificationArchive(ctx,booking)}catch{return false}
}

export const available=query({args:{token:v.string(),bookingId:v.id("bookings")},handler:async(ctx,args)=>{
  const account=await accountForToken(ctx,args.token,true),booking=await ctx.db.get(args.bookingId);
  if(!await eligible(ctx,account,booking,false) || await accountVerificationReady(ctx,account))return null;
  return profileMatches(account,booking) ? "available" : "profile";
}});

export const prepare=internalMutation({args:{token:v.string(),bookingId:v.id("bookings"),secretHash:v.string()},handler:async(ctx,args)=>{
  const account=await accountForToken(ctx,args.token,true),booking=await ctx.db.get(args.bookingId);
  if(!await eligible(ctx,account,booking))throw Error("This verification cannot currently be linked. Contact the team for help.");
  if(!(await bump(ctx,`verification-reuse-claim:${account!._id}`,3,3600000)).allowed || !(await bump(ctx,"verification-reuse-claim:global",120,3600000)).allowed)throw Error("Please wait before requesting another confirmation.");
  const recipientEmail=account!.email.trim().toLowerCase(),now=Date.now();
  const claimId=await ctx.db.insert("verification_reuse_claims",{accountId:account!._id,bookingId:booking!._id,recipientEmail,sessionId:booking!.diditSessionId!,eventId:booking!.diditEventId,eventAt:booking!.diditEventAt,manualDecisionAt:booking!.diditManualDecisionAt,verifiedAt:booking!.idVerifiedAt!,documentExpiresAt:booking!.documentExpiresAt!,personKey:booking!.renterPersonKey!,identityDigest:await verificationReuseIdentityDigest(booking,recipientEmail),secretHash:args.secretHash,state:"prepared",createdAt:now,expiresAt:now+3600000});
  return {claimId,recipientEmail};
}});

export const markDelivery=internalMutation({args:{claimId:v.id("verification_reuse_claims"),sent:v.boolean()},handler:async(ctx,args)=>{
  const claim=await ctx.db.get(args.claimId);if(!claim||claim.state!=="prepared")return;
  await ctx.db.patch(claim._id,{state:args.sent?"sent":"failed"});
}});

export const redeem=internalMutation({args:{token:v.string(),secretHash:v.string()},handler:async(ctx,args)=>{
  const account=await accountForToken(ctx,args.token,true),claim=await ctx.db.query("verification_reuse_claims").withIndex("by_hash",q=>q.eq("secretHash",args.secretHash)).unique();
  if(!account||!claim||claim.accountId!==account._id||claim.expiresAt<=Date.now()||!["sent","used"].includes(claim.state)||claim.recipientEmail!==account.email.trim().toLowerCase())throw Error("This confirmation is invalid or expired. Request a new link.");
  const booking=await ctx.db.get(claim.bookingId);
  if(!booking||booking.diditSessionId!==claim.sessionId||(booking.diditEventId??null)!==(claim.eventId??null)||(booking.diditEventAt??null)!==(claim.eventAt??null)||(booking.diditManualDecisionAt??null)!==(claim.manualDecisionAt??null)||booking.idVerifiedAt!==claim.verifiedAt||booking.documentExpiresAt!==claim.documentExpiresAt||booking.renterPersonKey!==claim.personKey||await verificationReuseIdentityDigest(booking,account.email)!==claim.identityDigest||!await eligible(ctx,account,booking))throw Error("This verification changed or its documents are unavailable. Contact the team.");
  if(claim.state==="used"){
    if(account.rentalVerification?.sourceBookingId!==booking._id || !await accountVerificationReady(ctx,account))throw Error("This confirmation has already been used. Request a new link.");
    return {ok:true as const};
  }
  const bound={...booking,verificationReuseOwnershipAccountId:account._id,verificationReuseOwnershipSessionId:claim.sessionId,verificationReuseOwnershipDigest:claim.identityDigest};
  if(!await saveAccountDiditVerification(ctx,bound,booking.idVerifiedAt!,booking.documentExpiresAt,booking.verificationChecks,booking.renterPersonKey))throw Error("This verification could not be linked. Contact the team.");
  await ctx.db.patch(booking._id,{verificationReuseOwnershipAccountId:account._id,verificationReuseOwnershipSessionId:claim.sessionId,verificationReuseOwnershipDigest:claim.identityDigest});
  await ctx.db.patch(claim._id,{state:"used",usedAt:Date.now()});
  return {ok:true as const};
}});

export const purgeExpired=internalMutation({args:{},handler:async(ctx)=>{
  const rows=await ctx.db.query("verification_reuse_claims").withIndex("by_expiry",q=>q.lte("expiresAt",Date.now())).take(50);
  for(const row of rows)await ctx.db.delete(row._id);
  if(rows.length===50)await ctx.scheduler.runAfter(0,internal.verificationReuseClaimState.purgeExpired,{});
}});
