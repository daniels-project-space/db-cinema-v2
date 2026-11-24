import { internalMutation, internalQuery } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import { bump } from "./rateLimit";
import { ensureReferralCode } from "./lib/referrals";
import { droneDocumentType } from "./lib/droneDocument";
import { deletePrivateFile } from "./lib/privateStorage";

export const reserveAvatar = internalMutation({args:{challengeHash:v.string(),leaseKey:v.string()},handler:async(ctx,{challengeHash,leaseKey})=>{
 const row=await ctx.db.query("account_codes").withIndex("by_challenge",q=>q.eq("challengeHash",challengeHash)).unique();
 if(!row||row.purpose!=="setup"||row.usedAt||row.verifiedAt||row.expiresAt<=Date.now()||row.pendingAvatarId||(row.avatarUploadLeaseUntil??0)>Date.now())return false;
 await ctx.db.patch(row._id,{avatarUploadLeaseKey:leaseKey,avatarUploadLeaseUntil:Date.now()+120_000});return true;
}});

export const releaseAvatar = internalMutation({args:{challengeHash:v.string(),leaseKey:v.string()},handler:async(ctx,{challengeHash,leaseKey})=>{
 const row=await ctx.db.query("account_codes").withIndex("by_challenge",q=>q.eq("challengeHash",challengeHash)).unique();
 if(row?.avatarUploadLeaseKey===leaseKey)await ctx.db.patch(row._id,{avatarUploadLeaseKey:undefined,avatarUploadLeaseUntil:undefined});
}});

export const stageAvatar = internalMutation({args:{challengeHash:v.string(),leaseKey:v.string(),contentType:v.string(),chunks:v.array(v.bytes())},handler:async(ctx,args)=>{
 const row=await ctx.db.query("account_codes").withIndex("by_challenge",q=>q.eq("challengeHash",args.challengeHash)).unique();
 if(!row||row.purpose!=="setup"||row.usedAt||row.verifiedAt||row.expiresAt<=Date.now()||row.pendingAvatarId||row.avatarUploadLeaseKey!==args.leaseKey||(row.avatarUploadLeaseUntil??0)<=Date.now())return;
 if(!args.chunks.length||args.chunks.length>10||args.chunks.some(chunk=>chunk.byteLength<1||chunk.byteLength>512*1024))throw Error("Invalid image.");
 const size=args.chunks.reduce((total,chunk)=>total+chunk.byteLength,0);
 if(size>5*1024*1024)throw Error("Invalid image.");
 const bytes=new Uint8Array(size);let offset=0;
 for(const chunk of args.chunks){bytes.set(new Uint8Array(chunk),offset);offset+=chunk.byteLength;}
 const contentType=droneDocumentType(bytes,args.contentType);
 if(!contentType.startsWith("image/"))throw Error("Invalid image.");
 const storageId=await ctx.storage.store(new Blob([bytes],{type:contentType}));
 await ctx.db.patch(row._id,{pendingAvatarId:storageId,avatarUploadLeaseKey:undefined,avatarUploadLeaseUntil:undefined});
 await ctx.scheduler.runAt(row.expiresAt,internal.accountCodeClaims.expirePendingAvatar,{codeId:row._id,storageId});
}});

export const pendingAvatar = internalQuery({args:{setupHash:v.string()},handler:async(ctx,{setupHash})=>{
 const row=await ctx.db.query("account_codes").withIndex("by_setup",q=>q.eq("setupHash",setupHash)).unique();
 return row&&row.purpose==="setup"&&row.verifiedAt&&!row.usedAt&&row.expiresAt>Date.now()?row.pendingAvatarId??null:null;
}});

export const expirePendingAvatar = internalMutation({args:{codeId:v.id("account_codes"),storageId:v.id("_storage"),attempt:v.optional(v.number())},handler:async(ctx,{codeId,storageId,attempt=0})=>{
 const row=await ctx.db.get(codeId);
 if(!row||row.pendingAvatarId!==storageId||row.expiresAt>Date.now())return;
 try{await deletePrivateFile(ctx,storageId);}catch(error){
  if(attempt>=5)throw error;
  await ctx.scheduler.runAfter(Math.min(60*60_000,30_000*2**attempt),internal.accountCodeClaims.expirePendingAvatar,{codeId,storageId,attempt:attempt+1});
  return;
 }
 await ctx.db.patch(row._id,{pendingAvatarId:undefined});
}});

