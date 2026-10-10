import { internalMutation, internalQuery } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import {
  PICKUP_HOLD_POLICY,
  pickupHoldAt,
  pickupHoldEligible,
  uncollectedRentalWindowOpen,
} from "../shared/pickupSecurity";
import { queueRmv2Sync } from "./lib/rmv2SyncQueue";

/** Transactional job identity; old pickup jobs never authorise a rescheduled rental. */
export async function schedulePickupHold(ctx: any, b: any, force=false) {
  if (pickupHoldEligible(b) && b.stripeDepositIntentId && b.securityHoldDueAt !== pickupHoldAt(b))
    throw Error("Resolve the existing security authorisation before moving collection. Your rental dates have not changed.");
  if (
    !pickupHoldEligible(b) ||
    b.stripeDepositIntentId ||
    !b.securityHoldPaymentMethodId
  )
    return;
  const dueAt = pickupHoldAt(b);
  if (!force && b.securityHoldDueAt === dueAt && b.securityHoldJobId) return;
  // Previous jobs are generation-gated; even a job already executing cannot authorise stale dates.
  const generation = (b.securityHoldGeneration ?? 0) + 1;
  const jobId = await ctx.scheduler.runAt(
    Math.max(Date.now(), dueAt),
    internal.holdRenewal.authorizePickup,
    { bookingId: b._id, generation },
  );
  await ctx.db.patch(b._id, {
    securityHoldDueAt: dueAt,
    securityHoldGeneration: generation,
    securityHoldJobId: jobId,
    securityHoldRetryAt: Math.max(Date.now(), dueAt),
    securityHoldAttempts: 0,
    depositHoldStatus: "scheduled",
    securityHoldFailureCode: undefined,
    securityHoldLeaseUntil: undefined,
    securityHoldRecoverySessionId: undefined,
    securityHoldRecoveryGeneration: undefined,
    securityHoldRecoveryReleasedIntentId: undefined,
    securityHoldRecoveryRenewalIntentId: undefined,
  });
  await queueRmv2Sync(ctx, b._id);
}
export const saveCard = internalMutation({
  args: {
    bookingId: v.id("bookings"),
    sessionId: v.string(),
    customerId: v.string(),
    paymentMethodId: v.string(),
  },
  handler: async (ctx, a) => {
    const b = await ctx.db.get(a.bookingId);
    if (!pickupHoldEligible(b) || b!.stripeCheckoutSessionId !== a.sessionId)
      return false;
    if (b!.securityHoldCustomerId && b!.securityHoldCustomerId !== a.customerId)
      throw Error("Saved card customer does not match this rental.");
    if (b!.securityHoldPaymentMethodId) return true; // A late original Checkout replay must not undo a recovered card.
    await ctx.db.patch(a.bookingId, {
      securityHoldCustomerId: a.customerId,
      securityHoldPaymentMethodId: a.paymentMethodId,
    });
    await schedulePickupHold(ctx, {
      ...b,
      securityHoldCustomerId: a.customerId,
      securityHoldPaymentMethodId: a.paymentMethodId,
    });
    return true;
  },
});
export const context = internalQuery({
  args: { bookingId: v.id("bookings") },
  handler: async (ctx, a) => ctx.db.get(a.bookingId),
});
export const claim = internalMutation({
  args: { bookingId: v.id("bookings"), generation: v.number() },
  handler: async (ctx, a) => {
    const b = await ctx.db.get(a.bookingId),
      now = Date.now();
    if (
      !pickupHoldEligible(b) ||
      b!.securityHoldGeneration !== a.generation ||
      pickupHoldAt(b!) !== b!.securityHoldDueAt ||
      b!.securityHoldDueAt! > now ||
      b!.securityHoldLeaseUntil! > now ||
      ["held", "released", "captured"].includes(b!.depositHoldStatus ?? "") ||
      !b!.securityHoldCustomerId ||
      !b!.securityHoldPaymentMethodId ||
      !Number.isSafeInteger(Math.round(b!.depositHoldAmount! * 100))
    )
      return false;
    if (!b!.stripeDepositIntentId && !(b!.securityHoldAttempts ?? 0) && !uncollectedRentalWindowOpen(b,now)) {
      await ctx.db.patch(a.bookingId,{depositHoldStatus:"failed",securityHoldFailureCode:"rental_window_ended",securityHoldRetryAt:undefined});
      return false;
    }
    // Leave the untouched job recoverable while an agreed operation owns the
    // kit/financial lock. Yield its place in the indexed due batch so waiting
    // settlements cannot starve unrelated rentals; reuse the five-minute cron.
    // Already-started provider attempts must still reconcile their outcome.
    if (!b!.stripeDepositIntentId && !(b!.securityHoldAttempts ?? 0) &&
        (b!.activeAdditionId || b!.activeSwapRefundId || b!.activeExtensionId)) {
      if (!(b!.securityHoldRetryAt! > now))
        await ctx.db.patch(a.bookingId, { securityHoldRetryAt: now + 5 * 60000 });
      return false;
    }
    if (["requires_action", "failed"].includes(b!.depositHoldStatus ?? ""))
      return false;
    // Stripe retains idempotency keys for at least 24 hours. Do not turn an
    // unresolved old request into a fresh hold after an outage or delayed job.
    if (!b!.stripeDepositIntentId && (b!.securityHoldAttempts ?? 0) > 0 && now - b!.securityHoldDueAt! >= 23 * 3600000) {
      await ctx.db.patch(a.bookingId, { depositHoldStatus: "failed", securityHoldFailureCode: "provider_outcome_unknown", securityHoldRetryAt: undefined, securityHoldLeaseUntil: undefined });
      await queueRmv2Sync(ctx, a.bookingId);
      return false;
    }
    await ctx.db.patch(a.bookingId, {
      securityHoldLeaseUntil: now + 5 * 60000,
      securityHoldAttempts: (b!.securityHoldAttempts ?? 0) + 1,
      depositHoldStatus: "processing",
    });
    // Return the transaction's immutable generation/card/amount snapshot. A later
    // context query could accidentally pair an old job with rescheduled terms.
    return { ...b, securityHoldAttempts: (b!.securityHoldAttempts ?? 0) + 1 };
  },
});
export const result = internalMutation({
  args: {
    bookingId: v.id("bookings"),
    generation: v.number(),
    intentId: v.optional(v.string()),
    status: v.string(),
    expiresAt: v.optional(v.number()),
    failureCode: v.optional(v.string()),
    retry: v.optional(v.boolean()),
    providerStatus: v.optional(v.string()),
  },
  handler: async (ctx, a) => {
    const b = await ctx.db.get(a.bookingId);
    if (
      !pickupHoldEligible(b) ||
      b!.securityHoldGeneration !== a.generation ||
      pickupHoldAt(b!) !== b!.securityHoldDueAt
    )
      return false;
    if (
      b!.stripeDepositIntentId &&
      a.intentId &&
      b!.stripeDepositIntentId !== a.intentId
    )
      throw Error("A different security hold is already linked.");
    if (a.status === "held" && (a.providerStatus !== "requires_capture" || !Number.isFinite(a.expiresAt) || a.expiresAt! <= Date.now())) return false;
    // Transport errors carry no provider receipt and cannot undo a later webhook.
    if (["captured", "released"].includes(b!.depositHoldStatus ?? "")) return false;
    if (b!.depositHoldStatus === "held" && (!a.intentId || ["requires_action", "processing"].includes(a.status))) return false;
    if (b!.depositHoldStatus === "held" && a.status === "failed" && a.providerStatus !== "canceled" && !["intent_mismatch", "authorisation_unverifiable"].includes(a.failureCode ?? "")) return false;
    if (b!.stripeDepositIntentId && !a.intentId) return false;
    const retry = a.retry && (b!.securityHoldAttempts ?? 0) < 3;
    const retryAt = retry
      ? Date.now() + Math.pow(2, b!.securityHoldAttempts ?? 1) * 60000
      : undefined;
    await ctx.db.patch(a.bookingId, {
      stripeDepositIntentId: a.intentId ?? b!.stripeDepositIntentId,
      depositHoldStatus: retry ? "processing" : a.status,
      depositHoldExpiresAt: a.expiresAt,
      securityHoldLeaseUntil: undefined,
      securityHoldRetryAt: retryAt,
      securityHoldFailureCode: a.failureCode,
    });
    if (retryAt)
      await ctx.scheduler.runAt(retryAt, internal.holdRenewal.authorizePickup, {
        bookingId: a.bookingId,
        generation: a.generation,
      });
    await queueRmv2Sync(ctx, a.bookingId);
    return true;
  },
});
export const due = internalQuery({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db
      .query("bookings")
      .withIndex("by_security_hold_due", (q) =>
        q
          .eq("securityHoldPolicyVersion", PICKUP_HOLD_POLICY)
          .gte("securityHoldRetryAt", 0)
          .lte("securityHoldRetryAt", Date.now()),
      )
      .take(50);
    return rows
      .filter(
        (b) =>
          typeof b.securityHoldRetryAt === "number" &&
          pickupHoldEligible(b) &&
          !(b.securityHoldLeaseUntil! > Date.now()) &&
          ["scheduled", "processing"].includes(b.depositHoldStatus ?? ""),
      )
      .map((b) => ({
        bookingId: b._id,
        generation: b.securityHoldGeneration!,
      }));
  },
});
export const bindRecovery = internalMutation({
  args: { bookingId: v.id("bookings"), sessionId: v.string(), generation: v.optional(v.number()), releasedIntentId: v.optional(v.string()), renewalIntentId: v.optional(v.string()) },
  handler: async (ctx, a) => {
    const b = await ctx.db.get(a.bookingId);
    if (!pickupHoldEligible(b) || !["failed", "requires_action"].includes(b!.depositHoldStatus ?? "") || b!.securityHoldGeneration !== a.generation || b!.stripeDepositIntentId !== a.releasedIntentId || b!.depositHoldRenewalIntentId !== a.renewalIntentId)
      throw Error("Rental security changed. Refresh your rental before updating the card.");
    await ctx.db.patch(a.bookingId, {
      securityHoldRecoverySessionId: a.sessionId,
      securityHoldRecoveryGeneration: a.generation,
      securityHoldRecoveryReleasedIntentId: a.releasedIntentId,
      securityHoldRecoveryRenewalIntentId: a.renewalIntentId,
    });
  },
});
export const recoverCard = internalMutation({
  args: {
    bookingId: v.id("bookings"),
    sessionId: v.string(),
    customerId: v.string(),
    paymentMethodId: v.string(),
  },
  handler: async (ctx, a) => {
    const b = await ctx.db.get(a.bookingId);
    if (
      !pickupHoldEligible(b) ||
      b!.securityHoldRecoverySessionId !== a.sessionId ||
      b!.securityHoldCustomerId !== a.customerId ||
      !["failed", "requires_action"].includes(b!.depositHoldStatus ?? "") ||
      b!.securityHoldRecoveryGeneration !== b!.securityHoldGeneration ||
      b!.securityHoldRecoveryReleasedIntentId !== b!.stripeDepositIntentId ||
      b!.securityHoldRecoveryRenewalIntentId !== b!.depositHoldRenewalIntentId
    )
      return false;
    await ctx.db.patch(a.bookingId, {
      securityHoldPaymentMethodId: a.paymentMethodId,
      securityHoldRecoveredSessionId: a.sessionId,
      securityHoldRecoverySessionId: undefined,
      securityHoldRecoveryGeneration: undefined,
      securityHoldRecoveryReleasedIntentId: undefined,
      securityHoldRecoveryRenewalIntentId: undefined,
      securityHoldJobId: undefined,
      stripeDepositIntentId: undefined,
      depositHoldRenewalIntentId: undefined,
      depositHoldRenewalStatus: undefined,
      depositHoldRenewalAt: undefined,
    });
    await schedulePickupHold(ctx, {
      ...b,
      securityHoldPaymentMethodId: a.paymentMethodId,
      securityHoldJobId: undefined,
      stripeDepositIntentId: undefined,
    });
    return true;
  },
});
/** Retry saving the Checkout card independently of tab return or webhook delivery. */
export const prepareFailed = internalMutation({
  args: { bookingId: v.id("bookings"), retry: v.boolean() },
  handler: async (ctx, a) => {
    const b = await ctx.db.get(a.bookingId);
    if (!pickupHoldEligible(b) || b!.securityHoldPaymentMethodId) return;
    const attempts = (b!.securityHoldPrepareAttempts ?? 0) + 1;
    const retry = a.retry && attempts < 3;
    await ctx.db.patch(a.bookingId, {
      securityHoldPrepareAttempts: attempts,
      securityHoldRetryAt: retry ? Date.now() + attempts * 120000 : undefined,
      depositHoldStatus: retry ? "scheduled" : "failed",
      securityHoldFailureCode: "card_setup_unavailable",
    });
    await queueRmv2Sync(ctx, a.bookingId);
  },
});

export const saveCustomer = internalMutation({
  args: {
    bookingId: v.id("bookings"),
    sessionId: v.string(),
    customerId: v.string(),
  },
  handler: async (ctx, a) => {
    const b = await ctx.db.get(a.bookingId);
    if (!pickupHoldEligible(b) || b!.stripeCheckoutSessionId !== a.sessionId)
      return false;
    if (b!.securityHoldCustomerId && b!.securityHoldCustomerId !== a.customerId)
      throw Error("Saved rental customer changed.");
    await ctx.db.patch(a.bookingId, { securityHoldCustomerId: a.customerId });
    return true;
  },
});
