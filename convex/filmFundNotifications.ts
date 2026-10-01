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
 const ok=await sendMail({to:a.email,subject:"You’re on the DB Cinema Film Fund list",html:`<h2>Your next film starts with a possibility.</h2><p>You’re signed up for the Film Fund opening announcement and application dates. Applications and entry payments are still Coming soon. No entry has been submitted or purchased.</p><p><a href="${app}/film-fund">Explore the fund</a></p><p><a href="${app}/film-fund/unsubscribe#${token}">Unsubscribe from Film Fund updates</a></p>`});if(!ok)throw Error("Film Fund signup email could not be delivered.");
}});
export const unsubscribe=action({args:{token:v.string()},handler:async(ctx,a):Promise<{unsubscribed:boolean}>=>ctx.runMutation(internal.filmFund.unsubscribeNotification,{email:notificationEmail(a.token)})});
