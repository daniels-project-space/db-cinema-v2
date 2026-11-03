import { internalMutation, internalQuery } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import { queueOwnerNotification } from "./lib/adminPush";

const KEY="membership-provider-v1",LEASE=30*60000;
export const schedule=internalMutation({args:{},handler:async ctx=>{
 const now=Date.now();let row=await ctx.db.query("membership_reconcile_sweeps").withIndex("by_key",q=>q.eq("key",KEY)).unique();
 if(!row){const id=await ctx.db.insert("membership_reconcile_sweeps",{key:KEY,generation:0,state:"ready",startedAt:now,dueAt:process.env.MEMBERSHIP_BOUNDED_RECONCILE_ENABLED==="true"?now:now+6*3600000,updatedAt:now});row=await ctx.db.get(id);}
 if(!row)return;
 if(row.state==="running"&&now-row.startedAt>12*3600000)await queueOwnerNotification(ctx,{eventKey:`membership-reconcile-backlog:${Math.floor(now/86400000)}`,kind:"payment_attention",title:"Membership checks are delayed",body:"Subscription payment checks are behind schedule. Review reconciliation before relying on deposit-waiver eligibility."});
 if(row.dueAt>now)return;
 if(process.env.MEMBERSHIP_BOUNDED_RECONCILE_ENABLED==="true"&&row.state==="running"&&(row.leaseRecoveries??0)>=2){
  const page=await ctx.db.query("accounts").withIndex("by_subscription",q=>q.gt("stripeSubscriptionId","")).paginate({numItems:1,cursor:row.cursor??null}),account=page.page[0];
  await queueOwnerNotification(ctx,{eventKey:`membership-reconcile-stalled:${account?._id??"cursor"}:${Math.floor(now/86400000)}`,kind:"payment_attention",...(account?{accountId:account._id}:{}),title:"Membership check stalled",body:"A subscription could not be checked after repeated attempts. It was skipped so other subscriptions can be checked; review it before relying on a waiver."});
  const generation=row.generation+1;
  if(page.isDone){await ctx.db.patch(row._id,{generation,state:"ready",cursor:undefined,leaseRecoveries:0,dueAt:now+6*3600000,updatedAt:now});return;}
  await ctx.db.patch(row._id,{generation,cursor:page.continueCursor,leaseRecoveries:0,dueAt:now+LEASE,updatedAt:now});await ctx.scheduler.runAfter(5000,internal.checkout.reconcileMemberships,{generation});return;
 }
 const generation=row.generation+1,startedAt=row.state==="ready"?now:row.startedAt;
 await ctx.db.patch(row._id,{generation,state:"running",startedAt,leaseRecoveries:row.state==="running"?(row.leaseRecoveries??0)+1:0,dueAt:now+LEASE,updatedAt:now});
 await ctx.scheduler.runAfter(0,process.env.MEMBERSHIP_BOUNDED_RECONCILE_ENABLED==="true"?internal.checkout.reconcileMemberships:internal.checkout.reconcileMembershipsLegacy,{generation});
}});
export const next=internalQuery({args:{generation:v.number()},handler:async(ctx,{generation})=>{
 const row=await ctx.db.query("membership_reconcile_sweeps").withIndex("by_key",q=>q.eq("key",KEY)).unique();if(!row||row.state!=="running"||row.generation!==generation)return null;
 const page=await ctx.db.query("accounts").withIndex("by_subscription",q=>q.gt("stripeSubscriptionId","")).paginate({numItems:1,cursor:row.cursor??null});
 const account=page.page[0];return {account:account?{_id:account._id,stripeSubscriptionId:account.stripeSubscriptionId}:null,cursor:page.continueCursor,done:page.isDone};
}});
export const advance=internalMutation({args:{generation:v.number(),cursor:v.string(),done:v.boolean(),failure:v.optional(v.string()),accountId:v.optional(v.id("accounts"))},handler:async(ctx,args)=>{
 const row=await ctx.db.query("membership_reconcile_sweeps").withIndex("by_key",q=>q.eq("key",KEY)).unique();if(!row||row.state!=="running"||row.generation!==args.generation)return false;
 const now=Date.now();if(args.failure)await queueOwnerNotification(ctx,{eventKey:`membership-reconcile-failed:${args.accountId??"configuration"}:${Math.floor(now/86400000)}`,kind:"payment_attention",...(args.accountId?{accountId:args.accountId}:{}),title:"Membership check needs attention",body:"A subscription payment check failed. The system will retry during the next reconciliation sweep; verify the subscription before relying on the waiver."});
 if(args.done){await ctx.db.patch(row._id,{state:"ready",cursor:undefined,leaseRecoveries:0,dueAt:now+6*3600000,updatedAt:now});return true;}
 const generation=row.generation+1;await ctx.db.patch(row._id,{cursor:args.cursor,generation,leaseRecoveries:0,dueAt:now+LEASE,updatedAt:now});
 await ctx.scheduler.runAfter(5000,internal.checkout.reconcileMemberships,{generation});return true;
}});
export const pause=internalMutation({args:{generation:v.number()},handler:async(ctx,{generation})=>{
 const row=await ctx.db.query("membership_reconcile_sweeps").withIndex("by_key",q=>q.eq("key",KEY)).unique();if(!row||row.state!=="running"||row.generation!==generation)return;
 const now=Date.now();await ctx.db.patch(row._id,{state:"paused",dueAt:now+5*60000,updatedAt:now});
 await queueOwnerNotification(ctx,{eventKey:`membership-reconcile-config:${Math.floor(now/86400000)}`,kind:"payment_attention",title:"Membership checks are unavailable",body:"Membership provider credentials are unavailable. Subscription and deposit-waiver checks cannot refresh."});
}});
