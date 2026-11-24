import { internalAction, internalMutation, internalQuery, mutation, query } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import { linkCaseIdentity } from "./lib/caseIdentity";
import { approvedRestrictedIdentitySource, notifyRestrictedIdentityMatch } from "./lib/restrictedIdentityMatch";
import { queueOwnerNotification } from "./lib/adminPush";
import { assertAdmin, checkAdminToken } from "./adminAuth";
import { adminSessionMigrationReady, assertAdminScopeSession, assertCustomerReadSession } from "./adminAccountSessionV2";
import { paginationOptsValidator } from "convex/server";

const stages = ["pending_verification", "confirmed", "active"] as const;
const currentPaid = (booking: any) => ["pending_verification", "confirmed", "active"].includes(booking?.status) &&
  ((Number.isSafeInteger(booking.checkoutPaidAt) && booking.checkoutPaidAt > 0) || (Number.isSafeInteger(booking.paidConfirmedAt) && booking.paidConfirmedAt > 0));

export const backfill = internalMutation({ args: { generation: v.number(), attempt: v.number(), cursor: v.optional(v.string()) }, handler: async (ctx, args) => {
  let state = await ctx.db.query("rental_case_identity_backfill").withIndex("by_key", query => query.eq("key", "v1")).unique();
  if (!state) {
    const id = await ctx.db.insert("rental_case_identity_backfill", { key: "v1", updatedAt: Date.now() });
    state = await ctx.db.get(id);
  }
  if (!state || state.completedAt || state.attentionAt || (state.generation ?? 0) !== args.generation || (state.attempts ?? 0) !== args.attempt || state.cursor !== args.cursor) return;
  const page = await ctx.db.query("rental_damage_cases").withIndex("by_opened", query => query.gte("openedAt", 0)).paginate({ cursor: state.cursor ?? null, numItems: 25, maximumRowsRead: 25 });
  for (const record of page.page) {
    const booking = await ctx.db.get(record.bookingId);
    if (booking) await linkCaseIdentity(ctx, record, booking);
  }
  await ctx.db.patch(state._id, page.isDone ? { cursor: undefined, completedAt: Date.now(), attempts: 0, updatedAt: Date.now() } : { cursor: page.continueCursor, attempts: 0, updatedAt: Date.now() });
  if (!page.isDone) await ctx.scheduler.runAfter(0, (internal as any).caseIdentity.runBackfill, {});
} });

export const backfillFailure = internalMutation({ args: { generation: v.number(), attempt: v.number(), cursor: v.optional(v.string()) }, handler: async (ctx, args) => {
  let state = await ctx.db.query("rental_case_identity_backfill").withIndex("by_key", query => query.eq("key", "v1")).unique();
  if (!state) {
    const id = await ctx.db.insert("rental_case_identity_backfill", { key: "v1", updatedAt: Date.now() });
    state = await ctx.db.get(id);
  }
  if (!state || state.completedAt || state.attentionAt || (state.generation ?? 0) !== args.generation || (state.attempts ?? 0) !== args.attempt || state.cursor !== args.cursor) return;
  const attempts = (state.attempts ?? 0) + 1;
  await ctx.db.patch(state._id, { attempts, ...(attempts >= 5 ? { attentionAt: Date.now() } : {}), updatedAt: Date.now() });
  if (attempts === 5) await queueOwnerNotification(ctx, { eventKey: `case-identity-backfill-failed:v1:${args.generation}`, kind: "identity_match", title: "Case history check needs attention", body: "The historical case identity check could not finish. Review case history before handover." });
} });

