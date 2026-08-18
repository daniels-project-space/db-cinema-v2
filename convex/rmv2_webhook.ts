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
 * Fire-and-forget by design: this NEVER throws. A booking confirmation must not
 * fail because a downstream analytics/ops system is unreachable — the fallback
 * poll is what makes that safe.
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
    const url = process.env.RMV2_WEBHOOK_URL;
    const secret = process.env.RMV2_WEBHOOK_SECRET;
    if (!url || !secret) {
      console.error(
        "[rmv2_webhook] missing RMV2_WEBHOOK_URL / RMV2_WEBHOOK_SECRET — skipping push",
      );
      return { ok: false, reason: "missing_config" };
    }

    // Any status — RMv2 needs cancellations too, not just the paid set.
    const booking = await ctx.runQuery(internal.rmv2_sync.forRmv2SyncOne, {
      bookingId,
    });
    if (!booking) {
      console.error("[rmv2_webhook] booking not found:", bookingId);
      return { ok: false, reason: "not_found" };
    }

    try {
      const resp = await fetch(url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-dbcinema-sync-token": secret,
        },
        body: JSON.stringify({ booking }),
      });
      if (!resp.ok) {
        console.error(
          `[rmv2_webhook] push rejected (${resp.status}) for booking ${bookingId}; fallback poll will reconcile`,
        );
        return { ok: false, reason: `http_${resp.status}` };
      }
      return { ok: true };
    } catch (err) {
      console.error(
        "[rmv2_webhook] push failed:",
        err instanceof Error ? err.message : err,
      );
      return { ok: false, reason: "fetch_error" };
    }
  },
});
