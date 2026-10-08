"use node";
import {rentalEmail} from "../shared/rentalEmail";
import { createHash,randomBytes } from "node:crypto";
import { internalAction,action } from "./_generated/server";
import { internal } from "./_generated/api";
import { v,ConvexError } from "convex/values";
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
 const ok=await sendMail({to:claim.email,subject:"Complete your DB Cinema rental checks",html:rentalEmail({title:"Your private rental workspace",preview:"Sign in securely to complete your rental checks and follow your request.",url:`${app}/account/access?next=verification#${encodeURIComponent(secret)}`,button:"Open my rental checks",body:"<p>Your payment has been received. Use this private sign-in link to complete your checks, follow verification and talk to our team.</p><p>The link works once and expires in one hour. Don’t forward it. Equipment handover requires completed checks and approval.</p>"})});
 if(!ok){await ctx.runMutation(internal.accountClaims.failed,{bookingId:a.bookingId,claimId:claim.claimId});throw Error("Rental account access email could not be delivered; it is queued for retry.");}
 await ctx.runMutation(internal.accountClaims.sent,{bookingId:a.bookingId,claimId:claim.claimId});
}});
export const retryRentalAccess=internalAction({args:{},handler:async(ctx):Promise<void>=>{
 const due=await ctx.runQuery(internal.accountClaims.dueRentalAccess,{});
 for(const bookingId of due)await ctx.scheduler.runAfter(0,internal.accountAccess.sendForRental,{bookingId});
}});
export const requestSignIn=action({args:{email:v.string()},handler:async(ctx,{email}):Promise<{ok:true}>=>{
 const secret=randomBytes(32).toString("base64url"),claim:any=await ctx.runMutation(internal.accountClaims.prepareSignIn,{email,secretHash:hash(secret)});
 if(claim)await ctx.scheduler.runAfter(0,internal.accountAccess.sendSignIn,{email:claim.email,secret});
 return {ok:true};
}});
export const sendSignIn=internalAction({args:{email:v.string(),secret:v.string(),attempt:v.optional(v.number())},handler:async(ctx,a):Promise<void>=>{
 const app=new URL(process.env.APP_URL??"https://dbcinemarentals.com").origin;
 const ok=await sendMail({to:a.email,subject:"Sign in to DB Cinema Rentals",html:`<h2>Your rental workspace</h2><p><a href="${app}/account/access#${encodeURIComponent(a.secret)}">Sign in securely</a></p><p>This private link works once and expires in 15 minutes. Don’t forward it. If you didn’t request this email, ignore it.</p>`});
 if(!ok){
  const attempt=a.attempt??0;
  if(attempt<2){await ctx.scheduler.runAfter((attempt+1)*60000,internal.accountAccess.sendSignIn,{...a,attempt:attempt+1});return;}
  throw Error("Account sign-in email could not be delivered.");
 }
}});
export const exchange=action({args:{secret:v.string()},handler:async(ctx,{secret}):Promise<{token:string;bookingId?:string}>=>{
 if(!/^[A-Za-z0-9_-]{43}$/.test(secret))throw new ConvexError({code:"ACCESS_LINK_INVALID",message:"Invalid sign-in link."});return ctx.runMutation(internal.accountClaims.exchange,{secretHash:hash(secret),sessionToken:randomBytes(32).toString("hex")});
}});