export const backfillGeneration = internalQuery({ args: {}, handler: async ctx => {
  const state = await ctx.db.query("rental_case_identity_backfill").withIndex("by_key", query => query.eq("key", "v1")).unique();
  return { generation: state?.generation ?? 0, attempt: state?.attempts ?? 0, ...(state?.cursor ? { cursor: state.cursor } : {}) };
} });
export const runBackfill = internalAction({ args: {}, handler: async ctx => {
  const checkpoint = await ctx.runQuery((internal as any).caseIdentity.backfillGeneration, {});
  try { await ctx.runMutation((internal as any).caseIdentity.backfill, checkpoint); }
  catch { await ctx.runMutation((internal as any).caseIdentity.backfillFailure, checkpoint); }
} });

export const backfillStatus = query({ args: { token: v.string() }, handler: async (ctx, args) => {
  if (process.env.ADMIN_SESSION_IDENTITY_ALERTS_V2 === "enabled") {
    if (!adminSessionMigrationReady()) throw Error("Admin session migration is not ready.");
    await assertAdminScopeSession(ctx, args.token, "verification:read");
  } else if (!checkAdminToken(args.token)) throw Error("unauthorized");
  const state = await ctx.db.query("rental_case_identity_backfill").withIndex("by_key", query => query.eq("key", "v1")).unique();
  return { needsAttention: !!state?.attentionAt };
} });

export const retryBackfill = mutation({ args: { token: v.string() }, handler: async (ctx, args) => {
  if (process.env.ADMIN_SESSION_IDENTITY_ALERTS_V2 === "enabled") {
    if (!adminSessionMigrationReady()) throw Error("Admin session migration is not ready.");
    await assertAdminScopeSession(ctx, args.token, "verification:write");
    await ctx.db.insert("admin_audit_log", { at: Date.now(), success: true, limited: false, fn: "caseIdentity.retryBackfill" });
  } else await assertAdmin(ctx, args.token, "caseIdentity.retryBackfill");
  const state = await ctx.db.query("rental_case_identity_backfill").withIndex("by_key", query => query.eq("key", "v1")).unique();
  if (!state?.attentionAt || state.completedAt) throw Error("No failed case history check to retry.");
  await ctx.db.patch(state._id, { attentionAt: undefined, attempts: 0, generation: (state.generation ?? 0) + 1, updatedAt: Date.now() });
  await ctx.scheduler.runAfter(0, (internal as any).caseIdentity.runBackfill, {});
} });

export const due = internalQuery({ args: {}, handler: async ctx => ({
  bookings: await ctx.db.query("rental_case_identity_jobs").withIndex("by_state_due", query => query.eq("state", "pending").lte("dueAt", Date.now())).take(10),
  rechecks: await ctx.db.query("rental_case_identity_rechecks").withIndex("by_state_due", query => query.eq("state", "pending").lte("dueAt", Date.now())).take(10),
  scans: await ctx.db.query("rental_case_identity_scans").withIndex("by_state_due", query => query.eq("state", "pending").lte("dueAt", Date.now())).take(10),
}) });

export const processBooking = internalMutation({ args: { id: v.id("rental_case_identity_jobs"), generation: v.number(), attempt: v.number() }, handler: async (ctx, args) => {
  const job = await ctx.db.get(args.id);
  if (!job || job.state !== "pending" || job.generation !== args.generation || job.attempts !== args.attempt || job.dueAt > Date.now()) return;
  const booking = await ctx.db.get(job.bookingId);
  if (!booking) throw Error("Case rental is unavailable.");
  const page = await ctx.db.query("rental_damage_cases").withIndex("by_booking", query => query.eq("bookingId", job.bookingId)).paginate({ cursor: job.cursor ?? null, numItems: 25, maximumRowsRead: 25 });
  for (const record of page.page) await linkCaseIdentity(ctx, record, booking);
  await ctx.db.patch(job._id, { state: page.isDone ? "complete" : "pending", cursor: page.isDone ? undefined : page.continueCursor, attempts: 0, dueAt: Date.now(), updatedAt: Date.now() });
} });

