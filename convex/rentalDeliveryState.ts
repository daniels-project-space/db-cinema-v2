import { checkAdminToken } from "./adminAuth";
import { internalMutation, internalQuery, query } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import { accountForRental } from "./lib/rentalAccount";
import { accountForToken, ownedBooking, postRentalMessage } from "./lib/rentalChat";
import { queueRmv2Sync } from "./lib/rmv2SyncQueue";
import { DELIVERY_TERMS_VERSION } from "../shared/rentalAgreement";
import { deliveryQuoteTermsVersion, rentalDeliveryBookingFingerprint } from "../shared/rentalDeliveryQuote";

const deliveryLegs = v.union(v.literal("one_way"), v.literal("round_trip"));

function assertQuoteStillCurrent(b: any, quote: any) {
  if (!b || b.status !== "confirmed" || b.idVerifyStatus !== "verified" || b.fulfilment !== "pickup" || b.deliveryLegs || b.cancellationDecision || b.returnDecision || b.activeAdditionId || b.activeDeliveryQuoteId && b.activeDeliveryQuoteId !== quote._id || b.activeExtensionId || b.activePriceAdjustmentId || rentalDeliveryBookingFingerprint(b) !== quote.bookingFingerprint)
    throw Error("This rental changed or is no longer eligible for a delivery quote. Ask the team to prepare a fresh quote.");
}

export const bookingContext = internalQuery({
  args: { bookingId: v.id("bookings") },
  handler: async (ctx, { bookingId }) => {
    const booking = await ctx.db.get(bookingId);
    if (!booking) return null;
    return { booking, account: await accountForRental(ctx, booking) };
  },
});

export const quoteContext = internalQuery({
  args: { id: v.id("rental_delivery_quotes") },
  handler: async (ctx, { id }) => {
    const quote = await ctx.db.get(id);
    if (!quote) return null;
    const booking = await ctx.db.get(quote.bookingId);
    return { quote, booking, account: booking ? await accountForRental(ctx, booking) : null };
  },
});

export const adminQuote = query({
  args: { token: v.string(), bookingId: v.id("bookings") },
  handler: async (ctx, { token, bookingId }) => {
    if (!checkAdminToken(token)) return { authorized: false, quotes: [] };
    const rows = await ctx.db.query("rental_delivery_quotes").withIndex("by_booking", q => q.eq("bookingId", bookingId)).order("desc").take(10);
    return { authorized: true, quotes: rows.map(q => ({ _id:q._id, deliveryLegs:q.deliveryLegs, amountPence:q.amountPence, baseAmountPence:q.baseAmountPence, discountPence:q.discountPence, membershipTier:q.membershipTier, status:q.status, expiresAt:q.expiresAt, checkoutExpiresAt:q.checkoutExpiresAt, acceptedAt:q.acceptedAt, paidAt:q.paidAt })) };
  },
});

export const customerQuote = query({
  args: { token: v.string(), id: v.id("rental_delivery_quotes") },
  handler: async (ctx, { token, id }) => {
    const account = await accountForToken(ctx, token);
    if (!account) return null;
    const quote = await ctx.db.get(id);
    if (!quote || quote.accountId !== account._id) return null;
    const booking = await ownedBooking(ctx, account, quote.bookingId);
    return {
      id: quote._id,
      bookingId: quote.bookingId,
      status: quote.status,
      deliveryLegs: quote.deliveryLegs,
      deliveryAddress: quote.deliveryAddress,
      baseAmountPence: quote.baseAmountPence,
      discountPence: quote.discountPence,
      amountPence: quote.amountPence,
      membershipTier: quote.membershipTier,
      isStudioBenefit: quote.isStudioBenefit,
      termsVersion: quote.termsVersion,
      termsText: quote.termsText,
      expiresAt: quote.expiresAt,
      paymentUrl: quote.paymentUrl,
      checkoutExpiresAt: quote.checkoutExpiresAt,
      bookingStatus: booking.status,
    };
  },
});

