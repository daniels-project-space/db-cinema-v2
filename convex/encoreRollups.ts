import { internalMutation } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import { validEncoreEvidence } from "./lib/encoreRollup";
import { queueOwnerNotification } from "./lib/adminPush";

const SWEEP_KEY="encore-rollups-v1",SWEEP_LEASE=5*60000,PAGE_SIZE=20,CONTINUE_MS=5000,ALERT_LAG=15*60000;

export const page=internalMutation({args:{accountId:v.id("accounts"),generation:v.number()},handler:async(ctx,args)=>{
 const rollup=await ctx.db.query("encore_account_rollups").withIndex("by_account",query=>query.eq("accountId",args.accountId)).unique();
 if(!rollup||rollup.state!=="running"||rollup.generation!==args.generation)return;
 const account=await ctx.db.get(args.accountId);if(!account){await ctx.db.delete(rollup._id);return;}
 const result=await ctx.db.query("encore_eligibility_evidence").withIndex("by_account",query=>query.eq("accountId",args.accountId)).order("desc").paginate({numItems:25,cursor:rollup.cursor??null});
 const candidates=[...rollup.candidates],seen=new Set(candidates.map(candidate=>candidate.checkoutKey));
 for(const evidence of result.page){
  if(candidates.length===3)break;
  if(seen.has(evidence.checkoutKey)||!await validEncoreEvidence(ctx,account,evidence))continue;
  candidates.push({evidenceId:evidence._id,bookingId:evidence.bookingId,checkoutKey:evidence.checkoutKey,fingerprint:evidence.fingerprint});seen.add(evidence.checkoutKey);
 }
 const done=result.isDone||candidates.length===3,now=Date.now();
 await ctx.db.patch(rollup._id,{state:done?"ready":"running",candidates,...(done?{published:candidates,recoveryStartedAt:undefined}:{}),cursor:done?undefined:result.continueCursor,updatedAt:now,dueAt:now+(done?15:5)*60000});
 if(done)await ctx.scheduler.runAfter(0,internal.encoreNotices.dispatch,{accountId:args.accountId});
 if(!done)await ctx.scheduler.runAfter(0,internal.encoreRollups.page,args);
}});
export const recover=internalMutation({args:{},handler:async ctx=>{
 const now=Date.now();
 const sweep=await ctx.db.query("encore_rollup_sweeps").withIndex("by_key",query=>query.eq("key",SWEEP_KEY)).unique();
 if(sweep?.state==="running"&&sweep.leaseUntil>now)return;
 const due=await Promise.all(["running","ready"].map(state=>ctx.db.query("encore_account_rollups").withIndex("by_state_due",query=>query.eq("state",state).lte("dueAt",now)).first()));
 if(!due.some(Boolean))return;
 const generation=(sweep?.generation??0)+1;
 if(sweep)await ctx.db.patch(sweep._id,{state:"running",generation,leaseUntil:now+SWEEP_LEASE});else await ctx.db.insert("encore_rollup_sweeps",{key:SWEEP_KEY,state:"running",generation,leaseUntil:now+SWEEP_LEASE});
 await ctx.scheduler.runAfter(0,internal.encoreRollups.recoverPage,{generation});
}});

export const recoverPage=internalMutation({args:{generation:v.number()},handler:async(ctx,{generation})=>{
 const now=Date.now(),sweep=await ctx.db.query("encore_rollup_sweeps").withIndex("by_key",query=>query.eq("key",SWEEP_KEY)).unique();
 if(!sweep||sweep.state!=="running"||sweep.generation!==generation||sweep.leaseUntil<=now)return;
 const groups=await Promise.all(["running","ready"].map(state=>ctx.db.query("encore_account_rollups").withIndex("by_state_due",query=>query.eq("state",state).lte("dueAt",now)).take(PAGE_SIZE)));
 const delayed=groups.flat().find(row=>(row.recoveryStartedAt??row.dueAt)<=now-ALERT_LAG);
 if(delayed&&(sweep.alertDueAt??0)<=now)await ctx.scheduler.runAfter(0,internal.encoreRollups.alertBacklog,{rollupId:delayed._id});
 for(const rows of groups)for(const row of rows){const next=row.generation+1;await ctx.db.patch(row._id,{generation:next,state:"running",cursor:undefined,candidates:[],updatedAt:now,dueAt:now+5*60000,recoveryStartedAt:row.recoveryStartedAt??row.dueAt});await ctx.scheduler.runAfter(0,internal.encoreRollups.page,{accountId:row.accountId,generation:next});}
 const more=groups.some(rows=>rows.length===PAGE_SIZE),nextGeneration=generation+1;
 await ctx.db.patch(sweep._id,{state:more?"running":"idle",generation:nextGeneration,leaseUntil:more?now+SWEEP_LEASE:0,...(delayed&&(sweep.alertDueAt??0)<=now?{alertDueAt:now+5*60000}:{})});
 if(more)await ctx.scheduler.runAfter(CONTINUE_MS,internal.encoreRollups.recoverPage,{generation:nextGeneration});
}});

export const alertBacklog=internalMutation({args:{rollupId:v.id("encore_account_rollups")},handler:async(ctx,{rollupId})=>{
 const now=Date.now(),row=await ctx.db.get(rollupId);
 if(!row||(row.recoveryStartedAt??row.dueAt)>now-ALERT_LAG)return;
 await queueOwnerNotification(ctx,{eventKey:`encore-rollup-backlog:${Math.floor(now/86400000)}`,kind:"verification_failure",title:"Encore checks are delayed",body:"Some clean-rental rewards are more than 15 minutes behind their scheduled refresh. Checks continue automatically; review the Encore queue if the delay persists."});
}});
