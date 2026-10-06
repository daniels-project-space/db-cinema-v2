"use node";
import { randomBytes } from "node:crypto";
import { action } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import { sendMail } from "./lib/mailer";
export const email=action({args:{email:v.string(),token:v.optional(v.string()),lines:v.array(v.object({listingId:v.id("listings"),start:v.number(),end:v.number()}))},handler:async(ctx,a):Promise<{url:string;shareKey:string}>=>{
 const shareKey=randomBytes(32).toString("base64url");
 await ctx.runMutation(internal.checkoutCartData.create,{...a,shareKey});
 const url=`${new URL(process.env.APP_URL??"https://dbcinemarentals.com").origin}/cart/quote/${shareKey}`;
 if(!await sendMail({to:a.email.trim().toLowerCase(),subject:"Your DB Cinema Rentals checkout cart",html:`<h2>Your discussed rental cart</h2><p><a href="${url}">Review your kit and continue to checkout</a></p><p>Your discussed items and hire dates are saved in this private link for seven days. Prices and availability are checked again when you open it and at checkout. Unavailable items will show available replacement options. No equipment is reserved and no payment is taken by opening this link.</p>`}))throw Error("The cart is saved, but the email could not be sent. Please try again.");
 return {url,shareKey};
}});
