"use node";
import Stripe from "stripe";
import { createHash } from "node:crypto";
import { action, internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";

function stripe() {
  if (!process.env.STRIPE_SECRET_KEY) throw Error("Stripe is not configured.");
  return new Stripe(process.env.STRIPE_SECRET_KEY);
}
function paymentGate() {
  if (process.env.RENTAL_CHECKOUT_ENABLED !== "true" && !/^(sk|rk)_test_/.test(process.env.STRIPE_SECRET_KEY ?? "")) throw Error("Rental payments are not live yet. The request can remain pending for the team.");
}

async function ensureSession(ctx: any, requestId: any, reason: string, approvedReturnTime?: string) {
  paymentGate();
  const r: any = await ctx.runMutation(internal.rentalExtensions.prepare, { requestId, reason, ...(approvedReturnTime ? { approvedReturnTime } : {}) });
  if (r.status === "applied") return { applied: true };
  if (r.stripePaymentLinkId) return stripe().checkout.sessions.retrieve(r.stripePaymentLinkId);
  // Recover a lost create response before an old idempotency key or expiry can be reused.
  if (Date.now() >= r.approvedAt + 23 * 3600000) {
    for await (const found of stripe().checkout.sessions.list({ created: { gte: Math.floor(r.approvedAt / 1000) - 5 }, limit: 100 })) {
      if (found.metadata?.changeRequestId === requestId) {
        await ctx.runMutation(internal.rentalExtensions.bindPayment, { requestId, sessionId: found.id, url: found.url ?? "" });
        return found;
      }
    }
    await ctx.runMutation(internal.rentalExtensions.close, { requestId });
    return { expired: true };
  }
  const state: any = await ctx.runQuery(internal.rentalExtensions.context, { requestId });
  const origin = new URL(process.env.APP_URL ?? "https://dbcinemarentals.com").origin;
  const suffix = Array.from(createHash("sha256").update(requestId).digest().subarray(0, 8), n => String.fromCharCode(97 + n % 26)).join("");
  const session = await stripe().checkout.sessions.create({
    integration_identifier: `db-rental-extension-${suffix}`,
    mode: "payment", adaptive_pricing: { enabled: false },
    customer_email: state.booking.guestEmail,
    expires_at: Math.floor(r.expiresAt / 1000),
    custom_text: { submit: { message: `Pay for the owner-approved extra rental days under our [rental terms](${origin}/legal/rental-terms). New return time: ${r.approvedReturnTime} London time. Existing security remains unchanged.` } },
    line_items: [{ quantity: 1, price_data: { currency: "gbp", unit_amount: Math.round(r.priceDelta * 100), product_data: { name: `DB Cinema · ${r.extraDays} extra rental day${r.extraDays === 1 ? "" : "s"}`, description: r.quoteItems.map((i: any) => `${i.qty}× ${i.title}: return ${new Date(i.end).toISOString().slice(0, 10)} at ${r.approvedReturnTime} London time · £${i.lineTotal.toFixed(2)}`).join("; ").slice(0, 500) } } }],
    success_url: `${origin}/checkout/success?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${origin}/account?rental=${r.bookingId}#chat`,
    metadata: { changeRequestId: requestId },
    payment_intent_data: { metadata: { changeRequestId: requestId } },
  }, { idempotencyKey: `dbc-approved-extension-${requestId}` });
  if (!session.url) throw Error("Stripe did not provide a payment link. Retry approval to recover it.");
  await ctx.runMutation(internal.rentalExtensions.bindPayment, { requestId, sessionId: session.id, url: session.url });
  return session;
}

export const approve = action({
  args: { token: v.string(), requestId: v.id("booking_change_requests"), reason: v.string(), approvedReturnTime: v.optional(v.string()) },
  handler: async (ctx, { token, requestId, reason, approvedReturnTime }): Promise<{ ok: boolean }> => {
    await ctx.runMutation(internal.adminAuth.assertAdminInternal, { token, fn: "rentalExtensionPayments.approve" });
    await ensureSession(ctx, requestId, reason, approvedReturnTime);
    return { ok: true };
  },
});

export const withdraw = action({
  args: { token: v.string(), requestId: v.id("booking_change_requests") },
  handler: async (ctx, { token, requestId }): Promise<{ ok: boolean }> => {
    await ctx.runMutation(internal.adminAuth.assertAdminInternal, { token, fn: "rentalExtensionPayments.withdraw" });
    const state: any = await ctx.runQuery(internal.rentalExtensions.context, { requestId });
    if (!state || !["approved", "awaiting_payment"].includes(state.request.status)) throw Error("Only an unpaid approval can be withdrawn. Use the rental refund control for a completed extension.");
    const r = state.request;
    // Recover a lost create response before closing, so a payable link cannot survive withdrawal.
    let session: any = await ensureSession(ctx, requestId, r.approvalReason);
    if (session.expired) return { ok: true };
    if (session.status === "open") session = await stripe().checkout.sessions.expire(session.id);
    if (session.payment_status === "paid") { await fulfill(ctx, session); throw Error("This extension was paid. Refresh the rental and use its refund control."); }
    if (session.status !== "expired") throw Error("The extension payment is processing. Wait for Stripe's result before withdrawing.");
    await ctx.runMutation(internal.rentalExtensions.close, { requestId, withdrawn: true });
    return { ok: true };
  },
});

/** Telegram is authenticated by the existing webhook; both owner surfaces share one flow. */
export const approveFromOwnerWebhook = internalAction({
  args: { requestId: v.id("booking_change_requests") },
  handler: async (ctx, { requestId }) => { await ensureSession(ctx, requestId, "Approved by owner through Telegram"); },
});

async function fulfill(ctx: any, session: Stripe.Checkout.Session) {
  const id = session.metadata?.changeRequestId;
  if (!id) throw Error("Extension payment metadata missing.");
  const state: any = await ctx.runQuery(internal.rentalExtensions.context, { requestId: id });
  if (!state) throw Error("Extension request missing.");
  const r = state.request;
  // Unpaid sessions never mutate rental dates or claim a payment.
  if (session.status !== "complete" || session.payment_status !== "paid") return { bookingId: r.bookingId, paid: false, closed: false };
  if (session.id !== r.stripePaymentLinkId || session.currency !== "gbp" || session.amount_total !== Math.round((r.priceDelta ?? -1) * 100)) throw Error("Extension session does not match its approved quote.");
  const intentId = typeof session.payment_intent === "string" ? session.payment_intent : session.payment_intent?.id;
  if (!intentId) throw Error("Extension payment is missing.");
  const intent = await stripe().paymentIntents.retrieve(intentId);
  if (intent.status !== "succeeded" || intent.currency !== "gbp" || intent.amount_received !== session.amount_total || intent.metadata.changeRequestId !== id) throw Error("Extension payment has not been confirmed by Stripe.");
  const result: any = await ctx.runMutation(internal.rentalExtensions.applyPaid, { requestId: id, sessionId: session.id, paymentIntentId: intent.id, amountPence: intent.amount_received });
  if (result.closed) {
    if (r.status !== "refunded") {
      const refund = await stripe().refunds.create({ payment_intent: intent.id, metadata: { extensionRequestId: id } }, { idempotencyKey: `dbc-closed-extension-${id}` });
      if (["failed", "canceled"].includes(refund.status ?? "")) throw Error("The unapplied extension refund needs attention. Retry settlement.");
      await ctx.runMutation(internal.rentalExtensions.close, { requestId: id, refundId: refund.id, paymentIntentId: intent.id, refundPending: refund.status !== "succeeded" });
    }
    return { bookingId: r.bookingId, paid: true, closed: true };
  }
  return { bookingId: r.bookingId, paid: true, closed: false };
}

export const finalize = internalAction({
  args: { sessionId: v.string() },
  handler: async (ctx, { sessionId }): Promise<{ bookingId: string; paid: boolean; closed: boolean }> => fulfill(ctx, await stripe().checkout.sessions.retrieve(sessionId)),
});

export const reconcile = internalAction({
  args: {},
  handler: async ctx => {
    const rows: any[] = await ctx.runQuery(internal.rentalExtensions.pendingPayments, {});
    for (const r of rows) {
      try {
        if (r.status === "refund_pending" && r.refundId) {
          const refund = await stripe().refunds.retrieve(r.refundId);
          if (refund.status === "succeeded") await ctx.runMutation(internal.rentalExtensions.close, { requestId: r._id, refundId: refund.id, paymentIntentId: r.paymentIntentId });
          else if (["failed", "canceled"].includes(refund.status ?? "")) console.error("Extension refund needs attention", r._id);
          continue;
        }
        if (!r.stripePaymentLinkId) { await ensureSession(ctx, r._id, r.approvalReason ?? "Recovering owner-approved extension"); continue; }
        let session = await stripe().checkout.sessions.retrieve(r.stripePaymentLinkId);
        if (session.payment_status === "paid") { await fulfill(ctx, session); continue; }
        if ((r.expiresAt ?? 0) <= Date.now()) {
          if (session.status === "open") session = await stripe().checkout.sessions.expire(session.id);
          // Async processing must be attested before its operation lock is released.
          if (session.status === "expired") await ctx.runMutation(internal.rentalExtensions.close, { requestId: r._id });
        }
      } catch (e: any) { console.error("Extension reconciliation failed", r._id, e.message); }
    }
  },
});
