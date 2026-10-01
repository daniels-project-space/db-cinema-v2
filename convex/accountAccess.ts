"use node";
import { createHash,randomBytes } from "node:crypto";
import { internalAction,action } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import { sendMail } from "./lib/mailer";
const hash=(secret:string)=>createHash("sha256").update(secret).digest("hex");
export const sendForSignup=internalAction({args:{email:v.string(),credentialHash:v.string()},handler:async(ctx,a):Promise<void>=>{
 const secret=randomBytes(32).toString("base64url"),claim:any=await ctx.runMutation(internal.accountClaims.prepareSignup,{...a,secretHash:hash(secret)});if(!claim)return;
 const app=new URL(process.env.APP_URL??"https://dbcinemarentals.com").origin;
 if(!await sendMail({to:claim.email,subject:"Confirm your DB Cinema Rentals account",html:`<h2>Confirm your account</h2><p>You requested a new DB Cinema Rentals account. Confirm your email to activate the password you chose and open your rental workspace.</p><p><a href="${app}/account/access#${secret}">Confirm account creation</a></p><p>This link expires in one hour and works once. If you didn’t create this account, don’t click this link. You can ignore this email.</p>`}))throw Error("Signup confirmation email could not be delivered. Request a sign-in link to recover access.");
}});
export const sendForRental=internalAction({args:{bookingId:v.id("bookings")},handler:async(ctx,a):Promise<void>=>{
 const secret=randomBytes(32).toString("base64url"),claim:any=await ctx.runMutation(internal.accountClaims.prepare,{...a,secretHash:hash(secret)});if(!claim)return;
 const app=new URL(process.env.APP_URL??"https://dbcinemarentals.com").origin;
 const ok=await sendMail({to:claim.email,subject:"Your DB Cinema rental conversation",html:`<h2>Your rental, all in one place</h2><p>Your DB Cinema account gives you a persistent rental conversation, saved kits and eligible repeat-rental benefits. Your rental payment does not sign you in automatically: use this private email link to prove the account is yours.</p><p><a href="${app}/account/access#${encodeURIComponent(secret)}">Open your rental conversation</a></p><p>This link works once and expires in one hour. Don’t forward it. If you didn’t make this rental, contact DB Cinema Rentals.</p>`});
 if(!ok)throw Error("Rental account access email could not be delivered.");await ctx.runMutation(internal.accountClaims.sent,a);
}});
export const requestSignIn=action({args:{email:v.string()},handler:async(ctx,{email}):Promise<{ok:true}>=>{
 const secret=randomBytes(32).toString("base64url"),claim:any=await ctx.runMutation(internal.accountClaims.prepareSignIn,{email,secretHash:hash(secret)});
 if(claim)await ctx.scheduler.runAfter(0,internal.accountAccess.sendSignIn,{email:claim.email,secret});
 return {ok:true};
}});
export const sendSignIn=internalAction({args:{email:v.string(),secret:v.string()},handler:async(_ctx,a):Promise<void>=>{
 const app=new URL(process.env.APP_URL??"https://dbcinemarentals.com").origin;
 const ok=await sendMail({to:a.email,subject:"Sign in to DB Cinema Rentals",html:`<h2>Your rental workspace</h2><p><a href="${app}/account/access#${encodeURIComponent(a.secret)}">Sign in securely</a></p><p>This private link works once and expires in 15 minutes. Don’t forward it. If you didn’t request this email, ignore it.</p>`});
 if(!ok)throw Error("Account sign-in email could not be delivered.");
}});
export const exchange=action({args:{secret:v.string()},handler:async(ctx,{secret}):Promise<{token:string;bookingId?:string}>=>{
 if(!/^[A-Za-z0-9_-]{43}$/.test(secret))throw Error("Invalid sign-in link.");return ctx.runMutation(internal.accountClaims.exchange,{secretHash:hash(secret),sessionToken:randomBytes(32).toString("hex")});
}});
