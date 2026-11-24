"use node";
import Stripe from "stripe";
import { createHash } from "node:crypto";
import { action, internalAction } from "./_generated/server";
import { api, internal } from "./_generated/api";
import { v } from "convex/values";
import { approvedStripeCheckoutUrl } from "../src/lib/chatLinks";

function stripe() {
  if (!process.env.STRIPE_SECRET_KEY) throw Error("Stripe is not configured.");
  return new Stripe(process.env.STRIPE_SECRET_KEY);
}
function paymentGate() {
  if (process.env.RENTAL_CHECKOUT_ENABLED !== "true" && !/^(sk|rk)_test_/.test(process.env.STRIPE_SECRET_KEY ?? "")) throw Error("Rental payments are not live yet. The request can remain pending for the team.");
}

function stripeCheckoutUrl(value: unknown, sessionId: string) {
  const url = approvedStripeCheckoutUrl(value);
  if (!url || new URL(url).pathname !== `/c/pay/${sessionId}`) throw Error("This payment link is unavailable. Ask the team for help.");
  return url;
}

function matchesRefund(refund: Stripe.Refund, request: any) {
  const intentId = typeof refund.payment_intent === "string" ? refund.payment_intent : refund.payment_intent?.id;
  const expectedPence = request.cardDuePence ?? Math.round((request.priceDelta ?? -1) * 100);
  return intentId === request.paymentIntentId && refund.currency === "gbp" && Number.isSafeInteger(expectedPence) && expectedPence > 0 && refund.amount === expectedPence;
}