export const prepareQuote = internalMutation({
  args: {
    token: v.string(), bookingId: v.id("bookings"), requestId: v.string(), deliveryLegs,
    deliveryAddress: v.string(), postcode: v.string(), baseAmountPence: v.number(), discountPence: v.number(), amountPence: v.number(),
    membershipTier: v.optional(v.string()), benefitMonth: v.optional(v.string()), isStudioBenefit: v.boolean(), termsVersion: v.string(), termsText: v.string(), expectedFingerprint: v.string(),
  },
  handler: async (ctx, a) => {
    if (!checkAdminToken(a.token)) throw Error("Unauthorized");
    if (!a.requestId.trim() || a.requestId.length > 100 || !a.deliveryAddress.trim() || a.deliveryAddress.length > 300 || !a.postcode.trim() ||
      !Number.isSafeInteger(a.baseAmountPence) || !Number.isSafeInteger(a.discountPence) || !Number.isSafeInteger(a.amountPence) || a.amountPence < 0 ||
      a.discountPence < 0 || a.baseAmountPence - a.discountPence !== a.amountPence || a.termsVersion !== deliveryQuoteTermsVersion(DELIVERY_TERMS_VERSION) || a.termsText.length > 1000)
      throw Error("The delivery quote is incomplete or invalid.");
    const booking = await ctx.db.get(a.bookingId);
    if (!booking) throw Error("This rental changed while the delivery price was being calculated. Refresh and try again.");
    const account = await accountForRental(ctx, booking);
    if (!account || account.blockedAt != null) throw Error("A renter account is required to use the rental conversation for delivery acceptance.");
    const existing = await ctx.db.query("rental_delivery_quotes").withIndex("by_request", q => q.eq("bookingId", a.bookingId).eq("requestId", a.requestId)).first();
    if (existing) {
      const sameRequest = existing.accountId === account._id && existing.deliveryLegs === a.deliveryLegs &&
        existing.deliveryAddress === a.deliveryAddress.trim() && existing.postcode === a.postcode.trim().toUpperCase() &&
        existing.baseAmountPence === a.baseAmountPence && existing.discountPence === a.discountPence && existing.amountPence === a.amountPence &&
        existing.membershipTier === a.membershipTier && existing.benefitMonth === a.benefitMonth && existing.isStudioBenefit === a.isStudioBenefit &&
        existing.termsVersion === a.termsVersion && existing.termsText === a.termsText && existing.bookingFingerprint === a.expectedFingerprint;
      if (!sameRequest) throw Error("This quote request ID was already used with different details. Create a fresh quote.");
      if (existing.status === "paid") {
        if (booking.fulfilment !== "delivery" || booking.deliveryQuoteId !== existing._id) throw Error("The saved delivery quote no longer matches this rental.");
        return existing;
      }
      if (!["awaiting_acceptance", "creating_checkout", "checkout_open"].includes(existing.status) || existing.expiresAt <= Date.now())
        throw Error("This quote request is already closed. Create a fresh quote.");
      if (rentalDeliveryBookingFingerprint(booking) !== a.expectedFingerprint) throw Error("This rental changed while the delivery price was being calculated. Refresh and try again.");
      return existing;
    }
    if (rentalDeliveryBookingFingerprint(booking) !== a.expectedFingerprint) throw Error("This rental changed while the delivery price was being calculated. Refresh and try again.");
    if (booking.status !== "confirmed" || booking.idVerifyStatus !== "verified" || booking.fulfilment !== "pickup" || booking.deliveryLegs || booking.cancellationDecision || booking.returnDecision || booking.activeAdditionId || booking.activeDeliveryQuoteId || booking.activeExtensionId || booking.activePriceAdjustmentId)
      throw Error("Only a verified, confirmed rental with pickup selected can receive a delivery quote.");
    const open = await ctx.db.query("rental_delivery_quotes").withIndex("by_booking", q => q.eq("bookingId", a.bookingId)).order("desc").take(50);
    if (open.some(q => q.status === "awaiting_acceptance" && q.expiresAt > Date.now() || q.status === "creating_checkout" && q.updatedAt > Date.now() - 5 * 60 * 1000 || q.status === "checkout_open" && (q.checkoutExpiresAt ?? q.expiresAt) > Date.now()))
      throw Error("There is already an active delivery quote in this rental conversation.");
    const now = Date.now();
    const quoteId = await ctx.db.insert("rental_delivery_quotes", {
      bookingId: booking._id, accountId: account._id, requestId: a.requestId, deliveryLegs: a.deliveryLegs,
      deliveryAddress: a.deliveryAddress.trim(), postcode: a.postcode.trim().toUpperCase(), baseAmountPence: a.baseAmountPence,
      discountPence: a.discountPence, amountPence: a.amountPence, membershipTier: a.membershipTier, benefitMonth: a.benefitMonth,
      isStudioBenefit: a.isStudioBenefit, status: "awaiting_acceptance", termsVersion: a.termsVersion, termsText: a.termsText,
      bookingFingerprint: a.expectedFingerprint, createdAt: now, updatedAt: now, expiresAt: now + 24 * 60 * 60 * 1000,
    });
    const legs = a.deliveryLegs === "one_way" ? "One-way delivery" : "Delivery and collection";
    const amount = (a.amountPence / 100).toFixed(2);
    const discount = a.discountPence ? ` A member saving of £${(a.discountPence / 100).toFixed(2)} is included.` : "";
    await postRentalMessage(ctx, {
      accountId: account._id,
      bookingId: booking._id,
      sender: "system",
      text: `${legs} quote: £${amount}.${discount} Review the delivery terms and accept this quote here before payment. Your rental remains collection-only until payment succeeds.`,
      meta: { kind: "delivery_quote", quoteId },
    });
    return await ctx.db.get(quoteId);
  },
});