export const processRecheck = internalMutation({ args: { id: v.id("rental_case_identity_rechecks"), generation: v.number(), attempt: v.number() }, handler: async (ctx, args) => {
  const job = await ctx.db.get(args.id);
  if (!job || job.state !== "pending" || job.generation !== args.generation || job.attempts !== args.attempt || job.dueAt > Date.now()) return;
  const link = await ctx.db.get(job.linkId);
  const record = link ? await ctx.db.get(link.caseId) : null;
  if (!link || !record || link.bookingId !== record.bookingId || link.personKey !== job.personKey) throw Error("Case identity link needs review.");
  const status = stages[job.stage];
  if (!status) throw Error("Invalid case identity recheck stage.");
  const page = await ctx.db.query("bookings").withIndex("by_person_status", query => query.eq("renterPersonKey", job.personKey).eq("status", status)).order("asc").paginate({ cursor: job.cursor ?? null, numItems: 25, maximumRowsRead: 25 });
  for (const booking of page.page) if (currentPaid(booking) && await approvedRestrictedIdentitySource(ctx, booking)) await notifyRestrictedIdentityMatch(ctx, booking, job.personKey);
  const complete = page.isDone && job.stage === stages.length - 1;
  await ctx.db.patch(job._id, { state: complete ? "complete" : "pending", stage: page.isDone ? job.stage + 1 : job.stage, cursor: page.isDone ? undefined : page.continueCursor, attempts: 0, dueAt: Date.now(), updatedAt: Date.now() });
} });

export const processScan = internalMutation({ args: { id: v.id("rental_case_identity_scans"), generation: v.number(), attempt: v.number() }, handler: async (ctx, args) => {
  const job = await ctx.db.get(args.id);
  if (!job || job.state !== "pending" || job.generation !== args.generation || job.attempts !== args.attempt || job.dueAt > Date.now()) return;
  const booking = await ctx.db.get(job.bookingId);
  const alertEventKey = job.alertEventKey;
  const alert = alertEventKey ? await ctx.db.query("admin_notifications").withIndex("by_event", query => query.eq("eventKey", alertEventKey)).first() : null;
  if (!booking || booking.renterPersonKey !== job.personKey || !currentPaid(booking) || !await approvedRestrictedIdentitySource(ctx, booking)) {
    if (alert && !alert.read) await ctx.db.patch(alert._id, { read: true });
    await ctx.db.patch(job._id, { state: "complete", updatedAt: Date.now() });
    return;
  }
  const page = await ctx.db.query("rental_case_identity_links").withIndex("by_person", query => query.eq("personKey", job.personKey)).paginate({ cursor: job.cursor ?? null, numItems: 25, maximumRowsRead: 25 });
  let found = job.found;
  for (const link of page.page) {
    const record = !link.revokedAt ? await ctx.db.get(link.caseId) : null;
    const source = record && record.bookingId === link.bookingId ? await ctx.db.get(link.bookingId) : null;
    if (source && Number.isSafeInteger(link.verifiedAt) && link.verifiedAt > 0 && ["didit", "reused_didit"].includes(link.source)) found = true;
  }
  if (found && !job.hadMatch) {
    const eventKey = `case-identity-match:${booking._id}:${job.generation}:${job.round ?? 0}`;
    await queueOwnerNotification(ctx, { eventKey, kind: "identity_match", ...(booking.accountId ? { accountId: booking.accountId } : {}), bookingId: booking._id, title: "Possible match to a rental case", body: "An approved identity matches a renter with a previous or open rental case. Open the renter’s account to compare the case. No automatic block was applied." });
    await ctx.db.patch(job._id, { alertEventKey: eventKey });
  }
  if (page.isDone && !found && alert && !alert.read) await ctx.db.patch(alert._id, { read: true });
  await ctx.db.patch(job._id, { cursor: page.isDone ? undefined : page.continueCursor, found: page.isDone ? false : found, ...(found ? { hadMatch: true } : page.isDone ? { hadMatch: false } : {}), ...(page.isDone ? { round: (job.round ?? 0) + 1 } : {}), attempts: 0, dueAt: Date.now() + (page.isDone ? 3600000 : 0), updatedAt: Date.now() });
} });

