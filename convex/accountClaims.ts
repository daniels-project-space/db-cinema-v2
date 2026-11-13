import { ensureReferralCode } from "./lib/referrals";
import { internalMutation, internalQuery } from "./_generated/server";
import { internal } from "./_generated/api";
import { v,ConvexError } from "convex/values";
import { bump } from "./rateLimit";
import { belongsToRentalAccount } from "./lib/rentalAccount";
import { linkVerificationCopies } from "./lib/verificationOwnership";
/** Account bootstrap is allowed only when a paid booking has a complete,
 * self-consistent signed Terms + Privacy snapshot. This records the renter's
 * actual checkout acceptance; it never upgrades a historic agreement. */
function acceptedAccountTerms(booking: any) {
 const acceptedAt=booking.agreementSignedAt,docs=booking.agreementDocs;
 if(!Number.isSafeInteger(acceptedAt)||acceptedAt<=0||!Array.isArray(docs)||!booking.agreementName?.trim())return null;
 let snapshot:any;
 try{snapshot=JSON.parse(booking.agreementSnapshot??"")}catch{return null}
 if(snapshot?.format!==1||snapshot.acceptedAt!==acceptedAt||snapshot.signer!==booking.agreementName.trim()||
   snapshot.particulars?.timeZone!=="Europe/London"||!Array.isArray(snapshot.particulars?.lineItems)||!Array.isArray(snapshot.documents))return null;
 const unique=(kind:string)=>{const matches=docs.filter((doc:any)=>doc?.kind===kind);return matches.length===1&&typeof matches[0].version==="string"&&matches[0].version.length>0?matches[0]:null};
 const terms=unique("terms"),rental=unique("rental-agreement"),privacy=unique("privacy");
 if(!terms||!rental||!privacy||terms.version!==rental.version||snapshot.version!==rental.version)return null;
 if(snapshot.documents.length!==docs.length||docs.some((doc:any)=>snapshot.documents.filter((saved:any)=>saved?.kind===doc?.kind&&saved?.version===doc?.version).length!==1))return null;
 return {accountTermsVersion:terms.version,accountTermsAcceptedAt:acceptedAt,privacyNoticeVersion:privacy.version,privacyNoticeAcknowledgedAt:acceptedAt};
}
/** Runs inside the attested paid-booking transaction, independently of email delivery. */
export async function ensurePaidBookingAccount(ctx: any, booking: any) {
 if(!["confirmed","active"].includes(booking.status))return null;
 const email=booking.guestEmail?.trim().toLowerCase();if(!email)return null;
 let account=booking.accountId?await ctx.db.get(booking.accountId):await ctx.db.query("accounts").withIndex("by_email",(q:any)=>q.eq("email",email)).unique();
 if(booking.accountId&&!account)throw Error("The rental account no longer exists.");
 if(account?.blockedAt!=null)return null;
 const customer=booking.customerId?await ctx.db.get(booking.customerId):null;
 const details={name:booking.guestName??customer?.name??booking.agreementName,phone:booking.guestPhone??customer?.phone,address:booking.billingAddress??booking.address};
 if(!account){
  const acceptance=acceptedAccountTerms(booking);
  if(!acceptance)return null;
  const id=await ctx.db.insert("accounts",{email,...details,...acceptance,emailVerificationRequired:true,firstRentalPaidAt:Date.now(),createdAt:Date.now()});
  await ensureReferralCode(ctx,id);account=await ctx.db.get(id);
  await ctx.db.patch(booking._id,{accountCreatedAtCheckout:true});
 }else{
  // A checkout seed has no login identity yet. Never overwrite an established
  // profile or confer email ownership from a successful card payment.
  const seeded=account.checkoutSeedHash&&!account.hash&&!account.googleId&&!account.emailVerifiedAt&&!account.firstRentalPaidAt;
  await ctx.db.patch(account._id,{...(!account.firstRentalPaidAt?{firstRentalPaidAt:Date.now()}:{}),...(seeded?details:{})});
  if(seeded)await ctx.db.patch(booking._id,{accountCreatedAtCheckout:true});
  account=await ctx.db.get(account._id);
 }
 await ctx.db.patch(booking._id,{accountId:account._id});
 await linkVerificationCopies(ctx,booking._id,account._id);
 return account;
}
export const prepareSignup=internalMutation({args:{email:v.string(),credentialHash:v.string(),secretHash:v.string()},handler:async(ctx,a)=>{
 const account=await ctx.db.query("accounts").withIndex("by_email",q=>q.eq("email",a.email)).unique();
 if(!account||account.blockedAt!=null||!account.emailVerificationRequired||account.emailVerifiedAt||account.hash!==a.credentialHash)return null;
 if(!(await bump(ctx,`account-signup:${a.email}`,3,3600000)).allowed||!(await bump(ctx,"account-signup:global",120,3600000)).allowed)return null;
 await ctx.db.insert("account_access_links",{accountId:account._id,purpose:"signup",credentialHash:a.credentialHash,secretHash:a.secretHash,createdAt:Date.now(),expiresAt:Date.now()+3600000});return {email:account.email};
}});
export const prepareSignIn=internalMutation({args:{email:v.string(),secretHash:v.string()},handler:async(ctx,a)=>{
 const email=a.email.trim().toLowerCase();
 if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||email.length>254)return null;
 const perEmail=await bump(ctx,`account-signin:${email}`,3,3600000);
 if(!perEmail.allowed)return null;
 const global=await bump(ctx,"account-signin:global",120,3600000);if(!global.allowed)return null;
 const account=await ctx.db.query("accounts").withIndex("by_email",q=>q.eq("email",email)).unique();if(!account||account.blockedAt!=null)return null;
 const links=await ctx.db.query("account_access_links").withIndex("by_account",q=>q.eq("accountId",account._id)).collect();
 for(const link of links)if(!link.bookingId&&!link.usedAt&&link.expiresAt>Date.now())await ctx.db.patch(link._id,{expiresAt:Date.now()});
 await ctx.db.insert("account_access_links",{accountId:account._id,secretHash:a.secretHash,createdAt:Date.now(),expiresAt:Date.now()+15*60000});
 return {email};
}});
export const prepare=internalMutation({args:{bookingId:v.id("bookings"),secretHash:v.string()},handler:async(ctx,a)=>{
 const b=await ctx.db.get(a.bookingId);if(!b||!["confirmed","active"].includes(b.status)||b.accountAccessEmailSentAt)return null;
 if((b.accountAccessEmailLeaseUntil??0)>Date.now()||(b.accountAccessEmailRetryAt??0)>Date.now())return null;
 const email=b.guestEmail?.trim().toLowerCase();if(!email)return null;
 const account=await ensurePaidBookingAccount(ctx,b);if(!account)return null;
 if(account!.blockedAt!=null)return null;
 const previous=await ctx.db.query("account_access_links").withIndex("by_booking",q=>q.eq("bookingId",b._id)).collect();for(const link of previous)if(!link.usedAt)await ctx.db.patch(link._id,{expiresAt:Date.now()});
 const claimId=await ctx.db.insert("account_access_links",{accountId:account!._id,bookingId:b._id,secretHash:a.secretHash,expiresAt:Date.now()+3600000,createdAt:Date.now()});
 await ctx.db.patch(b._id,{accountAccessEmailClaimId:claimId,accountAccessEmailLeaseUntil:Date.now()+5*60000,accountAccessEmailRetryAt:Date.now()+5*60000,accountAccessEmailAttempts:(b.accountAccessEmailAttempts??0)+1});
 return{email:account.email,bookingId:b._id,claimId};
}});
export const sent=internalMutation({args:{bookingId:v.id("bookings"),claimId:v.id("account_access_links")},handler:async(ctx,{bookingId,claimId})=>{
 const b=await ctx.db.get(bookingId);if(b?.accountAccessEmailClaimId===claimId)await ctx.db.patch(bookingId,{accountAccessEmailSentAt:Date.now(),accountAccessEmailRetryAt:undefined,accountAccessEmailLeaseUntil:undefined});
}});
export const failed=internalMutation({args:{bookingId:v.id("bookings"),claimId:v.id("account_access_links")},handler:async(ctx,{bookingId,claimId})=>{
 const b=await ctx.db.get(bookingId);if(!b||b.accountAccessEmailSentAt||b.accountAccessEmailClaimId!==claimId)return;
 await ctx.db.patch(bookingId,{accountAccessEmailLeaseUntil:undefined,accountAccessEmailRetryAt:Date.now()+Math.min(30,2**Math.min(10,(b.accountAccessEmailAttempts??1)-1))*60000});
}});
export const dueRentalAccess=internalQuery({args:{},handler:async(ctx)=>{
 const rows=await ctx.db.query("bookings").withIndex("by_account_access_retry",q=>q.gt("accountAccessEmailRetryAt",0).lte("accountAccessEmailRetryAt",Date.now())).take(100);
 return rows.filter(b=>!b.accountAccessEmailSentAt&&["confirmed","active"].includes(b.status)&&(b.accountAccessEmailLeaseUntil??0)<=Date.now()).map(b=>b._id);
}});
export const exchange=internalMutation({args:{secretHash:v.string(),sessionToken:v.string()},handler:async(ctx,a)=>{
 const link=await ctx.db.query("account_access_links").withIndex("by_hash",q=>q.eq("secretHash",a.secretHash)).unique();if(!link||link.usedAt||link.expiresAt<=Date.now())throw new ConvexError({code:"ACCESS_LINK_EXPIRED",message:"This sign-in link has expired or has already been used."});
 const account=await ctx.db.get(link.accountId);if(!account)throw new ConvexError({code:"ACCESS_LINK_INVALID",message:"This sign-in link is no longer valid."});
 if(account.blockedAt!=null)throw new ConvexError({code:"ACCOUNT_BLOCKED",message:"Please contact DB Cinema Rentals for help with your account."});
 if(link.bookingId&&!belongsToRentalAccount(await ctx.db.get(link.bookingId),account))throw new ConvexError({code:"ACCESS_LINK_INVALID",message:"This sign-in link is no longer valid."});
 if(link.purpose==="signup"&&(account.emailVerifiedAt||account.hash!==link.credentialHash))throw new ConvexError({code:"ACCESS_LINK_EXPIRED",message:"This signup link is no longer valid. Request a new sign-in link."});
 if(account.emailVerificationRequired&&!account.emailVerifiedAt){
  // A rental/sign-in email proves ownership but must not activate a password
  // registered by somebody else before the real email owner arrived.
  if(link.purpose!=="signup")await ctx.db.patch(account._id,{hash:undefined,salt:undefined});
  const sessions=await ctx.db.query("sessions").withIndex("by_account",q=>q.eq("accountId",account._id)).collect();for(const session of sessions)await ctx.db.delete(session._id);
 }
 const needsVerificationRecovery=!account.emailVerifiedAt||account.emailVerificationRequired;
 await ctx.db.patch(account._id,{emailVerifiedAt:Date.now(),emailVerificationRequired:false});
 if(needsVerificationRecovery)await ctx.scheduler.runAfter(0,internal.verificationArchive.linkVerifiedAccount,{accountId:account._id,cursor:null});
 await ctx.db.patch(link._id,{usedAt:Date.now()});await ctx.db.insert("sessions",{accountId:account._id,token:a.sessionToken,createdAt:Date.now(),expiresAt:Date.now()+90*86400000});return{token:a.sessionToken,bookingId:link.bookingId};
}});
