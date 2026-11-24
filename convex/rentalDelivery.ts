import Stripe from "stripe";
import { action, internalAction } from "./_generated/server";
import { api, internal } from "./_generated/api";
import { v } from "convex/values";
import { deliveryAmountPence, deliveryQuoteTerms, deliveryQuoteTermsVersion, rentalDeliveryBookingFingerprint } from "../shared/rentalDeliveryQuote";
import { DELIVERY_ACCEPTANCE_TEXT, DELIVERY_TERMS_VERSION } from "../shared/rentalAgreement";
import { groupDeliveryItems } from "../shared/deliveryGroups";
import { membershipDeliveryBenefit } from "../shared/rentalBenefits";
import { membershipActiveNow, membershipTierFor } from "../shared/membership";
import { tierByKey } from "./lib/membership";
import { londonMonth } from "./lib/memberDelivery";
import { renterHandoverDetailsReady } from "./lib/renterRentalActionGate";

function stripe() {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw Error("STRIPE_SECRET_KEY is not configured.");
  return new Stripe(key);
}

function postcodeFromAddress(value: string) {
  const match = value.match(/[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}/i);
  if (!match) return "";
  const compact = match[0].replace(/\s+/g, "").toUpperCase();
  return `${compact.slice(0, -3)} ${compact.slice(-3)}`;
}

export const createQuote = action({
  args: {
    token: v.string(), bookingId: v.id("bookings"), requestId: v.string(), deliveryLegs: v.union(v.literal("one_way"), v.literal("round_trip")), deliveryAddress: v.string(),
  },
  handler: async (ctx, args) => {
    await ctx.runMutation(internal.adminAuth.assertAdminInternal, { token: args.token, fn: "rentalDelivery.createQuote" });
    const context: any = await ctx.runQuery(internal.rentalDeliveryState.bookingContext, { bookingId: args.bookingId });
    const booking = context?.booking;
    const account = context?.account;
    if (!booking || !account || account.blockedAt != null) throw Error("A valid renter account and rental conversation are required.");
    if (context.deliveryRequest && (context.deliveryRequest.status !== "approved" || context.deliveryRequest.requestedDeliveryLegs !== args.deliveryLegs))
      throw Error("Review the renter’s latest delivery request and quote its approved delivery type before sending a price.");
    if (!renterHandoverDetailsReady(booking) || booking.status !== "confirmed" || booking.fulfilment !== "pickup" || booking.deliveryLegs || booking.cancellationDecision || booking.returnDecision || booking.activeAdditionId || booking.activeDeliveryQuoteId || booking.activeExtensionId || booking.activePriceAdjustmentId || booking.activeItemSwapId)
      throw Error("Only a paid, verified, confirmed rental with pickup selected can receive a delivery quote.");
    const deliveryAddress = args.deliveryAddress.trim();
    if (deliveryAddress.length < 10 || deliveryAddress.length > 300) throw Error("Enter the delivery address the renter gave you.");
    const postcode = postcodeFromAddress(deliveryAddress);
    if (!postcode) throw Error("A full UK postcode is required to calculate delivery.");
    const items = booking.lineItems.flatMap((line: any) => {
      if (!Number.isSafeInteger(line.qty) || line.qty < 1 || line.qty > 20) throw Error("The rental item list needs review before delivery can be quoted.");
      return Array.from({ length: line.qty }, () => ({ listingId: line.listingId, start: line.start, end: line.end }));
    });
    const groups = groupDeliveryItems(items) as Array<{ start: number; end: number; listingIds: any[] }>;
    const quote: any = await ctx.runAction(api.delivery.quote, { postcode, groups });
    if (!quote.ok) throw Error(quote.reason);
    const settings: any = await ctx.runQuery(api.settings.get, {});
    const marginPct = settings?.deliveryMarginPct ?? 10;
    const baseAmountPence = deliveryAmountPence(quote.groups, args.deliveryLegs, marginPct);
    const activeTier = membershipActiveNow(account) ? tierByKey(membershipTierFor(account)) : null;
    const benefitMonth = londonMonth();
    const isStudioBenefit = activeTier?.key === "studio" && quote.isLondon && baseAmountPence > 0
      ? await ctx.runQuery(internal.membershipBenefits.deliveryAvailable, { accountId: account._id, month: benefitMonth, prospective: false })
      : false;
    const deliveryBenefit = membershipDeliveryBenefit(account, baseAmountPence, isStudioBenefit);
    const discountPence = deliveryBenefit.discountPence;
    const termsText = deliveryQuoteTerms(DELIVERY_ACCEPTANCE_TEXT, args.deliveryLegs);
    const row: any = await ctx.runMutation(internal.rentalDeliveryState.prepareQuote, {
      token: args.token,
      bookingId: args.bookingId,
      requestId: args.requestId,
      deliveryLegs: args.deliveryLegs,
      deliveryAddress,
      postcode,
      baseAmountPence,
      discountPence,
      amountPence: baseAmountPence - discountPence,
      membershipTier: deliveryBenefit.membershipTier,
      benefitMonth: isStudioBenefit ? benefitMonth : undefined,
      isStudioBenefit: !!isStudioBenefit,
      termsVersion: deliveryQuoteTermsVersion(DELIVERY_TERMS_VERSION),
      termsText,
      expectedFingerprint: rentalDeliveryBookingFingerprint(booking),
    });
    return { id: row._id, status: row.status, amountPence: row.amountPence, baseAmountPence: row.baseAmountPence, discountPence: row.discountPence, deliveryLegs: row.deliveryLegs };
  },
});