export const matchingCases = query({ args: { token: v.string(), bookingId: v.id("bookings"), paginationOpts: paginationOptsValidator }, handler: async (ctx, args) => {
  if (process.env.ADMIN_SESSION_IDENTITY_ALERTS_V2 === "enabled" || process.env.ADMIN_SESSION_CUSTOMER_READ_V2 === "enabled" || process.env.ADMIN_SESSION_RENTAL_CASES_V2 === "enabled") {
    if (!adminSessionMigrationReady()) throw Error("Admin session migration is not ready.");
    await assertAdminScopeSession(ctx, args.token, "verification:read");
    await assertCustomerReadSession(ctx, args.token);
    await assertAdminScopeSession(ctx, args.token, "rentals:read");
  } else if (!checkAdminToken(args.token)) throw Error("unauthorized");
  if (args.paginationOpts.numItems < 1 || args.paginationOpts.numItems > 25) throw Error("Invalid page size.");
  const booking = await ctx.db.get(args.bookingId);
  if (!booking?.renterPersonKey || !currentPaid(booking) || !await approvedRestrictedIdentitySource(ctx, booking)) return { page: [], isDone: true, continueCursor: "" };
  const personKey = booking.renterPersonKey;
  const result = await ctx.db.query("rental_case_identity_links").withIndex("by_person", query => query.eq("personKey", personKey)).paginate({ ...args.paginationOpts, maximumRowsRead: 25 });
  const page = [];
  for (const link of result.page) {
    if (link.revokedAt) continue;
    const record = await ctx.db.get(link.caseId);
    const source = record && record.bookingId === link.bookingId ? await ctx.db.get(link.bookingId) : null;
    if (record && source && Number.isSafeInteger(link.verifiedAt) && link.verifiedAt > 0 && ["didit", "reused_didit"].includes(link.source)) page.push({ caseId: record._id, bookingId: record.bookingId, status: record.status, title: record.title, details: record.details, resolution: record.resolution ?? null, openedAt: record.openedAt });
  }
  return { page, isDone: result.isDone, continueCursor: result.continueCursor };
} });

export const failure = internalMutation({ args: { id: v.union(v.id("rental_case_identity_jobs"), v.id("rental_case_identity_rechecks"), v.id("rental_case_identity_scans")), generation: v.number(), attempt: v.number() }, handler: async (ctx, args) => {
  const job = await ctx.db.get(args.id);
  if (!job || job.state !== "pending" || job.generation !== args.generation || job.attempts !== args.attempt) return;
  const attempts = job.attempts + 1;
  await ctx.db.patch(job._id, { attempts, state: attempts >= 5 ? "attention" : "pending", dueAt: Date.now() + Math.min(60, 2 ** (attempts - 1)) * 60000, updatedAt: Date.now() });
  if (attempts === 5) await queueOwnerNotification(ctx, { eventKey: `case-identity-check-failed:${job._id}:${job.generation}`, kind: "identity_match", title: "Case identity check needs attention", body: "A case identity check could not finish. Review the case before handover." });
} });

export const dispatchDue = internalAction({ args: {}, handler: async ctx => {
  const jobs = await ctx.runQuery((internal as any).caseIdentity.due, {});
  for (const [rows, handler] of [[jobs.bookings, (internal as any).caseIdentity.processBooking], [jobs.rechecks, (internal as any).caseIdentity.processRecheck], [jobs.scans, (internal as any).caseIdentity.processScan]] as const) {
    for (const job of rows) {
      const args = { id: job._id, generation: job.generation, attempt: job.attempts };
      try { await ctx.runMutation(handler, args); }
      catch { await ctx.runMutation((internal as any).caseIdentity.failure, args); }
    }
  }
} });
