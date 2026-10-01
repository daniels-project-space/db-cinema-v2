"use node";
import { createHmac,timingSafeEqual } from "node:crypto";
import { action,internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import { sendMail } from "./lib/mailer";
function signature(payload:string){const secret=process.env.FILM_FUND_EMAIL_SECRET;if(!secret)throw Error("Email signing is not configured.");return createHmac("sha256",secret).update(`dbc-referral-unsubscribe-v1:${payload}`).digest("base64url");}
export function unsubscribeToken(email:string){const p=Buffer.from(email).toString("base64url");return `${p}.${signature(p)}`;}
export function unsubscribeEmail(token:string){const [p,s,...rest]=token.split(".");if(rest.length||!p||p.length>400||!/^[A-Za-z0-9_-]+$/.test(p)||s?.length!==43)throw Error("Invalid unsubscribe link.");if(!timingSafeEqual(Buffer.from(signature(p)),Buffer.from(s)))throw Error("Invalid unsubscribe link.");return Buffer.from(p,"base64url").toString("utf8");}
export const unsubscribe=action({args:{token:v.string()},handler:async(ctx,{token}):Promise<{unsubscribed:boolean}>=>ctx.runMutation(internal.referralCampaigns.unsubscribe,{email:unsubscribeEmail(token)})});
export const sendCampaign=internalAction({args:{},handler:async(ctx):Promise<{sent:number}>=>{
 const ids:any[]=await ctx.runQuery(internal.referralCampaigns.due,{});let sent=0;
 for(const id of ids){const c:any=await ctx.runMutation(internal.referralCampaigns.claim,{id});if(!c)continue;let ok=false;
  try{const app=new URL(process.env.APP_URL??"https://dbcinemarentals.com").origin,token=unsubscribeToken(c.email);
   ok=await sendMail({to:c.email,subject:"Pass the camera on · £10 for a friend, 40% for your next film",html:`<h2>The next great film starts with a friend.</h2><p>Your personal referral code: <strong>${c.code}</strong>.</p><p>They get £10 off their first rental. After their paid, verified rental is collected, completed and returned, you receive one single-use 40% rental voucher, valid for three calendar months.</p><p>Only one reward per account. Rental charges only; no stacking with offers, membership savings or earned credit. Normal upfront security and the full hold apply. Refund credit can pay the remaining rental balance. No self-referrals or shared payment methods.</p><p><a href="${app}/?ref=${c.code}">Share your rental link</a> · <a href="${app}/account">See your referral</a> · <a href="${app}/legal/referrals">Terms</a></p><p>You opted into DB Cinema offers. <a href="${app}/referrals/unsubscribe#${token}">Unsubscribe from offers</a>.</p>`});
  }catch{}
  await ctx.runMutation(internal.referralCampaigns.finish,{id:c.id,leaseUntil:c.leaseUntil,sent:ok});if(ok)sent++;
 }
 return {sent};
}});