export const accept = action({
  args: { token: v.string(), id: v.id("rental_delivery_quotes"), accepted: v.boolean(), useAccountCredit: v.optional(v.boolean()) },
  handler: async (ctx, args) => {
    const quote: any = await ctx.runMutation(internal.rentalDeliveryState.accept, args);
    if ((quote.cardDuePence ?? quote.amountPence) === 0) return { url: null, free: quote.amountPence === 0, paid: true, amountPence: quote.amountPence, cardDuePence: 0, creditAppliedPence: quote.creditAppliedPence ?? 0 };
    if (quote.checkoutSessionId && quote.paymentUrl) {
      const existing = await stripe().checkout.sessions.retrieve(quote.checkoutSessionId);
      if (existing.status === "open" && existing.url) return { url: existing.url, free: false, paid: false, amountPence: quote.amountPence, cardDuePence: quote.cardDuePence ?? quote.amountPence };
      if (existing.status === "complete" && existing.payment_status === "paid") {
        await ctx.runAction((internal as any).rentalDelivery.finalizePaid, { id: quote._id, sessionId: existing.id });
        return { url: null, free: false, paid: true, amountPence: quote.amountPence, cardDuePence: quote.cardDuePence ?? quote.amountPence };
      }
      if (existing.status === "complete") {
        return { url: null, free: false, paid: false, processing: true, amountPence: quote.amountPence, cardDuePence: quote.cardDuePence ?? quote.amountPence };
      }
      if (existing.status === "expired") {
        await ctx.runMutation(internal.rentalDeliveryState.expire, { id: quote._id, sessionId: existing.id });
        throw Error("This payment link has expired. Ask the rental team for a fresh delivery quote.");
      }
    }
    const context: any = await ctx.runQuery(internal.rentalDeliveryState.quoteContext, { id: quote._id });
    if (!context?.quote || !context.account || context.quote.status !== "creating_checkout" || context.quote.acceptedAt == null) throw Error("This delivery payment could not be prepared. Please try again.");
    const configurationId = process.env.STRIPE_RENTAL_PAYMENT_METHOD_CONFIGURATION_ID;
    if (!configurationId) throw Error("The rental payment setup is unavailable. Please contact the team.");
    const client = stripe();
    await client.paymentMethodConfigurations.retrieve(configurationId);
    const appUrl = process.env.APP_URL;
    if (!appUrl) throw Error("The rental payment return address is unavailable.");
    const amount = context.quote.cardDuePence ?? context.quote.amountPence;
    const legLabel = context.quote.deliveryLegs === "one_way" ? "One-way equipment delivery" : "Equipment delivery and collection";
    const meta = { rentalDeliveryQuoteId: String(context.quote._id), bookingId: String(context.booking._id), purpose: "rental_delivery", cardDuePence: String(amount), creditAppliedPence: String(context.quote.creditAppliedPence ?? 0) };
    const expiresAt = Math.floor(Date.now() / 1000) + 31 * 60;
    const proposedParams: Stripe.Checkout.SessionCreateParams = {
      mode: "payment",
      line_items: [{ quantity: 1, price_data: { currency: "gbp", unit_amount: amount, product_data: { name: legLabel } } }],
      payment_method_configuration: configurationId,
      adaptive_pricing: { enabled: false },
      expires_at: expiresAt,
      ...(context.account.stripeCustomerId ? { customer: context.account.stripeCustomerId } : { customer_email: context.account.email, customer_creation: "always" as const }),
      client_reference_id: String(context.booking._id),
      success_url: `${new URL(appUrl).origin}/checkout/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${new URL(appUrl).origin}/account?tab=rentals`,
      metadata: meta,
      payment_intent_data: { metadata: meta },
    };
    const prepared: any = await ctx.runMutation(internal.rentalDeliveryState.prepareCheckout, { id: context.quote._id, params: JSON.stringify(proposedParams), expiresAt: expiresAt * 1000 });
    const params = JSON.parse(prepared.checkoutParams) as Stripe.Checkout.SessionCreateParams;
    const session = await client.checkout.sessions.create(params, { idempotencyKey: `dbc-delivery-quote-${context.quote._id}` });
    if (!session.url) throw Error("Stripe did not return a secure payment link.");
    const bound: any = await ctx.runMutation(internal.rentalDeliveryState.bindSession, { id: context.quote._id, sessionId: session.id, url: session.url, sessionParams: prepared.checkoutParams });
    if (session.status === "complete" && session.payment_status === "paid") {
      await ctx.runAction((internal as any).rentalDelivery.finalizePaid, { id: context.quote._id, sessionId: session.id });
      return { url: null, free: false, paid: true, amountPence: amount };
    }
    return { url: bound.paymentUrl, free: false, paid: false, amountPence: context.quote.amountPence, cardDuePence: amount };
  },
});