export const accept = internalMutation({
  args: { token: v.string(), id: v.id("rental_delivery_quotes"), accepted: v.boolean() },
  handler: async (ctx, { token, id, accepted }) => {
    const account = await accountForToken(ctx, token);
    if (!account || !accepted) throw Error("Please tick the delivery-terms box to continue.");
    const quote = await ctx.db.get(id);
    if (!quote || quote.accountId !== account._id) throw Error("This delivery quote is unavailable.");
    const booking = await ownedBooking(ctx, account, quote.bookingId);
    assertQuoteStillCurrent(booking, quote);
    if (quote.termsVersion !== deliveryQuoteTermsVersion(DELIVERY_TERMS_VERSION) || !quote.termsText.trim()) throw Error("The delivery terms have changed. Ask the team to prepare a fresh quote.");
    if (quote.expiresAt <= Date.now() || !["awaiting_acceptance", "creating_checkout", "checkout_open"].includes(quote.status)) throw Error("This delivery quote has expired. Ask the team for a current quote.");
    if (quote.acceptedAt) return quote;
    if (booking.activeDeliveryQuoteId) throw Error("Another delivery payment is already being prepared for this rental.");
    const now = Date.now();
    await ctx.db.patch(booking._id, { activeDeliveryQuoteId: id });
    await ctx.db.patch(id, { acceptedAt: now, status: quote.amountPence === 0 ? "paid" : "creating_checkout", paidAt: quote.amountPence === 0 ? now : undefined, updatedAt: now });
    if (quote.amountPence === 0) {
      await applyDelivery(ctx, { ...quote, acceptedAt: now, status: "paid", paidAt: now }, booking, undefined);
      await postRentalMessage(ctx, { accountId: account._id, bookingId: booking._id, sender: "system", text: "Your delivery terms are accepted and this member delivery is included at no extra charge. Delivery has been added to your rental.", meta: { kind: "delivery_paid", deliveryQuoteId: id } });
    }
    return { ...quote, acceptedAt: now };
  },
});

