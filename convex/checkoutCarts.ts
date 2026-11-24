"use node";
import { randomBytes } from "node:crypto";
import { action } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { v } from "convex/values";
import { cartLine } from "./checkoutCartData";
import { checkoutCartUrl } from "../shared/checkoutCartUrl";
export const email=action({args:{email:v.string(),token:v.optional(v.string()),shareKey:v.optional(v.string()),lines:v.array(cartLine)},handler:async(ctx,a):Promise<{url:string;shareKey:string}>=>{
 const shareKey=a.shareKey??randomBytes(32).toString("base64url");
 if(!/^[A-Za-z0-9_-]{43}$/.test(shareKey))throw Error("Could not create a secure cart link.");
 const url=checkoutCartUrl(shareKey);
 const saved: {accountId?:Id<"accounts">}=await ctx.runMutation(internal.checkoutCartData.create,{...a,shareKey});
 let delivery: {sent:boolean;uncertain?:boolean;busy?:boolean};
 try{delivery=await ctx.runAction(internal.emailInbox.sendCheckoutCartEmail,{email:a.email,...(saved.accountId?{accountId:saved.accountId}:{}),shareKey,chatSender:"bot"})}
 catch{throw Error("The cart is saved, but email delivery could not be confirmed. Contact the team before trying again.")}
 if(delivery.uncertain)throw Error("The cart is saved, but email delivery is unclear. Contact the team before trying again.");
 if(delivery.busy)throw Error("The cart is saved and the email is still sending. Check again shortly.");
 if(!delivery.sent)throw Error("The cart is saved, but the email could not be sent. Please try again.");
 return {url,shareKey};
}});

export const adminShare=action({args:{token:v.string(),accountId:v.id("accounts"),bookingId:v.optional(v.id("bookings")),email:v.string(),shareKey:v.string(),lines:v.array(cartLine),delivery:v.union(v.literal("chat"),v.literal("email"),v.literal("both"))},handler:async(ctx,a):Promise<{url:string;shareKey:string;chatSent:boolean;emailSent:boolean|null;emailUncertain?:boolean}>=>{
 const url=checkoutCartUrl(a.shareKey);
 const share: {chatSent:boolean;expiresAt:number;chatMessageId?:Id<"messages">}=await ctx.runMutation(internal.checkoutCartData.createAdmin,{token:a.token,accountId:a.accountId,bookingId:a.bookingId,email:a.email,shareKey:a.shareKey,lines:a.lines,sendChat:a.delivery!=="email"});
 let emailSent:boolean|null=null,emailUncertain=false;
 if(a.delivery!=="chat"){
  try{
   const sent: {sent:boolean;uncertain?:boolean;busy?:boolean}=await ctx.runAction(internal.emailInbox.sendCheckoutCartEmail,{email:a.email,accountId:a.accountId,shareKey:a.shareKey,chatSender:"owner",...(share.chatMessageId?{profileMessageId:share.chatMessageId}:{})});
   emailSent=sent.sent;
   emailUncertain=!!(sent.uncertain||sent.busy);
  }catch{emailSent=false;emailUncertain=true;}
 }
 return {url,shareKey:a.shareKey,chatSent:share.chatSent,emailSent,...(emailUncertain?{emailUncertain:true}:{})};
}});