export const decline = action({
  args: { token: v.string(), id: v.id("rental_delivery_quotes") },
  handler: async (ctx, args) => {
    await ctx.runMutation(internal.rentalDeliveryState.decline, args);
    return { ok: true };
  },
});

export const finalizePaid = internalAction({
  args: { id: v.id("rental_delivery_quotes"), sessionId: v.string() },
  handler: async (ctx, { id, sessionId }): Promise<any> => {
    const context: any = await ctx.runQuery(internal.rentalDeliveryState.quoteContext, { id });
    if (!context?.quote || context.quote.checkoutSessionId !== sessionId || !context.quote.acceptedAt) throw Error("The delivery payment does not match its accepted quote.");
    const session = await stripe().checkout.sessions.retrieve(sessionId, { expand: ["payment_intent"] });
    const cardDuePence=context.quote.cardDuePence??context.quote.amountPence;
    if (session.status !== "complete" || session.payment_status !== "paid" || session.amount_total !== cardDuePence || session.metadata?.rentalDeliveryQuoteId !== String(id) || session.metadata?.bookingId !== String(context.quote.bookingId) || context.quote.creditOptIn&&(session.metadata?.cardDuePence!==String(cardDuePence)||session.metadata?.creditAppliedPence!==String(context.quote.creditAppliedPence??0))) throw Error("Stripe has not confirmed the accepted delivery card balance.");
    const paymentIntentId = typeof session.payment_intent === "string" ? session.payment_intent : session.payment_intent?.id;
    if(!paymentIntentId)throw Error("The delivery payment has no confirmed card transaction.");
    const intent=await stripe().paymentIntents.retrieve(paymentIntentId);
    if(intent.status!=="succeeded"||intent.amount_received!==cardDuePence||intent.currency!=="gbp"||intent.metadata.rentalDeliveryQuoteId!==String(id)||intent.metadata.bookingId!==String(context.quote.bookingId)||context.quote.creditOptIn&&(intent.metadata.cardDuePence!==String(cardDuePence)||intent.metadata.creditAppliedPence!==String(context.quote.creditAppliedPence??0)))throw Error("Stripe's card payment does not match the accepted delivery balance.");
    return await ctx.runMutation(internal.rentalDeliveryState.markPaid, { id, sessionId, paymentIntentId, amountPence: cardDuePence });
  },
});