async function applyDelivery(ctx: any, quote: any, booking: any, paymentIntentId?: string) {
  const current = await ctx.db.get(booking._id);
  if (!current || current.status !== "confirmed" || current.fulfilment !== "pickup" || current.deliveryLegs || current.activeDeliveryQuoteId !== quote._id || rentalDeliveryBookingFingerprint(current) !== quote.bookingFingerprint)
    throw Error("The rental changed before delivery could be confirmed. Contact the team; no delivery status was changed.");
  const amount = quote.amountPence / 100;
  const patch: any = {
    fulfilment: "delivery", deliveryLegs: quote.deliveryLegs, deliveryQuoteId: quote._id,
    activeDeliveryQuoteId: undefined,
    deliveryFee: Math.round((current.deliveryFee + amount) * 100) / 100,
    total: Math.round((current.total + amount) * 100) / 100,
    rentalPaidPence: (current.rentalPaidPence ?? Math.round(current.total * 100)) + quote.amountPence,
  };
  if (quote.isStudioBenefit) {
    patch.deliveryBenefitAccountId = quote.accountId;
    patch.deliveryBenefitMonth = quote.benefitMonth;
    patch.deliveryBenefitConsumed = true;
  }
  if (quote.deliveryAddress !== current.address) patch.address = quote.deliveryAddress;
  await ctx.db.patch(current._id, patch);
  if (paymentIntentId) await ctx.db.patch(quote._id, { paymentIntentId });
  await ctx.db.patch(quote._id, { status: "paid", paidAt: quote.paidAt ?? Date.now(), updatedAt: Date.now() });
  await queueRmv2Sync(ctx, current._id);
  return { bookingId: current._id, amountPence: quote.amountPence };
}

export const bindSession = internalMutation({
  args: { id: v.id("rental_delivery_quotes"), sessionId: v.string(), url: v.string(), sessionParams: v.string() },
  handler: async (ctx, a) => {
    const quote = await ctx.db.get(a.id);
    if (!quote || !quote.acceptedAt || quote.amountPence <= 0 || !["creating_checkout", "checkout_open"].includes(quote.status)) throw Error("This delivery payment request is no longer available.");
    if (quote.checkoutSessionId && quote.checkoutSessionId !== a.sessionId) throw Error("A different delivery payment is already attached to this quote.");
    const booking = await ctx.db.get(quote.bookingId);
    assertQuoteStillCurrent(booking, quote);
    if (quote.paymentUrl && quote.checkoutSessionId) return quote;
    await ctx.db.patch(a.id, { checkoutSessionId: a.sessionId, paymentUrl: a.url, checkoutParams: a.sessionParams, status: "checkout_open", updatedAt: Date.now() });
    const msgId = await postRentalMessage(ctx, {
      accountId: quote.accountId,
      bookingId: quote.bookingId,
      sender: "system",
      text: `Your accepted delivery quote is ready to pay. Delivery remains unconfirmed until Stripe confirms payment.`,
      meta: { kind: "paylink", url: a.url, amount: (quote.amountPence / 100).toFixed(2), title: "Delivery" },
    });
    await ctx.db.patch(a.id, { paymentMessageId: msgId });
    return await ctx.db.get(a.id);
  },
});

export const prepareCheckout = internalMutation({
  args: { id: v.id("rental_delivery_quotes"), params: v.string(), expiresAt: v.number() },
  handler: async (ctx, { id, params, expiresAt }) => {
    const quote = await ctx.db.get(id);
    if (!quote || !quote.acceptedAt || quote.amountPence <= 0 || quote.status !== "creating_checkout") throw Error("This delivery payment is no longer available.");
    const booking = await ctx.db.get(quote.bookingId);
    assertQuoteStillCurrent(booking, quote);
    if (quote.checkoutParams) return quote;
    if (!Number.isSafeInteger(expiresAt) || expiresAt <= Date.now() || expiresAt > Date.now() + 60 * 60 * 1000 || params.length > 12000) throw Error("The delivery checkout request expired. Please retry.");
    await ctx.db.patch(id, { checkoutParams: params, checkoutExpiresAt: expiresAt, updatedAt: Date.now() });
    return await ctx.db.get(id);
  },
});

