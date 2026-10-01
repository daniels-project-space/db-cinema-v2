import { query,mutation,internalQuery,internalMutation } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import { assertAdmin,checkAdminToken } from "./adminAuth";
import { ensureReferralCode } from "./lib/referrals";
export const preview=query({args:{token:v.string()},handler:async(ctx,{token})=>{if(!checkAdminToken(token))throw Error("unauthorized");const accounts=await ctx.db.query("accounts").collect(),campaign=await ctx.db.query("referral_campaigns").order("desc").first();return {recipients:accounts.filter(a=>a.marketingEmails&&a.emailVerifiedAt).length,campaign:campaign?{id:campaign._id,status:campaign.status,sent:campaign.sent,failed:campaign.failed,recipientCount:campaign.recipientCount}:null};}});
// Owner explicitly launches this one-time campaign; deployment never launches it.
export const launch=mutation({args:{token:v.string(),confirmed:v.boolean()},handler:async(ctx,{token,confirmed})=>{
 await assertAdmin(ctx,token,"referralCampaigns.launch");if(!confirmed)throw Error("Review and confirm the campaign first.");
 const existing=await ctx.db.query("referral_campaigns").first();if(existing)return existing._id;
 const id=await ctx.db.insert("referral_campaigns",{createdAt:Date.now(),status:"queued",recipientCount:0,sent:0,failed:0});
 await ctx.scheduler.runAfter(0,internal.referralCampaigns.enqueue,{id,cursor:null});return id;
}});
export const enqueue=internalMutation({args:{id:v.id("referral_campaigns"),cursor:v.union(v.string(),v.null())},handler:async(ctx,{id,cursor})=>{
 const c=await ctx.db.get(id);if(c?.status!=="queued")return;
 const page=await ctx.db.query("accounts").paginate({numItems:100,cursor});let added=0;
 for(const a of page.page){if(!a.marketingEmails||!a.emailVerifiedAt)continue;const existing=await ctx.db.query("referral_campaign_messages").withIndex("by_campaign_account",q=>q.eq("campaignId",id).eq("accountId",a._id)).first();if(existing)continue;
  await ensureReferralCode(ctx,a._id);await ctx.db.insert("referral_campaign_messages",{campaignId:id,accountId:a._id,state:"pending",dueAt:Date.now(),attempts:0});added++;
 }
 await ctx.db.patch(id,{recipientCount:c.recipientCount+added,...(page.isDone?{enqueuedAt:Date.now(),...((c.sent+c.failed)>=c.recipientCount+added?{status:"complete" as const}:{})}:{})});
 if(!page.isDone)await ctx.scheduler.runAfter(0,internal.referralCampaigns.enqueue,{id,cursor:page.continueCursor});
 await ctx.scheduler.runAfter(0,internal.referralMail.sendCampaign,{});
}});
export const due=internalQuery({args:{},handler:async ctx=>{const now=Date.now();return [...await ctx.db.query("referral_campaign_messages").withIndex("by_state_due",q=>q.eq("state","pending").lte("dueAt",now)).take(20),...await ctx.db.query("referral_campaign_messages").withIndex("by_state_due",q=>q.eq("state","sending").lte("dueAt",now)).take(20)].map(r=>r._id);}});
export const claim=internalMutation({args:{id:v.id("referral_campaign_messages")},handler:async(ctx,{id})=>{
 const r=await ctx.db.get(id),now=Date.now();if(!r||!["pending","sending"].includes(r.state)||r.dueAt>now||(r.leaseUntil??0)>now)return null;
 const a=await ctx.db.get(r.accountId),c=await ctx.db.get(r.campaignId);
 if(!a?.marketingEmails||!a.emailVerifiedAt||c?.status!=="queued"||r.attempts>=3){await ctx.db.patch(id,{state:"stopped",leaseUntil:undefined});if(c)await ctx.db.patch(c._id,{failed:c.failed+1,...(c.enqueuedAt&&c.sent+c.failed+1>=c.recipientCount?{status:"complete" as const}:{})});return null;}
 const leaseUntil=now+120000;await ctx.db.patch(id,{state:"sending",attempts:r.attempts+1,leaseUntil,dueAt:leaseUntil});return {id,leaseUntil,email:a.email,code:await ensureReferralCode(ctx,a._id)};
}});
export const finish=internalMutation({args:{id:v.id("referral_campaign_messages"),leaseUntil:v.number(),sent:v.boolean()},handler:async(ctx,a)=>{
 const r=await ctx.db.get(a.id);if(!r||r.state!=="sending"||r.leaseUntil!==a.leaseUntil)return;
 const terminal=a.sent||r.attempts>=3;await ctx.db.patch(r._id,{state:a.sent?"sent":terminal?"stopped":"pending",leaseUntil:undefined,...(a.sent?{sentAt:Date.now()}:{dueAt:Date.now()+5*60000*2**r.attempts})});
 const c=await ctx.db.get(r.campaignId);if(c&&terminal)await ctx.db.patch(c._id,{sent:c.sent+(a.sent?1:0),failed:c.failed+(a.sent?0:1),...(c.enqueuedAt&&c.sent+c.failed+1>=c.recipientCount?{status:"complete" as const}:{})});
}});
export const unsubscribe=internalMutation({args:{email:v.string()},handler:async(ctx,{email})=>{const a=await ctx.db.query("accounts").withIndex("by_email",q=>q.eq("email",email.trim().toLowerCase())).first();if(a)await ctx.db.patch(a._id,{marketingEmails:false});return {unsubscribed:true};}});