export const markFailed = internalAction({
  args: { id: v.id("rental_delivery_quotes"), sessionId: v.string() },
  handler: async (ctx, args): Promise<boolean> => await ctx.runMutation(internal.rentalDeliveryState.markFailed, args),
});

export const expire = internalAction({
  args: { id: v.id("rental_delivery_quotes"), sessionId: v.optional(v.string()) },
  handler: async (ctx, args): Promise<boolean> => await ctx.runMutation(internal.rentalDeliveryState.expire, args),
});

async function recoverQuotePaymentWithEvidence(ctx: any, id: any): Promise<{ status: string }> {
    const context: any = await ctx.runQuery(internal.rentalDeliveryState.quoteContext, { id });
    const quote = context?.quote;
    if (!quote || !quote.acceptedAt || !quote.checkoutParams || !quote.checkoutExpiresAt) throw Error("This delivery payment has no recoverable checkout.");
    if (quote.status === "paid") return { status: "paid" };
    if (quote.status === "expired") return { status: "expired" };
    if (!["creating_checkout", "checkout_open"].includes(quote.status)) throw Error("This delivery payment is closed.");
    const client = stripe();
    let sessionId = quote.checkoutSessionId;
    if (!sessionId) {
      const matches: string[] = [];
      const result = await client.checkout.sessions.list({ created: { gte: Math.floor((quote.acceptedAt - 5000) / 1000), lte: Math.floor(quote.checkoutExpiresAt / 1000) }, limit: 100 });
      for (const entry of result.data) if (entry.metadata?.rentalDeliveryQuoteId === String(id)) matches.push(entry.id);
      if (result.has_more || matches.length !== 1) return { status: "needs_review" };
      sessionId = matches[0];
    }
    let session = await client.checkout.sessions.retrieve(sessionId);
    const cardDuePence = quote.cardDuePence ?? quote.amountPence;
    if (session.id !== sessionId || session.mode !== "payment" || session.currency !== "gbp" || session.amount_total !== cardDuePence || session.metadata?.rentalDeliveryQuoteId !== String(id) || session.metadata?.bookingId !== String(quote.bookingId) || session.metadata?.purpose !== "rental_delivery" || session.metadata?.cardDuePence !== String(cardDuePence) || session.metadata?.creditAppliedPence !== String(quote.creditAppliedPence ?? 0)) return { status: "needs_review" };
    await ctx.runMutation(internal.rentalDeliveryState.bindRecoveredSession, { id, sessionId });
    if (session.status === "complete" && session.payment_status === "paid") {
      await ctx.runAction((internal as any).rentalDelivery.finalizePaid, { id, sessionId });
      return { status: "paid" };
    }
    if (session.status === "open" && (quote.checkoutExpiresAt ?? 0) <= Date.now()) session = await client.checkout.sessions.expire(sessionId);
    if (session.status === "expired" && session.payment_status === "unpaid") {
      await ctx.runMutation(internal.rentalDeliveryState.expire, { id, sessionId });
      return { status: "expired" };
    }
    return { status: "processing" };
}

export const recoverQuotePayment = action({
  args: { token: v.string(), id: v.id("rental_delivery_quotes") },
  handler: async (ctx, { token, id }): Promise<{ status: string }> => {
    await ctx.runMutation(internal.adminAuth.assertAdminInternal, { token, fn: "rentalDelivery.recoverQuotePayment" });
    return await recoverQuotePaymentWithEvidence(ctx, id);
  },
});

