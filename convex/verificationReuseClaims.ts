"use node";
import { action } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import { createHash, randomBytes } from "node:crypto";
import { sendMail } from "./lib/mailer";

const hash=(secret:string)=>createHash("sha256").update(secret).digest("hex");
export const request=action({args:{token:v.string(),bookingId:v.id("bookings")},handler:async(ctx,args):Promise<{ok:true}>=>{
  const secret=randomBytes(32).toString("base64url");
  const claim=await ctx.runMutation(internal.verificationReuseClaimState.prepare,{...args,secretHash:hash(secret)});
  const origin=new URL(process.env.APP_URL??"https://dbcinemarentals.com").origin;
  let sent=false;
  try {sent=await sendMail({to:claim.recipientEmail,subject:"Confirm reuse of your verification",html:`<h2>Confirm verification reuse</h2><p>You requested to link an approved rental verification to your account. Sign in to the same account, then open this one-time link within one hour.</p><p><a href="${origin}/account/verification-claim#${encodeURIComponent(secret)}">Confirm verification reuse</a></p><p>If you did not request this, ignore this email.</p>`});}
  finally {await ctx.runMutation(internal.verificationReuseClaimState.markDelivery,{claimId:claim.claimId,sent});}
  if(!sent)throw Error("The confirmation could not be sent. Please try again later.");
  return {ok:true};
}});
export const redeem=action({args:{token:v.string(),secret:v.string()},handler:async(ctx,args):Promise<{ok:true}>=>{
  if(!/^[A-Za-z0-9_-]{43}$/.test(args.secret))throw Error("This confirmation is invalid or expired. Request a new link.");
  return await ctx.runMutation(internal.verificationReuseClaimState.redeem,{token:args.token,secretHash:hash(args.secret)});
}});