async function ensureSession(ctx: any, requestId: any, reason: string, approvedReturnTime?: string) {
  const initial: any = await ctx.runQuery(internal.rentalExtensions.context, { requestId });
  if (!initial?.request || initial.request.type !== "extend") throw Error("Extension request unavailable.");
  if (initial.request.status === "applied") return { applied: true };
  const requestedAmount = initial.request.priceDelta;
  if (!Number.isFinite(requestedAmount) || requestedAmount < 0) throw Error("The extension quote is invalid.");
  const initialCardDuePence = initial.request.cardDuePence ?? Math.round(requestedAmount * 100);
  if (!Number.isSafeInteger(initialCardDuePence) || initialCardDuePence < 0) throw Error("The extension payment allocation is invalid.");
  if (initialCardDuePence > 0) paymentGate();

  const r: any = await ctx.runMutation(internal.rentalExtensions.prepare, { requestId, reason, ...(approvedReturnTime ? { approvedReturnTime } : {}) });
  if (r.status === "expired") throw Error("This account-credit extension request expired. Ask the team for a fresh quote.");
  if (r.status === "applied") return { applied: true };
  if (!["approved", "awaiting_payment"].includes(r.status)) throw Error("This extension request is no longer awaiting approval.");
  const cardDuePence=r.cardDuePence??Math.round((r.priceDelta??0)*100);
  if (cardDuePence === 0) {
    if (r.stripePaymentLinkId || r.paymentLinkUrl) throw Error("This zero-balance extension has an older payment session and needs reconciliation.");
    const settled = await ctx.runMutation(internal.rentalExtensions.applyPaid, { requestId, amountPence: 0, approvedZero: true });
    if (!settled?.ok) {
      if (settled?.closed) await ctx.runMutation(internal.rentalExtensions.close, { requestId });
      throw Error("The approved zero-balance extension could not be applied. Refresh availability and review the request again.");
    }
    return { applied: true, zeroAmount: true,accountCredit:r.creditAppliedPence??0 };
  }
  if (!Number.isFinite(r.priceDelta) || r.priceDelta < 0) throw Error("The extension quote is invalid.");
  paymentGate();
  if (r.stripePaymentLinkId) {
    const existing = await stripe().checkout.sessions.retrieve(r.stripePaymentLinkId);
    if (existing.id !== r.stripePaymentLinkId) throw Error("The extension payment session does not match its approval.");
    if (existing.status === "open") stripeCheckoutUrl(existing.url, existing.id);
    return existing;
  }
  // Recover a lost create response before an old idempotency key or expiry can be reused.
  if (Date.now() >= r.approvedAt + 23 * 3600000) {
    for await (const found of stripe().checkout.sessions.list({ created: { gte: Math.floor(r.approvedAt / 1000) - 5 }, limit: 100 })) {
      if (found.metadata?.changeRequestId === requestId) {
        await ctx.runMutation(internal.rentalExtensions.bindPayment, { requestId, sessionId: found.id, url: stripeCheckoutUrl(found.url, found.id) });
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
    line_items: [{ quantity: 1, price_data: { currency: "gbp", unit_amount: cardDuePence, product_data: { name: r.adminLateTerms ? "DB Cinema · late rental and extension" : `DB Cinema · ${r.extraDays} extra rental day${r.extraDays === 1 ? "" : "s"}`, description: `${r.quoteItems.map((i: any) => `${i.qty}× ${i.title}: return ${new Date(i.end).toISOString().slice(0, 10)} at ${r.approvedReturnTime} London time · £${i.lineTotal.toFixed(2)}`).join("; ")}.${r.adminLateTerms ? ` Late rental £${(r.adminLateTerms.latePence / 100).toFixed(2)}${r.adminLateTerms.customFee ? `; ${r.adminLateTerms.customFee.description} £${(r.adminLateTerms.customFee.amountPence / 100).toFixed(2)}` : ""}.` : ""} Account credit £${((r.creditAppliedPence??0)/100).toFixed(2)}; card balance £${(cardDuePence/100).toFixed(2)}.`.slice(0, 500) } } }],
    success_url: `${origin}/checkout/success?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${origin}/account?rental=${r.bookingId}#chat`,
    metadata: { changeRequestId: requestId,cardDuePence:String(cardDuePence),creditAppliedPence:String(r.creditAppliedPence??0) },
    payment_intent_data: { metadata: { changeRequestId: requestId,cardDuePence:String(cardDuePence),creditAppliedPence:String(r.creditAppliedPence??0) } },
  }, { idempotencyKey: `dbc-approved-extension-${requestId}` });
  const checkoutUrl = stripeCheckoutUrl(session.url, session.id);
  await ctx.runMutation(internal.rentalExtensions.bindPayment, { requestId, sessionId: session.id, url: checkoutUrl });
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

export const sendLateOffer = action({
  args: { token:v.string(), bookingId:v.id("bookings"), requestKey:v.string(), lineItemIndexes:v.optional(v.array(v.number())), lateDays:v.number(), targetEnd:v.number(), requestedReturnTime:v.string(), manualRates:v.optional(v.array(v.object({lineIndex:v.number(),dailyPence:v.number(),confirmed:v.literal(true)}))), customFee:v.optional(v.object({description:v.string(),amountPence:v.number()})), expectedFingerprint:v.string() },
  handler: async (ctx, { token, ...args }): Promise<{ requestId:string }> => {
    await ctx.runMutation(internal.adminAuth.assertAdminInternal, { token, fn:"rentalExtensionPayments.sendLateOffer" });
    if (process.env.RENTAL_LATE_EXTENSION_ENABLED !== "true") throw Error("Late-extension payments are not enabled yet.");
    if (!process.env.STRIPE_SECRET_KEY) throw Error("Stripe is not configured.");
    paymentGate();
    return await ctx.runMutation(internal.rentalExtensions.createAdminLateOffer, { ...args, approvalReason:"Late rental and extension offered by the team" });
  },
});

export const acceptLateAndPay = action({
  args: { token:v.string(), requestId:v.id("booking_change_requests"), expectedFingerprint:v.string() },
  handler: async (ctx, args): Promise<{ url:string }> => {
    if (process.env.RENTAL_LATE_EXTENSION_ENABLED !== "true") throw Error("Late-extension payments are not enabled yet.");
    paymentGate();
    await ctx.runMutation(api.rentalExtensions.acceptAdminLateOffer, { ...args, accepted:true });
    const state:any = await ctx.runQuery(internal.rentalExtensions.context, { requestId:args.requestId });
    if (!state?.request?.adminLateTerms) throw Error("This offer is unavailable.");
    const session:any = await ensureSession(ctx, args.requestId, state.request.approvalReason);
    if (session.status !== "open" || !session.url) throw Error("This payment link is no longer available. Ask the team for help.");
    return { url:stripeCheckoutUrl(session.url, session.id) };
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
  const cardDuePence=r.cardDuePence??Math.round((r.priceDelta??-1)*100);
  const legacyCardOnly = r.cardDuePence === undefined && r.creditAppliedPence === undefined && r.creditReservationId === undefined && r.useAccountCredit !== true;
  const metadataMatches = (metadata: Stripe.Metadata | null | undefined) =>
    (metadata?.cardDuePence === String(cardDuePence) && metadata?.creditAppliedPence === String(r.creditAppliedPence ?? 0)) ||
    (legacyCardOnly && metadata?.cardDuePence === undefined && metadata?.creditAppliedPence === undefined);
  if (session.id !== r.stripePaymentLinkId || session.currency !== "gbp" || session.amount_total !== cardDuePence || !metadataMatches(session.metadata)) throw Error("Extension session does not match its approved quote.");
  const intentId = typeof session.payment_intent === "string" ? session.payment_intent : session.payment_intent?.id;
  if (!intentId) throw Error("Extension payment is missing.");
  const intent = await stripe().paymentIntents.retrieve(intentId);
  if (intent.status !== "succeeded" || intent.currency !== "gbp" || intent.amount_received !== session.amount_total || intent.metadata.changeRequestId !== id || !metadataMatches(intent.metadata) || intent.metadata.cardDuePence !== session.metadata?.cardDuePence || intent.metadata.creditAppliedPence !== session.metadata?.creditAppliedPence) throw Error("Extension payment has not been confirmed by Stripe.");
  if (r.status === "refund_pending") return { bookingId:r.bookingId, paid:true, closed:true };
  const result: any = await ctx.runMutation(internal.rentalExtensions.applyPaid, { requestId: id, sessionId: session.id, paymentIntentId: intent.id, amountPence: intent.amount_received });
  if (result.closed) {
    if (r.status !== "refunded") {
      const attempt = await ctx.runMutation(internal.rentalExtensions.beginRefundCreation, { requestId:id, sessionId:session.id, paymentIntentId:intent.id });
      if (!attempt.allowed || Date.now() >= attempt.startedAt + 23 * 3600000) {
        await ctx.runMutation(internal.rentalExtensions.refundCreationAttention, { requestId:id, sessionId:session.id });
        throw Error("Automatic extension refund attempts have stopped. Review the original payment in Stripe.");
      }
      let refund: Stripe.Refund;
      try {
        refund = await stripe().refunds.create({ payment_intent: intent.id, metadata: { extensionRequestId: id } }, { idempotencyKey: `dbc-closed-extension-${id}` });
      } catch (error) {
        try { await ctx.runMutation(internal.rentalExtensions.refundCreationAttention, { requestId:id, sessionId:session.id }); }
        catch { console.error("Could not record an extension refund creation alert."); }
        throw error;
      }
      await ctx.runMutation(internal.rentalExtensions.close, { requestId: id, refundId: refund.id, paymentIntentId: intent.id, refundPending: refund.status !== "succeeded" });
      if (["failed", "canceled", "requires_action"].includes(refund.status ?? "")) await ctx.runMutation(internal.rentalExtensions.refundAttention, { requestId:id, refundId:refund.id, paymentIntentId:intent.id });
    }
    return { bookingId: r.bookingId, paid: true, closed: true };
  }
  return { bookingId: r.bookingId, paid: true, closed: false };
}

export const finalize = internalAction({
  args: { sessionId: v.string() },
  handler: async (ctx, { sessionId }): Promise<{ bookingId: string; paid: boolean; closed: boolean }> => fulfill(ctx, await stripe().checkout.sessions.retrieve(sessionId)),
});

export const confirmReplacementRefund = action({
  args: { token:v.string(), requestId:v.id("booking_change_requests"), refundId:v.string() },
  handler: async (ctx, args): Promise<{ ok:boolean }> => {
    await ctx.runMutation(internal.adminAuth.assertAdminInternal, { token:args.token, fn:"rentalExtensionPayments.confirmReplacementRefund" });
    const state:any = await ctx.runQuery(internal.rentalExtensions.context, { requestId:args.requestId });
    const request = state?.request;
    if (!request) throw Error("This refund is not ready for replacement review.");
    const unknown = request.status === "awaiting_payment" && !request.refundId && request.refundCreateAttemptAt && request.refundCreatePaymentIntentId && Date.now() >= request.refundCreateAttemptAt + 23 * 3600000;
    if (unknown) {
      const session = await stripe().checkout.sessions.retrieve(request.stripePaymentLinkId);
      const intentId = typeof session.payment_intent === "string" ? session.payment_intent : session.payment_intent?.id;
      const intent = intentId ? await stripe().paymentIntents.retrieve(intentId) : null;
      if (session.id !== request.stripePaymentLinkId || session.status !== "complete" || session.payment_status !== "paid" || session.currency !== "gbp" || session.amount_total !== (request.cardDuePence ?? Math.round((request.priceDelta ?? -1) * 100)) || session.metadata?.changeRequestId !== args.requestId || intentId !== request.refundCreatePaymentIntentId || intent?.status !== "succeeded" || intent.currency !== "gbp" || intent.amount_received !== session.amount_total || intent.metadata.changeRequestId !== args.requestId) throw Error("Stripe has not confirmed the original extension payment.");
    } else {
      if (request.status !== "refund_pending" || !request.refundId || !request.paymentIntentId || request.refundId === args.refundId) throw Error("This refund is not ready for replacement review.");
      const original = await stripe().refunds.retrieve(request.refundId);
      if (original.id !== request.refundId || !["failed", "canceled"].includes(original.status ?? "") || !matchesRefund(original, request)) throw Error("Stripe has not confirmed a failed original refund.");
    }
    const replacement = await stripe().refunds.retrieve(args.refundId);
    const paymentIntentId = unknown ? request.refundCreatePaymentIntentId : request.paymentIntentId;
    if (replacement.id !== args.refundId || replacement.status !== "succeeded" || !matchesRefund(replacement, { ...request, paymentIntentId })) throw Error("Stripe has not confirmed a matching full replacement refund.");
    await ctx.runMutation(internal.rentalExtensions.close, { requestId:args.requestId, refundId:replacement.id, paymentIntentId, ...(unknown ? { expectedUnknownAttemptAt:request.refundCreateAttemptAt } : { expectedRefundId:request.refundId }) });
    return { ok:true };
  },
});

export const reconcile = internalAction({
  args: {},
  handler: async ctx => {
    await ctx.runMutation(internal.rentalExtensions.expirePendingCreditRequests, {});
    const rows: any[] = await ctx.runQuery(internal.rentalExtensions.pendingPayments, {});
    for (const r of rows) {
      try {
        if (r.status === "refund_pending" && r.refundId) {
          const refund = await stripe().refunds.retrieve(r.refundId);
          if (refund.id !== r.refundId || !matchesRefund(refund, r)) { await ctx.runMutation(internal.rentalExtensions.refundAttention, { requestId:r._id, refundId:r.refundId, paymentIntentId:r.paymentIntentId }); continue; }
          if (refund.status === "succeeded") await ctx.runMutation(internal.rentalExtensions.close, { requestId: r._id, refundId: refund.id, paymentIntentId: r.paymentIntentId, expectedRefundId:r.refundId });
          else if (["failed", "canceled", "requires_action"].includes(refund.status ?? "")) await ctx.runMutation(internal.rentalExtensions.refundAttention, { requestId:r._id, refundId:refund.id, paymentIntentId:r.paymentIntentId });
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
