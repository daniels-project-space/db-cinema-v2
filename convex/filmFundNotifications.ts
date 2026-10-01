"use node";
import { createHmac,timingSafeEqual } from "node:crypto";
import { action,internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import { sendMail } from "./lib/mailer";
function signature(payload:string){const secret=process.env.FILM_FUND_EMAIL_SECRET;if(!secret)throw Error("Film Fund email signing is not configured.");return createHmac("sha256",secret).update(`dbc-film-fund-unsubscribe-v1:${payload}`).digest("base64url");}
export function notificationToken(email:string){const payload=Buffer.from(email).toString("base64url");return `${payload}.${signature(payload)}`;}
export function notificationEmail(token:string){const [payload,sig,...rest]=token.split('.');if(rest.length||!payload||payload.length>400||!/^[A-Za-z0-9_-]+$/.test(payload)||!sig||sig.length!==43)throw Error("Invalid unsubscribe link.");const expected=signature(payload);if(!timingSafeEqual(Buffer.from(expected),Buffer.from(sig)))throw Error("Invalid unsubscribe link.");return Buffer.from(payload,'base64url').toString('utf8');}
export const confirm=internalAction({args:{email:v.string()},handler:async(ctx,a):Promise<void>=>{
 if(!await ctx.runQuery(internal.filmFund.notificationActive,a))return;
 const app=new URL(process.env.APP_URL??"https://dbcinemarentals.com").origin,token=notificationToken(a.email);
 const schedule:any=await ctx.runQuery(internal.filmFund.notificationSchedule,{}),open=schedule.rounds.find((r:any)=>r.state==="open"&&r.opensAt<=Date.now()&&r.deadline>=Date.now());
 const status=open?`Applications for ${open.name} are open until ${new Date(open.deadline).toLocaleDateString("en-GB",{timeZone:"Europe/London",day:"numeric",month:"long",year:"numeric"})}.`:'Applications and entry payments are still Coming soon.';
 const ok=await sendMail({to:a.email,subject:"You’re on the DB Cinema Film Fund list",html:`<h2>Your next film starts with a possibility.</h2><p>You’re signed up for the Film Fund opening announcement and application dates. ${status} No entry has been submitted or purchased.</p><p><a href="${app}/film-fund">Explore the fund</a></p><p><a href="${app}/film-fund/unsubscribe#${token}">Unsubscribe from Film Fund updates</a></p>`});if(!ok)throw Error("Film Fund signup email could not be delivered.");
}});
export const processOpeningAnnouncements=internalAction({args:{},handler:async(ctx):Promise<{sent:number}>=>{
 if(process.env.FILM_FUND_OPENING_EMAILS_ENABLED==="false")return {sent:0};
 const due:any[]=await ctx.runQuery(internal.filmFundAnnouncements.due,{});let sent=0;
 for(const id of due){
  const claim:any=await ctx.runMutation(internal.filmFundAnnouncements.claim,{id});if(!claim)continue;
  let ok=false;
  try{
   if(await ctx.runQuery(internal.filmFund.notificationActive,{email:claim.email})){
    const app=new URL(process.env.APP_URL??"https://dbcinemarentals.com").origin,token=notificationToken(claim.email),deadline=new Date(claim.round.deadline).toLocaleDateString("en-GB",{timeZone:"Europe/London",day:"numeric",month:"long",year:"numeric"});
    ok=await sendMail({to:claim.email,subject:`DB Cinema Film Fund · ${claim.round.name} applications are open`,html:`<h2>Your story. Our kit.</h2><p>${claim.round.name} applications are now open. Submit your project by ${deadline}. The selected project receives seven days of agreed equipment support, and the runner-up receives two days.</p><p>Entry is included with eligible Pro/Studio membership, otherwise £15 once per project. There are no extra tickets. Applying does not guarantee selection.</p><p><a href="${app}/film-fund#application">Prepare and submit your application</a></p><p>You requested Film Fund updates. <a href="${app}/film-fund/unsubscribe#${token}">Unsubscribe</a>.</p>`});
   }
  }catch{}
  await ctx.runMutation(internal.filmFundAnnouncements.finish,{id:claim.id,leaseUntil:claim.leaseUntil,sent:ok});if(ok)sent++;
 }
 return {sent};
}});
export const unsubscribe=action({args:{token:v.string()},handler:async(ctx,a):Promise<{unsubscribed:boolean}>=>ctx.runMutation(internal.filmFund.unsubscribeNotification,{email:notificationEmail(a.token)})});