export const cancelQuote = action({
  args: { token: v.string(), id: v.id("rental_delivery_quotes") },
  handler: async (ctx, { token, id }) => {
    await ctx.runMutation(internal.adminAuth.assertAdminInternal, { token, fn: "rentalDelivery.cancelQuote" });
    const context: any = await ctx.runQuery(internal.rentalDeliveryState.quoteContext, { id });
    if (!context?.quote || context.quote.status === "paid") throw Error("A paid delivery cannot be cancelled from this control.");
    const sessionId = context.quote.checkoutSessionId;
    if (sessionId) {
      const session = await stripe().checkout.sessions.retrieve(sessionId);
      if (session.status === "complete" && session.payment_status === "paid") {
        await ctx.runAction((internal as any).rentalDelivery.finalizePaid, { id, sessionId });
        throw Error("Stripe has already confirmed payment; delivery is now recorded.");
      }
      if (session.status === "complete") throw Error("Stripe is still processing this payment. Wait for its final result before cancelling the quote.");
      if (session.status === "open") await stripe().checkout.sessions.expire(sessionId);
    }
    await ctx.runMutation(internal.rentalDeliveryState.expire, { id, ...(sessionId ? { sessionId } : {}) });
    return { ok: true };
  },
});

export const reconcile = internalAction({
  args: {},
  handler: async ctx => {
    const quotes: any[] = await ctx.runQuery(internal.rentalDeliveryState.pendingReconcile, {});
    let completed = 0, expiredRecoveryChecks = 0;
    for (const quote of quotes) {
      try {
        if (quote.status === "creating_checkout" && !quote.checkoutSessionId && quote.checkoutParams) {
          if ((quote.checkoutExpiresAt ?? 0) <= Date.now()) {
            if (quote.recoveryAutoCheckedAt || expiredRecoveryChecks >= 2) continue;
            expiredRecoveryChecks++;
            const recovery = await recoverQuotePaymentWithEvidence(ctx, quote._id);
            if (recovery.status === "needs_review") await ctx.runMutation(internal.rentalDeliveryState.markRecoveryNeedsReview, { id: quote._id });
            completed++;
            continue;
          }
          const session = await stripe().checkout.sessions.create(JSON.parse(quote.checkoutParams), { idempotencyKey: `dbc-delivery-quote-${quote._id}` });
          if (!session.url) throw Error("Stripe did not return the recoverable delivery payment link.");
          await ctx.runMutation(internal.rentalDeliveryState.bindSession, { id: quote._id, sessionId: session.id, url: session.url, sessionParams: quote.checkoutParams });
          if (session.status === "complete" && session.payment_status === "paid") await ctx.runAction((internal as any).rentalDelivery.finalizePaid, { id: quote._id, sessionId: session.id });
          else if (session.status === "expired") await ctx.runMutation(internal.rentalDeliveryState.expire, { id: quote._id, sessionId: session.id });
          completed++;
          continue;
        }
        if (quote.status === "awaiting_acceptance" || quote.status === "creating_checkout" && !quote.checkoutSessionId) {
          await ctx.runMutation(internal.rentalDeliveryState.expire, { id: quote._id, ...(quote.checkoutSessionId ? { sessionId: quote.checkoutSessionId } : {}) });
          completed++;
          continue;
        }
        if (!quote.checkoutSessionId) continue;
        const session = await stripe().checkout.sessions.retrieve(quote.checkoutSessionId);
        if (session.status === "complete" && session.payment_status === "paid") await ctx.runAction((internal as any).rentalDelivery.finalizePaid, { id: quote._id, sessionId: session.id });
        else if (session.status === "expired") await ctx.runMutation(internal.rentalDeliveryState.expire, { id: quote._id, sessionId: session.id });
        completed++;
      } catch (error) {
        console.error("Delivery quote reconciliation deferred", quote._id, error);
        if (quote.status === "creating_checkout" && !quote.checkoutSessionId && quote.checkoutParams && (quote.checkoutExpiresAt ?? 0) <= Date.now()) {
          await ctx.runMutation(internal.rentalDeliveryState.markRecoveryNeedsReview, { id: quote._id });
        }
      }
    }
    return { completed };
  },
});
