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

type PaidCheckoutEvidence =
  | { status: "succeeded"; paymentIntentId: string; paidAt: number }
  | { status: "no_payment_required"; checkoutSessionId: string; paidAt: number };
import { v } from "convex/values";

export const push = internalAction({
  args: { bookingId: v.id("bookings") },
  handler: async (
    ctx,
    { bookingId },
  ): Promise<{ ok: boolean; reason?: string }> => {
    if(process.env.RMV2_OUTBOUND_ENABLED==="false")return {ok:false,reason:"delivery_disabled"};
    const booking = await ctx.runQuery(internal.rmv2_sync.forRmv2SyncOne, { bookingId });
    if (!booking) return { ok: false, reason: "not_found" };
    const revision = booking.revision ?? 0;
    const claim = await ctx.runMutation(internal.rmv2Delivery.claim, { bookingId, revision });
    if (!claim) return { ok: false, reason: "not_due_or_claimed" };
    const generation = claim.generation;
    async function result(ok: boolean, reason?: string, stockAcknowledgement?:any, deferred = false) {
      await ctx.runMutation(internal.rmv2Delivery.record, { bookingId, revision, generation, ok, ...(reason ? { reason } : {}), ...(stockAcknowledgement?{stockAcknowledgement}:{}), ...(deferred ? {deferred:true} : {}) });
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
      const stock=(booking as typeof booking & {stockApplicationReceipt?:{kind?:string;swapId?:string;managerRequestId:string;fingerprint:string;executionKey:string;bookingRevision:number}}).stockApplicationReceipt,ack=receipt.stockAcknowledgement;
      const receiptMatchesPush = receipt?.ok === true && receipt.version === 1 && receipt.bookingId === bookingId && receipt.receivedRevision === revision;
      const deferredStock = receiptMatchesPush && !stock && receipt.outcome === "deferred_stock_claim" && Number.isSafeInteger(receipt.appliedRevision);
      if (!receiptMatchesPush || !applied && !unpaid && !deferredStock) return result(false, "invalid_receipt");
      if (deferredStock) return result(true, "waiting_for_stock_receipt", undefined, true);
      if(stock&&(!applied||!ack||ack.managerRequestId!==stock.managerRequestId||ack.fingerprint!==stock.fingerprint||ack.executionKey!==stock.executionKey||ack.bookingRevision!==stock.bookingRevision))return result(false,"invalid_stock_acknowledgement");

      const verification = booking.verification;
      const releaseReason = booking.status === "returned" ? "booking_returned" as const
        : verification?.status === "rejected" ? "verification_declined" as const
        : verification?.status === "expired" ? "verification_expired" as const
        : booking.status === "cancelled" ? "booking_cancelled" as const : null;
      if (releaseReason) {
        const released = await ctx.runAction(internal.sharedStockBridge.send, { request: { operation: "releaseBooking", args: {
          bookingId: String(booking.id), bookingRevision: revision,
          eventId: `booking_${booking.id}_${revision}_${releaseReason}`, reason: releaseReason,
        } } });
        if (released.status !== "confirmed" || released.result.operation !== "releaseBooking" || released.result.bookingId !== String(booking.id))
          return result(false, "shared_stock_release_unconfirmed");
      } else if (booking.status === "pending_verification" && verification?.provider === "didit" &&
          typeof booking.checkoutPaidAt === "number" && booking.checkoutPaidAt > 0 &&
          !["rejected", "expired"].includes(verification.status ?? "")) {
        // The generated API declaration predates this projection field; keep
        // the runtime payload tied to the explicit sync contract until Convex
        // codegen is available in the deployment workspace.
        const evidence = (booking as typeof booking & { paymentEvidence?: PaidCheckoutEvidence }).paymentEvidence;
        const physical = Array.isArray(booking.physicalReservations) ? booking.physicalReservations : [];
        if (!evidence || !physical.length) return result(false, "paid_pending_stock_evidence_missing");
        const items = physical.map((row: any) => ({
          itemId: row.rmv2ItemId,
          start: row.start,
          returnAt: row.end - (row.endExclusive ? 60 * 60 * 1000 : 0),
          quantity: row.qty,
        }));
        if (items.some((line: any) => typeof line.itemId !== "string" || !line.itemId ||
          !Number.isSafeInteger(line.start) || !Number.isSafeInteger(line.returnAt) || line.returnAt <= line.start ||
          !Number.isSafeInteger(line.quantity) || line.quantity < 1))
          return result(false, "paid_pending_stock_window_invalid");
        const acquired = await ctx.runAction(internal.sharedStockBridge.send, { request: { operation: "acquirePaidBooking", args: {
          requestId: `booking_${booking.id}`, bookingId: String(booking.id), bookingRevision: revision,
          verificationState: "pending", paymentEvidence: evidence, items,
        } } });
        if (acquired.status === "capacity_conflict") return result(false, "paid_pending_stock_capacity_conflict");
        const paidClaim = acquired.status === "confirmed" ? acquired.result as {
          operation?: string; bookingId?: string; outcome?: string; holdsStock?: boolean;
        } : null;
        const claimHoldsStock = paidClaim?.outcome === "execution_started" && paidClaim.holdsStock === true;
        const reservationTookOver = paidClaim?.outcome === "converted" && paidClaim.holdsStock === false;
        if (acquired.status !== "confirmed" || paidClaim?.operation !== "acquirePaidBooking" ||
            paidClaim.bookingId !== String(booking.id) || !(claimHoldsStock || reservationTookOver))
          return result(false, "paid_pending_stock_claim_unconfirmed");
      }
      return result(true,undefined,stock?{...ack,...(stock.kind==="booking_confirmation"?{kind:"booking_confirmation"}:{swapId:stock.swapId})}:undefined);
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
  if(process.env.RMV2_OUTBOUND_ENABLED==="false")return;
  await ctx.runAction((internal as any).bookingStockClaims.reconcile, {});
  await ctx.runAction(internal.managerNotifications.retryDue, {});
  try{await ctx.runAction(internal.managerCheckoutStockPush.push, {});}catch{console.error("[rmv2_webhook] website checkout stock sync requires attention");}
  const bookings = await ctx.runQuery(internal.rmv2Delivery.due, {});
  for (const booking of bookings) {
    try { await ctx.runAction(internal.rmv2_webhook.push, { bookingId: booking._id }); }
    catch { console.error("[rmv2_webhook] retry failed; durable delivery remains pending", booking._id); }
  }
} });
