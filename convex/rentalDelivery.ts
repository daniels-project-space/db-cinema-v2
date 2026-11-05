import Stripe from "stripe";
import { action, internalAction } from "./_generated/server";
import { api, internal } from "./_generated/api";
import { v } from "convex/values";
import { deliveryAmountPence, deliveryDiscountPence, deliveryQuoteTerms, deliveryQuoteTermsVersion, rentalDeliveryBookingFingerprint } from "../shared/rentalDeliveryQuote";
import { DELIVERY_ACCEPTANCE_TEXT, DELIVERY_TERMS_VERSION } from "../shared/rentalAgreement";
import { groupDeliveryItems } from "../shared/deliveryGroups";
import { membershipActiveNow, membershipTierFor } from "../shared/membership";
import { tierByKey } from "./lib/membership";
import { londonMonth } from "./lib/memberDelivery";

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
    if (booking.status !== "confirmed" || booking.idVerifyStatus !== "verified" || booking.fulfilment !== "pickup" || booking.deliveryLegs || booking.cancellationDecision || booking.returnDecision || booking.activeAdditionId || booking.activeDeliveryQuoteId || booking.activeExtensionId || booking.activePriceAdjustmentId)
      throw Error("Only a verified, confirmed rental with pickup selected can receive a delivery quote.");
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
    const discountPct = isStudioBenefit ? 100 : activeTier?.deliveryPct ?? 0;
    const discountPence = deliveryDiscountPence(baseAmountPence, discountPct);
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
      membershipTier: activeTier?.key,
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
  args: { token: v.string(), id: v.id("rental_delivery_quotes"), accepted: v.boolean() },
  handler: async (ctx, args) => {
    const quote: any = await ctx.runMutation(internal.rentalDeliveryState.accept, args);
    if (quote.amountPence === 0) return { url: null, free: true, paid: true, amountPence: 0 };
    if (quote.checkoutSessionId && quote.paymentUrl) {
      const existing = await stripe().checkout.sessions.retrieve(quote.checkoutSessionId);
      if (existing.status === "open" && existing.url) return { url: existing.url, free: false, paid: false, amountPence: quote.amountPence };
      if (existing.status === "complete" && existing.payment_status === "paid") {
        await ctx.runAction((internal as any).rentalDelivery.finalizePaid, { id: quote._id, sessionId: existing.id });
        return { url: null, free: false, paid: true, amountPence: quote.amountPence };
      }
      if (existing.status === "expired" || existing.status === "complete") {
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
    const amount = context.quote.amountPence;
    const legLabel = context.quote.deliveryLegs === "one_way" ? "One-way equipment delivery" : "Equipment delivery and collection";
    const meta = { rentalDeliveryQuoteId: String(context.quote._id), bookingId: String(context.booking._id), purpose: "rental_delivery" };
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
    return { url: bound.paymentUrl, free: false, paid: false, amountPence: amount };
  },
});

export const finalizePaid = internalAction({
  args: { id: v.id("rental_delivery_quotes"), sessionId: v.string() },
  handler: async (ctx, { id, sessionId }): Promise<any> => {
    const context: any = await ctx.runQuery(internal.rentalDeliveryState.quoteContext, { id });
    if (!context?.quote || context.quote.checkoutSessionId !== sessionId || !context.quote.acceptedAt) throw Error("The delivery payment does not match its accepted quote.");
    const session = await stripe().checkout.sessions.retrieve(sessionId, { expand: ["payment_intent"] });
    if (session.status !== "complete" || session.payment_status !== "paid" || session.amount_total !== context.quote.amountPence || session.metadata?.rentalDeliveryQuoteId !== String(id) || session.metadata?.bookingId !== String(context.quote.bookingId)) throw Error("Stripe has not confirmed the full delivery payment.");
    const paymentIntentId = typeof session.payment_intent === "string" ? session.payment_intent : session.payment_intent?.id;
    return await ctx.runMutation(internal.rentalDeliveryState.markPaid, { id, sessionId, paymentIntentId, amountPence: context.quote.amountPence });
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
    let completed = 0;
    for (const quote of quotes) {
      try {
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
      }
    }
    return { completed };
  },
});
