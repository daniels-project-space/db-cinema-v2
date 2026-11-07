import { v } from "convex/values";
import { internalAction, internalMutation, internalQuery, query } from "./_generated/server";
import { internal } from "./_generated/api";
import { queueOwnerNotification } from "./lib/adminPush";
import { checkAdminToken } from "./adminAuth";
import { adminSessionMigrationReady, assertAdminScopeSession } from "./adminAccountSessionV2";

const enabled = () => process.env.MEMBERSHIP_HISTORICAL_INVOICE_CREDIT_V1 === "enabled";
const refs = internal as any;
const maxAttempts = 4;
const leaseMs = 120000;

export const adminList = query({
  args: { token: v.string(), accountId: v.id("accounts") },
  handler: async (ctx, { token, accountId }) => {
    if (process.env.ADMIN_SESSION_BILLING_PORTAL_V2 === "enabled") {
      if (!adminSessionMigrationReady()) throw Error("Admin session migration is not ready.");
      await assertAdminScopeSession(ctx, token, "payments:write");
    } else if (!await checkAdminToken(token)) throw Error("unauthorized");
    const rows = await ctx.db.query("membership_refund_jobs").withIndex("by_account_state", q => q.eq("accountId", accountId).eq("state", "review")).take(30);
    return rows.map(row => ({ invoiceId: row.invoiceId, refundId: row.refundId, updatedAt: row.updatedAt }));
  },
});

async function review(ctx:any, job:any) {
  await ctx.db.patch(job._id, { state:"review", retryAt:undefined, leaseToken:undefined, leaseUntil:undefined, updatedAt:Date.now() });
  await queueOwnerNotification(ctx, { eventKey:`membership-refund-review:${job.invoiceId}`, kind:"membership_invoice_review", accountId:job.accountId, title:"Subscription refund needs review", body:"A refunded subscription invoice could not be reconciled. Check its payment and credit in Stripe." });
}

export const enqueue = internalMutation({args:{accountId:v.id("accounts"),subscriptionId:v.string(),invoiceId:v.string(),refundId:v.string()},handler:async(ctx,args)=>{
  if(!enabled())return;
  if(!/^sub_[A-Za-z0-9]+$/.test(args.subscriptionId)||!/^in_[A-Za-z0-9]+$/.test(args.invoiceId)||!/^re_[A-Za-z0-9]+$/.test(args.refundId))throw Error("Invalid membership refund identity.");
  const account=await ctx.db.get(args.accountId);
  if(!account||account.stripeSubscriptionId!==args.subscriptionId)throw Error("Membership refund ownership changed.");
  const existing=await ctx.db.query("membership_refund_jobs").withIndex("by_invoice",q=>q.eq("invoiceId",args.invoiceId)).unique();
  if(existing){
    if(existing.accountId!==args.accountId||existing.subscriptionId!==args.subscriptionId)throw Error("Membership refund ownership mismatch.");
    if(existing.refundId!==args.refundId){
      const now=Date.now();
      await ctx.db.patch(existing._id,{refundId:args.refundId,state:existing.state==="review"?"review":"pending",attempts:0,retryAt:existing.state==="review"?undefined:now+60000,leaseToken:undefined,leaseUntil:undefined,updatedAt:now});
    }
    return existing._id;
  }
  const now=Date.now();return await ctx.db.insert("membership_refund_jobs",{...args,state:"pending",attempts:0,retryAt:now+60000,createdAt:now,updatedAt:now});
}});

export const flagUnallocated = internalMutation({args:{accountId:v.id("accounts"),subscriptionId:v.string(),invoiceId:v.string(),refundId:v.string()},handler:async(ctx,args)=>{
  if(!enabled())return;
  if(!/^sub_[A-Za-z0-9]+$/.test(args.subscriptionId)||!/^in_[A-Za-z0-9]+$/.test(args.invoiceId)||!/^re_[A-Za-z0-9]+$/.test(args.refundId))throw Error("Invalid membership refund identity.");
  const account=await ctx.db.get(args.accountId);
  if(!account||account.stripeSubscriptionId!==args.subscriptionId)throw Error("Membership refund ownership changed.");
  let job=await ctx.db.query("membership_refund_jobs").withIndex("by_invoice",q=>q.eq("invoiceId",args.invoiceId)).unique();
  if(job&&(job.accountId!==args.accountId||job.subscriptionId!==args.subscriptionId))throw Error("Membership refund ownership mismatch.");
  if(!job){const now=Date.now();const id=await ctx.db.insert("membership_refund_jobs",{...args,state:"pending",attempts:0,retryAt:now,createdAt:now,updatedAt:now});job=await ctx.db.get(id);}
  if(job){if(job.refundId!==args.refundId)await ctx.db.patch(job._id,{refundId:args.refundId});await review(ctx,job);}
}});

export const due=internalQuery({args:{},handler:async(ctx)=>enabled()?ctx.db.query("membership_refund_jobs").withIndex("by_state_due",q=>q.eq("state","pending").lte("retryAt",Date.now())).take(20):[]});

export const claim=internalMutation({args:{id:v.id("membership_refund_jobs"),token:v.string()},handler:async(ctx,{id,token})=>{
  if(!enabled())return null;
  const job=await ctx.db.get(id),now=Date.now();
  if(!job||job.state!=="pending"||(job.retryAt??Infinity)>now||(job.leaseUntil??0)>now)return null;
  const account=await ctx.db.get(job.accountId);
  if(!account||account.stripeSubscriptionId!==job.subscriptionId||job.attempts>=maxAttempts){await review(ctx,job);return null;}
  await ctx.db.patch(id,{attempts:job.attempts+1,leaseToken:token,leaseUntil:now+leaseMs,retryAt:now+leaseMs,updatedAt:now});
  return {accountId:job.accountId,subscriptionId:job.subscriptionId,invoiceId:job.invoiceId,refundId:job.refundId};
}});

export const finish=internalMutation({args:{id:v.id("membership_refund_jobs"),token:v.string(),done:v.boolean()},handler:async(ctx,{id,token,done})=>{
  const job=await ctx.db.get(id),now=Date.now();
  if(!job||job.state!=="pending"||job.leaseToken!==token||(job.leaseUntil??0)<=now)return {stale:true};
  const account=await ctx.db.get(job.accountId);
  if(!account||account.stripeSubscriptionId!==job.subscriptionId||(!done&&job.attempts>=maxAttempts)){await review(ctx,job);return {review:true};}
  await ctx.db.patch(id,{state:done?"done":"pending",leaseToken:undefined,leaseUntil:undefined,retryAt:done?undefined:now+Math.min(30,2**job.attempts)*60000,updatedAt:now});
  return {done};
}});

export const dispatchDue=internalAction({args:{},handler:async(ctx)=>{
  if(!enabled())return;
  const jobs=await ctx.runQuery(refs.membershipRefundJobs.due,{});
  for(const job of jobs){try{await ctx.runAction(refs.checkout.retryMembershipRefund,{jobId:job._id});}catch(error){console.error("Membership refund dispatch failed",job._id,error);}}
}});
