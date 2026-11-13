import { internalMutation, internalQuery } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import { queueOwnerNotification } from "./lib/adminPush";
import { accountForRental } from "./lib/rentalAccount";

const KEY = "open-sessions";
const LEASE_MS = 10 * 60000;
const PAGE_SIZE = 100;
const BATCH_SIZE = 50;
const VERIFICATION_STATUSES = ["pending_verification", "confirmed", "active"] as const;

export const start = internalMutation({
  args: {},
  handler: async (ctx) => {
    const state = await ctx.db.query("didit_reconcile_sweeps").withIndex("by_key", q => q.eq("key", KEY)).unique();
    if (state && state.phase !== "idle" && state.updatedAt > Date.now() - LEASE_MS) return;
    const generation = (state?.generation ?? 0) + 1;
    const next = { key: KEY, generation, phase: VERIFICATION_STATUSES[0], updatedAt: Date.now(), cursor: undefined, candidates: [] };
    if (state) await ctx.db.patch(state._id, next); else await ctx.db.insert("didit_reconcile_sweeps", next);
    await ctx.scheduler.runAfter(0, internal.diditSweep.page, { generation });
  },
});

export const page = internalMutation({
  args: { generation: v.number() },
  handler: async (ctx, { generation }) => {
    const state = await ctx.db.query("didit_reconcile_sweeps").withIndex("by_key", q => q.eq("key", KEY)).unique();
    if (!state || state.generation !== generation || !VERIFICATION_STATUSES.includes(state.phase as typeof VERIFICATION_STATUSES[number])) return;
    const status = state.phase as typeof VERIFICATION_STATUSES[number];
    const page = await ctx.db.query("bookings").withIndex("by_verificationProvider_status", q =>
      q.eq("verificationProvider", "didit").eq("status", status))
      .paginate({ numItems: PAGE_SIZE, cursor: state.cursor ?? null });
    for (const booking of page.page) if (booking.diditSessionId && !booking.guestEmail?.trim())
      await ctx.scheduler.runAfter(0, internal.diditSweep.missingEmail, { bookingId: booking._id, sessionId: booking.diditSessionId });
    const candidates = [...state.candidates, ...page.page.filter(row => !!row.diditSessionId && !!row.guestEmail?.trim()).map(row => ({
      bookingId: row._id, sessionId: row.diditSessionId!, email: row.guestEmail!,
      checkedAt: row.diditReconciledAt ?? 0, createdAt: row._creationTime, status,
    }))].sort((left, right) => left.checkedAt - right.checkedAt ||
      VERIFICATION_STATUSES.indexOf(left.status as typeof VERIFICATION_STATUSES[number]) - VERIFICATION_STATUSES.indexOf(right.status as typeof VERIFICATION_STATUSES[number]) ||
      left.createdAt - right.createdAt || String(left.bookingId).localeCompare(String(right.bookingId))).slice(0, BATCH_SIZE);
    const phase = !page.isDone ? status : status === "pending_verification" ? "confirmed" :
      status === "confirmed" ? "active" : "dispatch";
    await ctx.db.patch(state._id, { phase, cursor: page.isDone ? undefined : page.continueCursor, candidates, updatedAt: Date.now() });
    if (phase === "dispatch") await ctx.scheduler.runAfter(0, internal.didit.reconcileOpenSessions, { generation });
    else await ctx.scheduler.runAfter(0, internal.diditSweep.page, { generation });
  },
});

export const missingEmail = internalMutation({
  args: { bookingId:v.id("bookings"), sessionId:v.string() },
  handler: async (ctx,{bookingId,sessionId}) => {
    const booking=await ctx.db.get(bookingId);
    if (!booking || booking.verificationProvider!=="didit" || !VERIFICATION_STATUSES.includes(booking.status as typeof VERIFICATION_STATUSES[number]) ||
        booking.diditSessionId!==sessionId || booking.guestEmail?.trim()) return;
    const account=await accountForRental(ctx,booking);
    await queueOwnerNotification(ctx,{eventKey:`didit-missing-email:${bookingId}:${sessionId}:${Math.floor(Date.now()/86400000)}`,
      kind:"verification_failure",...(account?{accountId:account._id}:{}),bookingId,
      title:"Verification needs a contact email",body:"This rental's verification cannot be reconciled until its contact email is repaired. Review the rental and provider case."});
  },
});

export const batch = internalQuery({
  args: { generation: v.number() },
  handler: async (ctx, { generation }) => {
    const state = await ctx.db.query("didit_reconcile_sweeps").withIndex("by_key", q => q.eq("key", KEY)).unique();
    if (!state || state.generation !== generation || state.phase !== "dispatch") return [];
    const bookings = await Promise.all(state.candidates.map(candidate => ctx.db.get(candidate.bookingId)));
    return state.candidates.flatMap((candidate, index) => {
      const booking = bookings[index];
      if (!(booking?.verificationProvider === "didit" && VERIFICATION_STATUSES.includes(booking.status as typeof VERIFICATION_STATUSES[number]) &&
        booking.diditSessionId === candidate.sessionId && booking.guestEmail === candidate.email &&
        (booking.diditReconciledAt ?? 0) === candidate.checkedAt)) return [];
      return [{ bookingId: candidate.bookingId, sessionId: candidate.sessionId, email: candidate.email,
        expectedEventId: booking.diditEventId ?? null, expectedEventAt: booking.diditEventAt ?? null,
        expectedManualDecisionAt: booking.diditManualDecisionAt ?? null }];
    });
  },
});

export const configurationFailure = internalMutation({
  args: { generation: v.number() },
  handler: async (ctx, { generation }) => {
    const state = await ctx.db.query("didit_reconcile_sweeps").withIndex("by_key", q => q.eq("key", KEY)).unique();
    if (!state || state.generation !== generation || state.phase !== "dispatch") return;
    await queueOwnerNotification(ctx, { eventKey: `didit-configuration:${Math.floor(Date.now() / 86400000)}`,
      kind: "verification_failure", title: "Verification configuration needs attention",
      body: "Verification reconciliation cannot run because its provider configuration is incomplete. Check the verification service settings." });
  },
});

export const finish = internalMutation({
  args: { generation: v.number() },
  handler: async (ctx, { generation }) => {
    const state = await ctx.db.query("didit_reconcile_sweeps").withIndex("by_key", q => q.eq("key", KEY)).unique();
    if (state?.generation === generation && state.phase === "dispatch")
      await ctx.db.patch(state._id, { phase: "idle", candidates: [], updatedAt: Date.now() });
  },
});
