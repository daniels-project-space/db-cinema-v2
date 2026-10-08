/**
 * Event-driven push of a single booking UP to Rental Manager v2 (2026-08-18).
 *
 * Previously RMv2 learned about storefront bookings ONLY by polling
 * `rmv2_sync:forRmv2Sync` every 30 minutes — so a confirmation could sit
 * invisible in RMv2 for up to half an hour, and the poll re-read the whole
 * bookings + listings + inventory_units + customers tables every cycle whether
 * anything had changed or not.
 *
 * This flips the primary path to push: each state-changing booking mutation
 * schedules `push`, which sends just that one booking to RMv2's HTTP endpoint.
 * The poll stays as a reliability fallback (widened to 8h in RMv2's crons.ts) so
 * a dropped push self-heals on the next cycle.
 *
 * Delivery failures are recorded for the durable retry cron. A booking
 * confirmation remains independent of downstream service availability.
 *
 * Env (Convex deployment vars, NOT committed):
 *   RMV2_WEBHOOK_URL     https://<rmv2-deployment>.convex.site/dbcinema/booking-sync
 *   RMV2_WEBHOOK_SECRET  shared secret, sent as `x-dbcinema-sync-token`
 * Both absent → no-op with a logged error (lets the storefront run standalone).
 */
import { internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";

export const push = internalAction({
  args: { bookingId: v.id("bookings") },
  handler: async (
    ctx,
    { bookingId },
  ): Promise<{ ok: boolean; reason?: string }> => {
    const booking = await ctx.runQuery(internal.rmv2_sync.forRmv2SyncOne, { bookingId });
    if (!booking) return { ok: false, reason: "not_found" };
    const revision = booking.revision ?? 0;
    const claim = await ctx.runMutation(internal.rmv2Delivery.claim, { bookingId, revision });
    if (!claim) return { ok: false, reason: "not_due_or_claimed" };
    const generation = claim.generation;
    async function result(ok: boolean, reason?: string) {
      await ctx.runMutation(internal.rmv2Delivery.record, { bookingId, revision, generation, ok, ...(reason ? { reason } : {}) });
      return { ok, ...(reason ? { reason } : {}) };
    }
    const url = process.env.RMV2_WEBHOOK_URL;
    const secret = process.env.RMV2_WEBHOOK_SECRET;
    if (!url || !secret) {
      console.error(
        "[rmv2_webhook] missing RMV2_WEBHOOK_URL / RMV2_WEBHOOK_SECRET — skipping push",
      );
      return result(false, "missing_config");
    }

    try {
      const resp = await fetch(url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-dbcinema-sync-token": secret,
        },
        body: JSON.stringify({ booking }),
        signal: AbortSignal.timeout(20000),
      });
      if (!resp.ok) {
        console.error(
          `[rmv2_webhook] push rejected (${resp.status}) for booking ${bookingId}; fallback poll will reconcile`,
        );
        return result(false, `http_${resp.status}`);
      }
      const receipt = await resp.json();
      const applied = receipt?.appliedRevision === revision && ["applied", "unchanged"].includes(receipt?.outcome);
      const unpaid = booking.status === "pending_payment" && receipt?.outcome === "ignored" && receipt?.reason === "unpaid" && receipt?.appliedRevision === null;
      if (receipt?.ok !== true || receipt.version !== 1 || receipt.bookingId !== bookingId || receipt.receivedRevision !== revision || !applied && !unpaid) return result(false, "invalid_receipt");
      return result(true);
    } catch (err) {
      console.error(
        "[rmv2_webhook] push failed:",
        err instanceof Error ? err.message : err,
      );
      return result(false, "fetch_error");
    }
  },
});

export const retryDue = internalAction({ args: {}, handler: async ctx => {
  const bookings = await ctx.runQuery(internal.rmv2Delivery.due, {});
  for (const booking of bookings) {
    try { await ctx.runAction(internal.rmv2_webhook.push, { bookingId: booking._id }); }
    catch { console.error("[rmv2_webhook] retry failed; durable delivery remains pending", booking._id); }
  }
} });