export const prepare = internalMutation({args:{email:v.string(),name:v.optional(v.string()),phone:v.optional(v.string()),purpose:v.union(v.literal("setup"),v.literal("reset")),challengeHash:v.string(),codeHash:v.string(),cartKey:v.optional(v.string())},handler:async(ctx,a)=>{
 const email=a.email.trim().toLowerCase();
 if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||email.length>254)throw Error("Enter a valid email address.");
 if(!(await bump(ctx,`account-code:${email}`,3,3600000)).allowed||!(await bump(ctx,"account-code:global",120,3600000)).allowed)return null;
 const account=await ctx.db.query("accounts").withIndex("by_email",q=>q.eq("email",email)).unique();
 if(account?.blockedAt!=null||a.purpose==="reset"&&!account||a.purpose==="setup"&&account?.emailVerifiedAt!=null)return null;
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
export const finish = internalMutation({args:{setupHash:v.string(),salt:v.string(),hash:v.string(),sessionToken:v.string(),termsAndPrivacyAcknowledged:v.optional(v.boolean()),termsVersion:v.optional(v.string()),privacyNoticeVersion:v.optional(v.string()),acceptPendingAvatar:v.optional(v.boolean())},handler:async(ctx,a)=>{
 const row=await ctx.db.query("account_codes").withIndex("by_setup",q=>q.eq("setupHash",a.setupHash)).unique();
 if(!row||!row.verifiedAt||row.usedAt||row.expiresAt<=Date.now())throw Error("Your code has expired or was already used. Request a new code.");
 if(row.purpose==="setup"&&(!a.termsAndPrivacyAcknowledged||!a.termsVersion||!a.privacyNoticeVersion))throw Error("Please accept the current Terms and Conditions and Privacy Notice before setting up your account.");
 let account=await ctx.db.query("accounts").withIndex("by_email",q=>q.eq("email",row.email)).unique();
 if(account?.blockedAt!=null||row.purpose==="reset"&&!account||row.purpose==="setup"&&account?.emailVerifiedAt!=null)throw Error("Account access is unavailable.");
 if(!account){const id=await ctx.db.insert("accounts",{email:row.email,name:row.name,phone:row.phone,createdAt:Date.now()});await ensureReferralCode(ctx,id);account=(await ctx.db.get(id))!;}
 if(row.pendingAvatarId){
  if(a.acceptPendingAvatar===true){
   if(account!.avatarStorageId&&account!.avatarStorageId===account!.avatarOwnedStorageId)await deletePrivateFile(ctx,account!.avatarStorageId);
   await ctx.db.patch(account!._id,{avatarStorageId:row.pendingAvatarId,avatarOwnedStorageId:row.pendingAvatarId,avatarUploadRevision:(account!.avatarUploadRevision??0)+1});
  }else await deletePrivateFile(ctx,row.pendingAvatarId);
 }
 const needsVerificationRecovery=!account.emailVerifiedAt||account.emailVerificationRequired;
 const sessions=await ctx.db.query("sessions").withIndex("by_account",q=>q.eq("accountId",account!._id)).collect();for(const s of sessions)await ctx.db.delete(s._id);
 const acceptedAt=Date.now();
 await ctx.db.patch(account!._id,{salt:a.salt,hash:a.hash,emailVerifiedAt:acceptedAt,emailVerificationRequired:false,passwordSignInWindowStartedAt:undefined,passwordSignInAttemptCount:undefined,...(row.purpose==="setup"?{accountTermsVersion:a.termsVersion,accountTermsAcceptedAt:acceptedAt,privacyNoticeVersion:a.privacyNoticeVersion,privacyNoticeAcknowledgedAt:acceptedAt}:{})});
 if(needsVerificationRecovery)await ctx.scheduler.runAfter(0,internal.verificationArchive.linkVerifiedAccount,{accountId:account!._id,cursor:null});
 await ctx.db.patch(row._id,{usedAt:Date.now(),setupHash:undefined,pendingAvatarId:undefined});
 if(row.cartKey){const cart=await ctx.db.query("checkout_carts").withIndex("by_share",q=>q.eq("shareKey",row.cartKey!)).unique();if(cart&&cart.email===account!.email)await ctx.db.patch(cart._id,{accountId:account!._id});}
 await ctx.db.insert("sessions",{accountId:account!._id,token:a.sessionToken,createdAt:Date.now(),expiresAt:Date.now()+90*86400000});
 return {token:a.sessionToken,cartKey:row.cartKey};
}});