export const markPaid = internalMutation({
  args: { id: v.id("rental_delivery_quotes"), sessionId: v.string(), paymentIntentId: v.optional(v.string()), amountPence: v.number() },
  handler: async (ctx, a) => {
    const quote = await ctx.db.get(a.id);
    if (!quote) throw Error("Delivery quote not found.");
    if (quote.status === "paid") return { bookingId: quote.bookingId, paid: true, already: true };
    if (quote.checkoutSessionId !== a.sessionId || !quote.acceptedAt || a.amountPence !== quote.amountPence || quote.amountPence <= 0) throw Error("The delivery payment does not match the accepted quote.");
    const booking = await ctx.db.get(quote.bookingId);
    if (!booking) throw Error("The rental no longer exists.");
    const result = await applyDelivery(ctx, quote, booking, a.paymentIntentId);
    const account = await ctx.db.get(quote.accountId);
    if (account) await postRentalMessage(ctx, { accountId: account._id, bookingId: booking._id, sender: "system", text: quote.deliveryLegs === "one_way" ? "Delivery payment received. One-way delivery is now confirmed. Please return the equipment at the agreed time to The Grand Building, Trafalgar Square, London, WC2N 5EJ, and meet us outside the Waterstones bookstore." : "Delivery payment received. Delivery and courier collection are now confirmed for this rental.", meta: { kind: "delivery_paid", deliveryQuoteId: quote._id } });
    await ctx.scheduler.runAfter(0, internal.invoice.invoiceEmail, { bookingId: booking._id });
    return { ...result, paid: true, already: false };
  },
});

export const markFailed = internalMutation({
  args: { id: v.id("rental_delivery_quotes"), sessionId: v.string() },
  handler: async (ctx, { id, sessionId }) => {
    const quote = await ctx.db.get(id);
    if (!quote || quote.checkoutSessionId !== sessionId || quote.status === "paid") return false;
    await ctx.db.patch(id, { status: "failed", updatedAt: Date.now() });
    const booking = await ctx.db.get(quote.bookingId);
    if (booking?.activeDeliveryQuoteId === id) await ctx.db.patch(booking._id, { activeDeliveryQuoteId: undefined });
    return true;
  },
});

export const expire = internalMutation({
  args: { id: v.id("rental_delivery_quotes"), sessionId: v.optional(v.string()) },
  handler: async (ctx, { id, sessionId }) => {
    const quote = await ctx.db.get(id);
    if (!quote || quote.status === "paid" || sessionId && quote.checkoutSessionId !== sessionId) return false;
    await ctx.db.patch(id, { status: "expired", updatedAt: Date.now() });
    const booking = await ctx.db.get(quote.bookingId);
    if (booking?.activeDeliveryQuoteId === id) await ctx.db.patch(booking._id, { activeDeliveryQuoteId: undefined });
    return true;
  },
});

export const pendingReconcile = internalQuery({
  args: {},
  handler: async ctx => {
    const open = await ctx.db.query("rental_delivery_quotes").withIndex("by_status_updated", q => q.eq("status", "checkout_open")).order("asc").take(100);
    const creating = await ctx.db.query("rental_delivery_quotes").withIndex("by_status_updated", q => q.eq("status", "creating_checkout")).order("asc").take(100);
    const accepting = await ctx.db.query("rental_delivery_quotes").withIndex("by_status_updated", q => q.eq("status", "awaiting_acceptance")).order("asc").take(100);
    return [...open, ...creating.filter(q => q.updatedAt < Date.now() - 5 * 60 * 1000), ...accepting.filter(q => q.expiresAt <= Date.now())]
      .sort((a,b) => a.updatedAt - b.updatedAt).slice(0, 100);
  },
});
