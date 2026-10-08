import { internal } from "../_generated/api";
/** Durable delivery state is committed in the same transaction as the rental. */
export async function queueRmv2Sync(ctx: any, bookingId: any) {
  const booking = await ctx.db.get(bookingId);
  if (!booking) throw Error("Cannot queue a missing rental");
  await ctx.db.patch(bookingId, { rmv2Revision: (booking.rmv2Revision ?? 0) + 1, rmv2SyncStatus: "pending", rmv2SyncAttempts: 0, rmv2SyncDueAt: Date.now(), rmv2SyncError: undefined, rmv2SyncLeaseUntil: undefined });
  await ctx.scheduler.runAfter(0, internal.rmv2_webhook.push, { bookingId });
}
