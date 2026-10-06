import { internalMutation } from "./_generated/server";
import { v } from "convex/values";
import { bump } from "./rateLimit";
import { ensureReferralCode } from "./lib/referrals";

export const prepare = internalMutation({args:{email:v.string(),name:v.optional(v.string()),phone:v.optional(v.string()),purpose:v.union(v.literal("setup"),v.literal("reset")),challengeHash:v.string(),codeHash:v.string(),cartKey:v.optional(v.string())},handler:async(ctx,a)=>{
 const email=a.email.trim().toLowerCase();
 if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||email.length>254)throw Error("Enter a valid email address.");
 if(!(await bump(ctx,`account-code:${email}`,3,3600000)).allowed||!(await bump(ctx,"account-code:global",120,3600000)).allowed)return null;
 const account=await ctx.db.query("accounts").withIndex("by_email",q=>q.eq("email",email)).unique();
 if(account?.blockedAt!=null||a.purpose==="reset"&&!account)return null;
 if(a.cartKey){const cart=await ctx.db.query("checkout_carts").withIndex("by_share",q=>q.eq("shareKey",a.cartKey!)).unique();if(!cart||cart.email!==email||cart.expiresAt<=Date.now())throw Error("This cart does not belong to this email.");}
 const old=await ctx.db.query("account_codes").withIndex("by_email",q=>q.eq("email",email)).collect();
 for(const code of old)if(!code.usedAt)await ctx.db.patch(code._id,{expiresAt:Date.now()});
 await ctx.db.insert("account_codes",{...a,email,name:a.name?.trim().slice(0,100),phone:a.phone?.trim().slice(0,40),attempts:0,expiresAt:Date.now()+15*60000});
 return {email};
}});
export const verify = internalMutation({args:{challengeHash:v.string(),codeHash:v.string(),setupHash:v.string()},handler:async(ctx,a)=>{
 const row=await ctx.db.query("account_codes").withIndex("by_challenge",q=>q.eq("challengeHash",a.challengeHash)).unique();
 if(!row||row.usedAt||row.verifiedAt||row.expiresAt<=Date.now()||row.attempts>=5)return {ok:false};
 // Return failure rather than throwing so the failed-attempt increment commits.
 await ctx.db.patch(row._id,{attempts:row.attempts+1});
 if(row.codeHash!==a.codeHash)return {ok:false};
 await ctx.db.patch(row._id,{verifiedAt:Date.now(),setupHash:a.setupHash});return {ok:true};
}});
export const finish = internalMutation({args:{setupHash:v.string(),salt:v.string(),hash:v.string(),sessionToken:v.string()},handler:async(ctx,a)=>{
 const row=await ctx.db.query("account_codes").withIndex("by_setup",q=>q.eq("setupHash",a.setupHash)).unique();
 if(!row||!row.verifiedAt||row.usedAt||row.expiresAt<=Date.now())throw Error("Your code has expired or was already used. Request a new code.");
 let account=await ctx.db.query("accounts").withIndex("by_email",q=>q.eq("email",row.email)).unique();
 if(account?.blockedAt!=null||row.purpose==="reset"&&!account)throw Error("Account access is unavailable.");
 if(!account){const id=await ctx.db.insert("accounts",{email:row.email,name:row.name,phone:row.phone,createdAt:Date.now()});await ensureReferralCode(ctx,id);account=(await ctx.db.get(id))!;}
 const sessions=await ctx.db.query("sessions").withIndex("by_account",q=>q.eq("accountId",account!._id)).collect();for(const s of sessions)await ctx.db.delete(s._id);
 await ctx.db.patch(account!._id,{salt:a.salt,hash:a.hash,emailVerifiedAt:Date.now(),emailVerificationRequired:false});
 await ctx.db.patch(row._id,{usedAt:Date.now(),setupHash:undefined});
 if(row.cartKey){const cart=await ctx.db.query("checkout_carts").withIndex("by_share",q=>q.eq("shareKey",row.cartKey!)).unique();if(cart&&cart.email===account!.email)await ctx.db.patch(cart._id,{accountId:account!._id});}
 await ctx.db.insert("sessions",{accountId:account!._id,token:a.sessionToken,createdAt:Date.now(),expiresAt:Date.now()+90*86400000});
 return {token:a.sessionToken,cartKey:row.cartKey};
}});
