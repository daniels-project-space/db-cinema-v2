import { internalAction, internalMutation, internalQuery, mutation, query, type QueryCtx, type MutationCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import { assertAdmin, checkAdminToken } from "./adminAuth";
import { approvedRestrictedIdentitySource, notifyRestrictedIdentityMatch } from "./lib/restrictedIdentityMatch";
import { queueOwnerNotification } from "./lib/adminPush";
import { adminSessionMigrationReady, assertAdminScopeSession } from "./adminAccountSessionV2";

async function identityAdminRead(ctx: QueryCtx, token: string): Promise<boolean> {
  if (process.env.ADMIN_SESSION_IDENTITY_ALERTS_V2 === "enabled") {
    if (!adminSessionMigrationReady()) throw Error("Admin session migration is not ready.");
    await assertAdminScopeSession(ctx, token, "verification:read"); return true;
  }
  return checkAdminToken(token);
}
async function identityAdminWrite(ctx: MutationCtx, token: string, fn: string): Promise<void> {
  if (process.env.ADMIN_SESSION_IDENTITY_ALERTS_V2 === "enabled") {
    if (!adminSessionMigrationReady()) throw Error("Admin session migration is not ready.");
    await assertAdminScopeSession(ctx, token, "verification:write");
    await ctx.db.insert("admin_audit_log", { at: Date.now(), success: true, limited: false, fn }); return;
  }
  await assertAdmin(ctx, token, fn);
}

const retentionMs = 90 * 86400000;
const maxAttempts = 5;

export async function queueRestrictedIdentityCheck(ctx: any, bookingId: any, sessionId: string, eventId: string, preserveUnavailable = false) {
  const existing = await ctx.db.query("restricted_identity_alert_jobs").withIndex("by_booking", (q: any) => q.eq("bookingId", bookingId)).unique();
  if (existing?.sessionId === sessionId && existing.eventId === eventId) return;
  if (preserveUnavailable && existing?.sessionId === sessionId && ["pending", "attention"].includes(existing.state)) return;
  const now = Date.now();
  const data = { bookingId, sessionId, eventId, state: "pending" as const, generation: (existing?.generation ?? 0) + 1, attempts: 0, dueAt: now, updatedAt: now, expiresAt: now + retentionMs };
  if (existing) await ctx.db.patch(existing._id, data);
  else await ctx.db.insert("restricted_identity_alert_jobs", { ...data, createdAt: now });
}

export async function queueRestrictedAccountRecheck(ctx:any, accountId:any, blockedAt:number) {
  const existing=await ctx.db.query("restricted_identity_recheck_jobs").withIndex("by_account_block",(q:any)=>q.eq("accountId",accountId).eq("blockedAt",blockedAt)).unique();
  if(existing)return;
  const now=Date.now();
  await ctx.db.insert("restricted_identity_recheck_jobs",{accountId,blockedAt,state:"pending",generation:1,attempts:0,stage:0,dueAt:now,createdAt:now,updatedAt:now,expiresAt:now+retentionMs});
  await ctx.scheduler.runAfter(0,internal.restrictedIdentityAlerts.dispatchDue,{});
}

export const dueRechecks=internalQuery({args:{},handler:async ctx=>ctx.db.query("restricted_identity_recheck_jobs").withIndex("by_state_due",q=>q.eq("state","pending").lte("dueAt",Date.now())).take(10)});
export const processRecheckPage=internalMutation({args:{id:v.id("restricted_identity_recheck_jobs"),generation:v.number(),attempt:v.number()},handler:async(ctx,args)=>{
  const job=await ctx.db.get(args.id);
  if(!job||job.state!=="pending"||job.generation!==args.generation||job.attempts!==args.attempt||job.dueAt>Date.now())return;
  const account=await ctx.db.get(job.accountId);
  if(!account||account.blockedAt!==job.blockedAt){const now=Date.now();await ctx.db.patch(job._id,{state:"complete",updatedAt:now,expiresAt:now+retentionMs});return;}
  const personKey=account.renterPersonKey;if(!personKey||!/^[a-f0-9]{64}$/.test(personKey))throw Error("Restricted identity signal unavailable");
  const statuses=["pending_verification","confirmed","active"] as const,status=statuses[job.stage];
  if(!status)throw Error("Invalid identity recheck stage");
  const page=await ctx.db.query("bookings").withIndex("by_person_status",q=>q.eq("renterPersonKey",personKey).eq("status",status)).order("asc").paginate({cursor:job.cursor??null,numItems:25,maximumRowsRead:25});
  for(const booking of page.page){
    if(booking.accountId===account._id||!await approvedRestrictedIdentitySource(ctx,booking))continue;
    const source=booking.idVerificationSource==="reused_didit"&&booking.verificationReusedFrom?await ctx.db.get(booking.verificationReusedFrom):booking;
    if(source?.diditSessionId)await queueRestrictedIdentityCheck(ctx,booking._id,source.diditSessionId,`restriction:${account._id}:${job.blockedAt}`);
  }
  const done=page.isDone&&job.stage===statuses.length-1,stage=page.isDone?job.stage+1:job.stage;
  const now=Date.now();
  await ctx.db.patch(job._id,{state:done?"complete":"pending",stage,cursor:page.isDone?undefined:page.continueCursor,generation:job.generation+1,attempts:0,dueAt:now,updatedAt:now,...(done?{expiresAt:now+retentionMs}:{})});
  if(!done)await ctx.scheduler.runAfter(0,internal.restrictedIdentityAlerts.dispatchDue,{});
}});
export const recordRecheckFailure=internalMutation({args:{id:v.id("restricted_identity_recheck_jobs"),generation:v.number(),attempt:v.number()},handler:async(ctx,args)=>{
  const job=await ctx.db.get(args.id);if(!job||job.state!=="pending"||job.generation!==args.generation||job.attempts!==args.attempt)return;
  const attempts=job.attempts+1,now=Date.now();await ctx.db.patch(job._id,{attempts,state:attempts>=maxAttempts?"attention":"pending",dueAt:now+Math.min(60,2**(attempts-1))*60000,updatedAt:now});
  if(attempts>=maxAttempts)await queueOwnerNotification(ctx,{eventKey:`restricted-account-recheck-failed:${job._id}:${job.generation}`,kind:"identity_match",title:"Restricted identity check needs attention",body:"A check of upcoming rentals could not finish. Review the restricted account and retry the identity scan."});
}});

export const due = internalQuery({ args: {}, handler: async ctx => ctx.db.query("restricted_identity_alert_jobs").withIndex("by_state_due", q => q.eq("state", "pending").lte("dueAt", Date.now())).take(20) });

export const processOne = internalMutation({ args: { id: v.id("restricted_identity_alert_jobs"), eventId: v.string(), generation: v.number(), attempt: v.number() }, handler: async (ctx, args) => {
  const job = await ctx.db.get(args.id);
  if (!job || job.state !== "pending" || job.eventId !== args.eventId || job.generation !== args.generation || job.attempts !== args.attempt || job.dueAt > Date.now()) return;
  const booking = await ctx.db.get(job.bookingId);
  if (booking?.idVerifyStatus === "verified" && ["The verified person could not be linked to the rental identity record.", "Didit approved the identity, but cross-account identity matching is unavailable."].includes(booking.identityRiskNotice ?? "")) throw Error("Verified identity signal unavailable");
  if (booking?.idVerifyStatus === "verified" && ["didit","reused_didit"].includes(booking.idVerificationSource ?? "") && !booking.renterPersonKey) throw Error("Verified identity signal unavailable");
  if (!booking || !await approvedRestrictedIdentitySource(ctx,booking,job.sessionId)) {
    const now = Date.now(); await ctx.db.patch(job._id, { state: "complete", updatedAt: now, expiresAt: now + retentionMs });
    return;
  }
  const personKey=booking.renterPersonKey;if (!personKey || !/^[a-f0-9]{64}$/.test(personKey)) throw Error("Verified identity signal unavailable");
  await notifyRestrictedIdentityMatch(ctx, booking, personKey);
  const now = Date.now(); await ctx.db.patch(job._id, { state: "complete", updatedAt: now, expiresAt: now + retentionMs });
} });

export const recordFailure = internalMutation({ args: { id: v.id("restricted_identity_alert_jobs"), eventId: v.string(), generation: v.number(), attempt: v.number() }, handler: async (ctx, args) => {
  const job = await ctx.db.get(args.id);
  if (!job || job.state !== "pending" || job.eventId !== args.eventId || job.generation !== args.generation || job.attempts !== args.attempt) return;
  const attempts = job.attempts + 1, now = Date.now();
  await ctx.db.patch(job._id, { attempts, state: attempts >= maxAttempts ? "attention" : "pending", dueAt: now + Math.min(60, 2 ** (attempts - 1)) * 60000, updatedAt: now });
  if (attempts >= maxAttempts) await queueOwnerNotification(ctx, { eventKey: `restricted-identity-check-failed:${job._id}:${job.generation}`, kind: "identity_match", bookingId: job.bookingId, title: "Identity check needs attention", body: "A restricted-identity check could not finish. Review the rental and retry the check." });
} });

export const purge = internalMutation({ args: {}, handler: async ctx => {
  const rows = await ctx.db.query("restricted_identity_alert_jobs").withIndex("by_state_expiry", q => q.eq("state", "complete").lte("expiresAt", Date.now())).take(50);
  for (const row of rows) await ctx.db.delete(row._id);
  const rechecks=await ctx.db.query("restricted_identity_recheck_jobs").withIndex("by_state_expiry",q=>q.eq("state","complete").lte("expiresAt",Date.now())).take(50);
  for(const row of rechecks)await ctx.db.delete(row._id);
} });

export const dispatchDue = internalAction({ args: {}, handler: async ctx => {
  const rechecks=await ctx.runQuery(internal.restrictedIdentityAlerts.dueRechecks,{});
  for(const job of rechecks){
    try{await ctx.runMutation(internal.restrictedIdentityAlerts.processRecheckPage,{id:job._id,generation:job.generation,attempt:job.attempts});}
    catch{try{await ctx.runMutation(internal.restrictedIdentityAlerts.recordRecheckFailure,{id:job._id,generation:job.generation,attempt:job.attempts});}catch{console.error("Could not record a restricted-account recheck retry.");}}
  }
  const jobs = await ctx.runQuery(internal.restrictedIdentityAlerts.due, {});
  for (const job of jobs) {
    try { await ctx.runMutation(internal.restrictedIdentityAlerts.processOne, { id: job._id, eventId: job.eventId, generation: job.generation, attempt: job.attempts }); }
    catch {
      try { await ctx.runMutation(internal.restrictedIdentityAlerts.recordFailure, { id: job._id, eventId: job.eventId, generation: job.generation, attempt: job.attempts }); }
      catch { console.error("Could not record a restricted identity alert retry."); }
    }
  }
  await ctx.runMutation(internal.restrictedIdentityAlerts.purge, {});
} });

export const attention = query({ args: { token: v.string() }, handler: async (ctx, args) => {
  if (!await identityAdminRead(ctx, args.token)) return [];
  const jobs = await ctx.db.query("restricted_identity_alert_jobs").withIndex("by_state_due", q => q.eq("state", "attention")).take(20);
  return jobs.map(job => ({ id: job._id, bookingId: job.bookingId, attempts: job.attempts, updatedAt: job.updatedAt }));
} });
export const recheckAttention=query({args:{token:v.string()},handler:async(ctx,args)=>{
  if(!await identityAdminRead(ctx,args.token))return [];
  const jobs=await ctx.db.query("restricted_identity_recheck_jobs").withIndex("by_state_due",q=>q.eq("state","attention")).take(20);
  return jobs.map(job=>({id:job._id,accountId:job.accountId,attempts:job.attempts,updatedAt:job.updatedAt}));
}});
export const retryRecheck=mutation({args:{token:v.string(),id:v.id("restricted_identity_recheck_jobs")},handler:async(ctx,args)=>{
  await identityAdminWrite(ctx,args.token,"restrictedIdentityAlerts.retryRecheck");const job=await ctx.db.get(args.id);if(!job||job.state!=="attention")throw Error("This account recheck does not need retrying.");
  await ctx.db.patch(job._id,{state:"pending",generation:job.generation+1,attempts:0,dueAt:Date.now(),updatedAt:Date.now()});
}});

export const retry = mutation({ args: { token: v.string(), id: v.id("restricted_identity_alert_jobs") }, handler: async (ctx, args) => {
  await identityAdminWrite(ctx, args.token, "restrictedIdentityAlerts.retry");
  const job = await ctx.db.get(args.id);
  if (!job || job.state !== "attention") throw Error("This identity check does not need retrying.");
  await ctx.db.patch(job._id, { state: "pending", generation: job.generation + 1, attempts: 0, dueAt: Date.now(), updatedAt: Date.now() });
} });
