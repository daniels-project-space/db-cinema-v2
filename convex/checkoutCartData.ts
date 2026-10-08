import { internalMutation, query } from "./_generated/server";
import { v } from "convex/values";
import { bump } from "./rateLimit";
import { accountForToken } from "./lib/rentalChat";
import { assertRentalInventory } from "./lib/rentalInventory";
import { quote } from "./lib/pricing";
import { listingImages } from "./lib/catalogImages";
export const cartLine=v.object({listingId:v.id("listings"),start:v.number(),end:v.number(),pickupTime:v.optional(v.string()),returnTime:v.optional(v.string())});
export const create=internalMutation({args:{email:v.string(),token:v.optional(v.string()),shareKey:v.string(),lines:v.array(cartLine)},handler:async(ctx,a)=>{
 const email=a.email.trim().toLowerCase();if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||email.length>254)throw Error("Enter a valid email address.");
 if(!a.lines.length||a.lines.length>100)throw Error("Add between 1 and 100 items to the cart.");
 if(!(await bump(ctx,`checkout-cart:${email}`,5,3600000)).allowed||!(await bump(ctx,"checkout-cart:global",120,3600000)).allowed)throw Error("Too many cart emails. Please try again later.");
 const account=a.token?await accountForToken(ctx,a.token):null;
 if(a.token&&(!account||account.email!==email))throw Error("Send the cart to your own account email or sign out first.");
 for(const l of a.lines){if(!Number.isSafeInteger(l.start)||!Number.isSafeInteger(l.end)||l.end<l.start||l.end-l.start>365*86400000||!await ctx.db.get(l.listingId))throw Error("Check your cart items and dates.");}
 await ctx.db.insert("checkout_carts",{email,accountId:account?._id,shareKey:a.shareKey,lines:a.lines,createdAt:Date.now(),expiresAt:Date.now()+7*86400000});
}});
export const get=query({args:{shareKey:v.string()},handler:async(ctx,a)=>{
 if(!/^[A-Za-z0-9_-]{43}$/.test(a.shareKey))return null;
 const cart=await ctx.db.query("checkout_carts").withIndex("by_share",q=>q.eq("shareKey",a.shareKey)).unique();if(!cart||cart.expiresAt<=Date.now())return null;
 let available=true;try{await assertRentalInventory(ctx,cart.lines.map(l=>({...l,qty:1})));}catch{available=false;}
 const items=await Promise.all(cart.lines.map(async(l,index)=>{const listing=await ctx.db.get(l.listingId);if(!listing)return null;const days=Math.round((l.end-l.start)/86400000)+1,price=quote(listing.pricing,days);const total=listing.quietDeal?Math.round(price.total*(1-listing.quietDeal/100)):price.total;
  return {key:`email-cart-${index}`,listingId:String(listing._id),title:listing.title,slug:listing.slug,heroImage:listingImages(listing)[0]??null,start:new Date(l.start).toISOString().slice(0,10),end:new Date(l.end).toISOString().slice(0,10),pickupTime:l.pickupTime,returnTime:l.returnTime,days,total,perDay:Math.round(total/days*100)/100,deposit:listing.depositAmount};}));
 return {items:items.filter(i=>i!==null),available:available&&items.every(Boolean),expiresAt:cart.expiresAt};
}});
