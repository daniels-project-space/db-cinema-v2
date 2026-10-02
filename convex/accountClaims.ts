import { ensureReferralCode } from "./lib/referrals";
import { internalMutation } from "./_generated/server";
import { v } from "convex/values";
import { bump } from "./rateLimit";
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
 const email=b.guestEmail?.trim().toLowerCase();if(!email)return null;
 let account=await ctx.db.query("accounts").withIndex("by_email",q=>q.eq("email",email)).unique();
 if(!account){const id=await ctx.db.insert("accounts",{email,name:b.agreementName,emailVerificationRequired:true,firstRentalPaidAt:Date.now(),createdAt:Date.now()});await ensureReferralCode(ctx,id);account=await ctx.db.get(id);await ctx.db.patch(b._id,{accountCreatedAtCheckout:true});}
 if(account!.blockedAt!=null)return null;
 const previous=await ctx.db.query("account_access_links").withIndex("by_booking",q=>q.eq("bookingId",b._id)).collect();for(const link of previous)if(!link.usedAt)await ctx.db.patch(link._id,{expiresAt:Date.now()});
 await ctx.db.insert("account_access_links",{accountId:account!._id,bookingId:b._id,secretHash:a.secretHash,expiresAt:Date.now()+3600000,createdAt:Date.now()});return{email,bookingId:b._id};
}});
export const sent=internalMutation({args:{bookingId:v.id("bookings")},handler:async(ctx,{bookingId})=>{const b=await ctx.db.get(bookingId);if(b)await ctx.db.patch(bookingId,{accountAccessEmailSentAt:Date.now()});}});
export const exchange=internalMutation({args:{secretHash:v.string(),sessionToken:v.string()},handler:async(ctx,a)=>{
 const link=await ctx.db.query("account_access_links").withIndex("by_hash",q=>q.eq("secretHash",a.secretHash)).unique();if(!link||link.usedAt||link.expiresAt<=Date.now())throw Error("This sign-in link has expired or has already been used.");
 const account=await ctx.db.get(link.accountId);if(!account)throw Error("Account no longer exists.");
 if(account.blockedAt!=null)throw Error("This account is blocked. Contact DB Cinema Rentals.");
 if(link.purpose==="signup"&&(account.emailVerifiedAt||account.hash!==link.credentialHash))throw Error("This signup link is no longer valid. Request a new sign-in link.");
 if(account.emailVerificationRequired&&!account.emailVerifiedAt){
  // A rental/sign-in email proves ownership but must not activate a password
  // registered by somebody else before the real email owner arrived.
  if(link.purpose!=="signup")await ctx.db.patch(account._id,{hash:undefined,salt:undefined});
  const sessions=await ctx.db.query("sessions").withIndex("by_account",q=>q.eq("accountId",account._id)).collect();for(const session of sessions)await ctx.db.delete(session._id);
 }
 await ctx.db.patch(account._id,{emailVerifiedAt:Date.now(),emailVerificationRequired:false});
 await ctx.db.patch(link._id,{usedAt:Date.now()});await ctx.db.insert("sessions",{accountId:account._id,token:a.sessionToken,createdAt:Date.now(),expiresAt:Date.now()+90*86400000});return{token:a.sessionToken,bookingId:link.bookingId};
}});
