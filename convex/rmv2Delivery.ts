import { query, mutation, internalQuery, internalMutation } from "./_generated/server";
import { v } from "convex/values";
import { assertAdmin, checkAdminToken } from "./adminAuth";
import { queueRmv2Sync } from "./lib/rmv2SyncQueue";

export const due = internalQuery({ args: {}, handler: async ctx => ctx.db.query("bookings").withIndex("by_rmv2_sync_due", q => q.eq("rmv2SyncStatus", "pending").lte("rmv2SyncDueAt", Date.now())).take(10) });
export const claim = internalMutation({ args: { bookingId: v.id("bookings"), revision: v.number() }, handler: async (ctx, args) => {
  const b = await ctx.db.get(args.bookingId);
  if (!b || b.rmv2Revision !== args.revision || b.rmv2SyncStatus !== "pending" || (b.rmv2SyncLeaseUntil ?? 0) > Date.now() || (b.rmv2SyncDueAt ?? 0) > Date.now()) return null;
  const generation = (b.rmv2SyncLeaseGeneration ?? 0) + 1;
  if (!Number.isSafeInteger(generation) || generation < 1) throw Error("Invalid delivery lease generation");
  const leaseUntil = Date.now() + 60000;
  await ctx.db.patch(b._id, { rmv2SyncLeaseUntil: leaseUntil, rmv2SyncDueAt: leaseUntil, rmv2SyncLeaseGeneration: generation });
  return { generation };
} });
export const record = internalMutation({ args: { bookingId: v.id("bookings"), revision: v.number(), generation: v.number(), ok: v.boolean(), reason: v.optional(v.string()) }, handler: async (ctx, args) => {
  const booking = await ctx.db.get(args.bookingId);
  if (!booking || (booking.rmv2Revision ?? 0) !== args.revision || booking.rmv2DeliveredRevision === args.revision || booking.rmv2SyncStatus !== "pending" || booking.rmv2SyncLeaseGeneration !== args.generation || typeof booking.rmv2SyncLeaseUntil !== "number") return;
  if (args.ok) {
    await ctx.db.patch(booking._id, { rmv2DeliveredRevision: args.revision, rmv2SyncStatus: "delivered", rmv2SyncDeliveredAt: Date.now(), rmv2SyncError: undefined, rmv2SyncLeaseUntil: undefined });
    return;
  }
  const attempts = (booking.rmv2SyncAttempts ?? 0) + 1;
  await ctx.db.patch(booking._id, { rmv2SyncAttempts: attempts, rmv2SyncStatus: attempts >= 12 ? "attention" : "pending", rmv2SyncDueAt: Date.now() + Math.min(3600000, 30000 * 2 ** Math.min(attempts, 7)), rmv2SyncError: args.reason?.slice(0, 100) ?? "delivery_failed", rmv2SyncLeaseUntil: undefined });
} });
export const status = query({ args: { token: v.string(), bookingId: v.id("bookings") }, handler: async (ctx, args) => {
  if (!checkAdminToken(args.token)) throw Error("unauthorized");
  const b = await ctx.db.get(args.bookingId);
  return b ? { status: b.rmv2SyncStatus ?? "unknown", revision: b.rmv2Revision ?? 0, deliveredRevision: b.rmv2DeliveredRevision ?? null, attempts: b.rmv2SyncAttempts ?? 0, error: b.rmv2SyncError ?? null, deliveredAt: b.rmv2SyncDeliveredAt ?? null } : null;
} });
export const retry = mutation({ args: { token: v.string(), bookingId: v.id("bookings") }, handler: async (ctx, args) => {
  await assertAdmin(ctx, args.token, "rmv2Delivery.retry");
  await queueRmv2Sync(ctx, args.bookingId);
} });
