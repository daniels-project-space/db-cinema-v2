import { checkAdminToken } from "./adminAuth";
import { internalMutation, internalQuery, query } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import { accountForRental } from "./lib/rentalAccount";
import { membershipRentalBenefitAccount } from "./lib/rentalBenefitAccount";
import { accountForToken, ownedBooking, postRentalMessage } from "./lib/rentalChat";
import { listingRentalImages } from "./lib/catalogImages";
import { queueRmv2Sync } from "./lib/rmv2SyncQueue";
import { DELIVERY_TERMS_VERSION } from "../shared/rentalAgreement";
import { deliveryQuoteTerms, deliveryQuoteTermsVersion, rentalDeliveryBookingFingerprint, supportsDeliveryQuoteTerms } from "../shared/rentalDeliveryQuote";
import { DELIVERY_ACCEPTANCE_TEXT } from "../shared/rentalAgreement";
import { londonMonth, studioDeliveryAvailable } from "./lib/memberDelivery";
import { availableRentalCreditPence, reserveRentalCredit, releaseRentalCredit, consumeRentalCredit, reservationForOperation } from "./lib/rentalCreditFunding";
import { membershipDeliveryBenefit } from "../shared/rentalBenefits";
import { renterHandoverDetailsReady } from "./lib/renterRentalActionGate";

const deliveryLegs = v.union(v.literal("one_way"), v.literal("round_trip"));

function assertQuoteStillCurrent(b: any, quote: any) {
  if (!renterHandoverDetailsReady(b) || b.status !== "confirmed" || b.fulfilment !== "pickup" || b.deliveryLegs || b.cancellationDecision || b.returnDecision || b.activeAdditionId || b.activeDeliveryQuoteId && b.activeDeliveryQuoteId !== quote._id || b.activeExtensionId || b.activePriceAdjustmentId || b.activeItemSwapId || rentalDeliveryBookingFingerprint(b) !== quote.bookingFingerprint)
    throw Error("This rental changed or is no longer eligible for a delivery quote. Ask the team to prepare a fresh quote.");
}

async function latestDeliveryRequest(ctx: any, bookingId: any) {
  const rows = await ctx.db.query("rental_change_requests").withIndex("by_booking", (q: any) => q.eq("bookingId", bookingId)).order("desc").take(201);
  if (rows.length > 200) throw Error("This rental has a long request history. Review it before preparing delivery.");
  const request = rows.find((row: any) => row.kind === "delivery");
  return request ? { _id: request._id, status: request.status ?? "pending", requestedDeliveryLegs: request.requestedDeliveryLegs } : null;
}

export const bookingContext = internalQuery({
  args: { bookingId: v.id("bookings") },
  handler: async (ctx, { bookingId }) => {
    const booking = await ctx.db.get(bookingId);
    if (!booking) return null;
    const account = await accountForRental(ctx, booking);
    return { booking, account: await membershipRentalBenefitAccount(ctx, account), deliveryRequest: await latestDeliveryRequest(ctx, bookingId) };
  },
});

export const quoteContext = internalQuery({
  args: { id: v.id("rental_delivery_quotes") },
  handler: async (ctx, { id }) => {
    const quote = await ctx.db.get(id);
    if (!quote) return null;
    const booking = await ctx.db.get(quote.bookingId);
    const account = booking ? await accountForRental(ctx, booking) : null;
    return { quote, booking, account: await membershipRentalBenefitAccount(ctx, account) };
  },
});

export const adminQuote = query({
  args: { token: v.string(), bookingId: v.id("bookings") },
  handler: async (ctx, { token, bookingId }) => {
    if (!checkAdminToken(token)) return { authorized: false, quotes: [] };
    const rows = await ctx.db.query("rental_delivery_quotes").withIndex("by_booking", q => q.eq("bookingId", bookingId)).order("desc").take(10);
    return { authorized: true, deliveryRequest: await latestDeliveryRequest(ctx, bookingId), quotes: rows.map(q => ({ _id:q._id, deliveryLegs:q.deliveryLegs, amountPence:q.amountPence, baseAmountPence:q.baseAmountPence, discountPence:q.discountPence, membershipTier:q.membershipTier, status:q.status, expiresAt:q.expiresAt, checkoutExpiresAt:q.checkoutExpiresAt, acceptedAt:q.acceptedAt, paidAt:q.paidAt, recoveryNeeded:!!q.checkoutParams && (q.status === "creating_checkout" && !q.checkoutSessionId || q.status === "checkout_open" && !q.paymentUrl) })) };
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
    if (!renterHandoverDetailsReady(booking)) return null;
    const items = await Promise.all((booking.lineItems ?? []).slice(0, 12).map(async (line: any) => {
      const listing: any = line.listingId ? await ctx.db.get(line.listingId) : null;
      return {
        title: listing?.title ?? line.title ?? "Rental item",
        qty: line.qty ?? 1,
        imageSources: listingRentalImages(listing).slice(0, 4),
      };
    }));
    return {
      id: quote._id,
      bookingId: quote.bookingId,
      items,
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
      availableAccountCreditPence: await availableRentalCreditPence(ctx, account._id),
      useAccountCredit: !!quote.creditOptIn,
      creditAppliedPence: quote.creditAppliedPence ?? 0,
      cardDuePence: quote.cardDuePence ?? quote.amountPence,
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
      a.discountPence < 0 || a.baseAmountPence - a.discountPence !== a.amountPence || a.termsVersion !== deliveryQuoteTermsVersion(DELIVERY_TERMS_VERSION) || a.termsText !== deliveryQuoteTerms(DELIVERY_ACCEPTANCE_TEXT, a.deliveryLegs))
      throw Error("The delivery quote is incomplete or invalid.");
    const booking = await ctx.db.get(a.bookingId);
    if (!booking) throw Error("This rental changed while the delivery price was being calculated. Refresh and try again.");
    const bookingFulfilment = booking.fulfilment;
    const account = await membershipRentalBenefitAccount(ctx, await accountForRental(ctx, booking));
    if (!account || account.blockedAt != null) throw Error("A renter account is required to use the rental conversation for delivery acceptance.");
    if (!renterHandoverDetailsReady(booking) || booking.status !== "confirmed" || bookingFulfilment !== "pickup" || booking.deliveryLegs || booking.cancellationDecision || booking.returnDecision || booking.activeAdditionId || booking.activeDeliveryQuoteId || booking.activeExtensionId || booking.activePriceAdjustmentId || booking.activeItemSwapId)
      throw Error("Only a paid, verified, confirmed rental with pickup selected can receive a delivery quote.");
    const latestRequest = await latestDeliveryRequest(ctx, booking._id);
    if (latestRequest && (latestRequest.status !== "approved" || latestRequest.requestedDeliveryLegs !== a.deliveryLegs))
      throw Error("Review the renter’s latest delivery request and quote its approved delivery type before sending a price.");
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
    const studioBenefitMonth = londonMonth();
    const studioBenefitAvailable = a.isStudioBenefit && a.benefitMonth === studioBenefitMonth
      ? await studioDeliveryAvailable(ctx, account, studioBenefitMonth)
      : false;
    const canonicalBenefit = membershipDeliveryBenefit(account, a.baseAmountPence, studioBenefitAvailable);
    if (a.membershipTier !== canonicalBenefit.membershipTier || a.discountPence !== canonicalBenefit.discountPence ||
      a.isStudioBenefit !== canonicalBenefit.isStudioBenefit || a.benefitMonth !== (canonicalBenefit.isStudioBenefit ? studioBenefitMonth : undefined))
      throw Error("The renter's delivery benefit changed. Refresh the quote before sending it.");
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
  args: { token: v.string(), id: v.id("rental_delivery_quotes"), accepted: v.boolean(), useAccountCredit: v.optional(v.boolean()) },
  handler: async (ctx, { token, id, accepted, useAccountCredit }) => {
    const account = await accountForToken(ctx, token);
    if (!account || !accepted) throw Error("Please tick the delivery-terms box to continue.");
    const quote = await ctx.db.get(id);
    if (!quote || quote.accountId !== account._id) throw Error("This delivery quote is unavailable.");
    const booking = await ownedBooking(ctx, account, quote.bookingId);
    // Acceptance can be retried after the free delivery has already been
    // applied, when the booking no longer satisfies the pickup-only guard.
    // Return the original result without attempting to consume the benefit a
    // second time.
    if (quote.acceptedAt && quote.status === "paid") {
      if (!!quote.creditOptIn !== !!useAccountCredit) throw Error("This delivery quote was accepted with a different account-credit choice.");
      return quote;
    }
    assertQuoteStillCurrent(booking, quote);
    if (!supportsDeliveryQuoteTerms(DELIVERY_TERMS_VERSION, DELIVERY_ACCEPTANCE_TEXT, quote.termsVersion, quote.termsText, quote.deliveryLegs)) throw Error("The delivery terms have changed. Ask the team to prepare a fresh quote.");
    if (quote.expiresAt <= Date.now() || !["awaiting_acceptance", "creating_checkout", "checkout_open"].includes(quote.status)) throw Error("This delivery quote has expired. Ask the team for a current quote.");
    if (quote.acceptedAt) {
      if (!!quote.creditOptIn !== !!useAccountCredit) throw Error("This delivery quote was accepted with a different account-credit choice.");
      return quote;
    }
    if (quote.status !== "awaiting_acceptance") throw Error("This delivery quote is already being prepared. Please continue with its payment link.");
    if (booking.activeDeliveryQuoteId) throw Error("Another delivery payment is already being prepared for this rental.");
    const now = Date.now();
    const credit = useAccountCredit && quote.amountPence > 0
      ? await reserveRentalCredit(ctx, { accountId: account._id, bookingId: booking._id, operationType: "delivery", operationId: String(quote._id), requestedPence: quote.amountPence, expiresAt: quote.expiresAt })
      : null;
    if (useAccountCredit && quote.amountPence > 0 && !credit) throw Error("No account credit is currently available. Review the delivery total again.");
    const cardDuePence = Math.max(0, quote.amountPence - (credit?.amountPence ?? 0));
    await ctx.db.patch(booking._id, { activeDeliveryQuoteId: id });
    const acceptedPatch: any = { acceptedAt: now, status: cardDuePence === 0 ? "paid" : "creating_checkout", paidAt: cardDuePence === 0 ? now : undefined, updatedAt: now, creditOptIn: !!(useAccountCredit && quote.amountPence > 0), creditAppliedPence: credit?.amountPence ?? 0, cardDuePence, cardPaidPence: cardDuePence === 0 ? 0 : undefined, ...(credit ? { creditReservationId: credit._id } : {}) };
    await ctx.db.patch(id, acceptedPatch);
    if (cardDuePence === 0) {
      await applyDelivery(ctx, { ...quote, ...acceptedPatch }, booking, undefined);
      await postRentalMessage(ctx, { accountId: account._id, bookingId: booking._id, sender: "system", text: quote.amountPence === 0 ? "Your delivery terms are accepted and this member delivery is included at no extra charge. Delivery has been added to your rental." : `Your delivery is confirmed. £${((credit?.amountPence ?? 0) / 100).toFixed(2)} account credit covered the quote; no card payment was due.`, meta: { kind: "delivery_paid", deliveryQuoteId: id } });
    }
    return { ...quote, ...acceptedPatch };
  },
});

export const decline = internalMutation({
  args: { token: v.string(), id: v.id("rental_delivery_quotes") },
  handler: async (ctx, { token, id }) => {
    const account = await accountForToken(ctx, token);
    const quote = await ctx.db.get(id);
    if (!account || !quote || quote.accountId !== account._id) throw Error("This delivery quote is unavailable.");
    if (quote.status === "declined") return quote;
    if (quote.status !== "awaiting_acceptance" || quote.acceptedAt != null) throw Error("This quote can no longer be declined here. Message the rental team for help.");
    const booking = await ownedBooking(ctx, account, quote.bookingId);
    assertQuoteStillCurrent(booking, quote);
    const now = Date.now();
    await ctx.db.patch(id, { status: "declined", updatedAt: now });
    await postRentalMessage(ctx, { accountId: account._id, bookingId: booking._id, sender: "system", text: "The delivery quote was declined. This rental remains collection-only; message the team if you would like another option.", meta: { kind: "delivery_quote_declined", deliveryQuoteId: id } });
    return { ...quote, status: "declined", updatedAt: now };
  },
});

async function applyDelivery(ctx: any, quote: any, booking: any, paymentIntentId?: string) {
  const current = await ctx.db.get(booking._id);
  if (!current || current.status !== "confirmed" || current.fulfilment !== "pickup" || current.deliveryLegs || current.activeDeliveryQuoteId !== quote._id || rentalDeliveryBookingFingerprint(current) !== quote.bookingFingerprint)
    throw Error("The rental changed before delivery could be confirmed. Contact the team; no delivery status was changed.");
  if (quote.isStudioBenefit) {
    const account = await ctx.db.get(quote.accountId);
    if (quote.membershipTier !== "studio" || quote.amountPence !== 0 || quote.discountPence !== quote.baseAmountPence ||
      !quote.benefitMonth || quote.benefitMonth !== londonMonth(Date.now()) ||
      !await studioDeliveryAvailable(ctx, account, quote.benefitMonth)) {
      throw Error("The monthly Studio delivery benefit is no longer available. Ask the team to prepare a fresh quote.");
    }
  }
  const creditAppliedPence=quote.creditAppliedPence??0,cardDuePence=quote.cardDuePence??quote.amountPence;
  if(quote.creditOptIn){
    const reservation=await reservationForOperation(ctx,"delivery",String(quote._id));
    if(!reservation||reservation.accountId!==quote.accountId||reservation.bookingId!==quote.bookingId||reservation.amountPence!==creditAppliedPence||!["reserved","consumed"].includes(reservation.state)||cardDuePence!==Math.max(0,quote.amountPence-creditAppliedPence))throw Error("The delivery account-credit reservation no longer matches its accepted quote.");
  }else if(creditAppliedPence!==0||cardDuePence!==quote.amountPence)throw Error("The delivery payment allocation changed after acceptance.");
  if((cardDuePence===0&&paymentIntentId)||(cardDuePence>0&&!paymentIntentId))throw Error("The delivery card payment does not match the accepted balance.");
  if(quote.creditOptIn)await consumeRentalCredit(ctx,"delivery",String(quote._id));
  const amount = quote.amountPence / 100;
  const patch: any = {
    fulfilment: "delivery", deliveryLegs: quote.deliveryLegs, deliveryQuoteId: quote._id,
    activeDeliveryQuoteId: undefined,
    deliveryFee: Math.round((current.deliveryFee + amount) * 100) / 100,
    total: Math.round((current.total + amount) * 100) / 100,
  };
  if (quote.isStudioBenefit) {
    patch.deliveryBenefitAccountId = quote.accountId;
    patch.deliveryBenefitMonth = quote.benefitMonth;
    patch.deliveryBenefitConsumed = true;
  }
  if (quote.deliveryAddress !== current.address) patch.address = quote.deliveryAddress;
  await ctx.db.patch(current._id, patch);
  if (paymentIntentId) await ctx.db.patch(quote._id, { paymentIntentId });
  await ctx.db.patch(quote._id, { status: "paid", cardPaidPence: cardDuePence, paidAt: quote.paidAt ?? Date.now(), updatedAt: Date.now() });
  await queueRmv2Sync(ctx, current._id);
  return { bookingId: current._id, amountPence: quote.amountPence };
}

export const bindSession = internalMutation({
  args: { id: v.id("rental_delivery_quotes"), sessionId: v.string(), url: v.string(), sessionParams: v.string() },
  handler: async (ctx, a) => {
    const quote = await ctx.db.get(a.id);
    if (!quote || !quote.acceptedAt || (quote.cardDuePence ?? quote.amountPence) <= 0 || !["creating_checkout", "checkout_open"].includes(quote.status)) throw Error("This delivery payment request is no longer available.");
    if (quote.checkoutSessionId && quote.checkoutSessionId !== a.sessionId) throw Error("A different delivery payment is already attached to this quote.");
    const booking = await ctx.db.get(quote.bookingId);
    assertQuoteStillCurrent(booking, quote);
    const sessionParams=JSON.parse(a.sessionParams);
    const cardDuePence=quote.cardDuePence??quote.amountPence;
    if(sessionParams.line_items?.length!==1||sessionParams.line_items[0]?.price_data?.unit_amount!==cardDuePence||sessionParams.metadata?.rentalDeliveryQuoteId!==String(quote._id)||quote.creditOptIn&&(sessionParams.metadata?.cardDuePence!==String(cardDuePence)||sessionParams.metadata?.creditAppliedPence!==String(quote.creditAppliedPence??0)))throw Error("The delivery payment session does not match the accepted account-credit balance.");
    if (quote.paymentUrl && quote.checkoutSessionId) return quote;
    await ctx.db.patch(a.id, { checkoutSessionId: a.sessionId, paymentUrl: a.url, checkoutParams: a.sessionParams, status: "checkout_open", updatedAt: Date.now() });
    const msgId = await postRentalMessage(ctx, {
      accountId: quote.accountId,
      bookingId: quote.bookingId,
      sender: "system",
      text: `Your accepted delivery quote is ready to pay. Delivery remains unconfirmed until Stripe confirms payment.`,
      meta: { kind: "paylink", url: a.url, amount: (cardDuePence / 100).toFixed(2), grossAmount:(quote.amountPence/100).toFixed(2),creditAppliedPence:quote.creditAppliedPence??0, title: "Delivery" },
    });
    await ctx.db.patch(a.id, { paymentMessageId: msgId });
    return await ctx.db.get(a.id);
  },
});

export const bindRecoveredSession = internalMutation({
  args: { id: v.id("rental_delivery_quotes"), sessionId: v.string() },
  handler: async (ctx, { id, sessionId }) => {
    const quote = await ctx.db.get(id);
    if (!quote || !quote.acceptedAt || !quote.checkoutParams || !sessionId.startsWith("cs_")) throw Error("Delivery recovery is unavailable.");
    if (quote.checkoutSessionId) {
      if (quote.checkoutSessionId !== sessionId) throw Error("A different delivery payment is already attached.");
      return;
    }
    if (quote.status !== "creating_checkout") throw Error("This delivery payment is no longer awaiting recovery.");
    await ctx.db.patch(id, { checkoutSessionId: sessionId, status: "checkout_open", updatedAt: Date.now() });
  },
});

export const markRecoveryNeedsReview = internalMutation({
  args: { id: v.id("rental_delivery_quotes") },
  handler: async (ctx, { id }) => {
    const quote = await ctx.db.get(id);
    if (!quote || quote.status !== "creating_checkout" || quote.checkoutSessionId || !quote.checkoutParams) return;
    const now = Date.now();
    await ctx.db.patch(id, { recoveryAutoCheckedAt: now, updatedAt: now });
  },
});

export const prepareCheckout = internalMutation({
  args: { id: v.id("rental_delivery_quotes"), params: v.string(), expiresAt: v.number() },
  handler: async (ctx, { id, params, expiresAt }) => {
    const quote = await ctx.db.get(id);
    if (!quote || !quote.acceptedAt || (quote.cardDuePence ?? quote.amountPence) <= 0 || quote.status !== "creating_checkout") throw Error("This delivery payment is no longer available.");
    const booking = await ctx.db.get(quote.bookingId);
    assertQuoteStillCurrent(booking, quote);
    if (quote.checkoutParams) {
      const prepared=JSON.parse(quote.checkoutParams),cardDuePence=quote.cardDuePence??quote.amountPence;
      if(prepared.line_items?.length!==1||prepared.line_items[0]?.price_data?.unit_amount!==cardDuePence||prepared.metadata?.rentalDeliveryQuoteId!==String(quote._id)||quote.creditOptIn&&(prepared.metadata?.cardDuePence!==String(cardDuePence)||prepared.metadata?.creditAppliedPence!==String(quote.creditAppliedPence??0)))throw Error("The prepared delivery payment no longer matches its accepted account-credit balance.");
      return quote;
    }
    const proposed=JSON.parse(params),cardDuePence=quote.cardDuePence??quote.amountPence;
    if(proposed.line_items?.length!==1||proposed.line_items[0]?.price_data?.unit_amount!==cardDuePence||proposed.metadata?.rentalDeliveryQuoteId!==String(quote._id)||quote.creditOptIn&&(proposed.metadata?.cardDuePence!==String(cardDuePence)||proposed.metadata?.creditAppliedPence!==String(quote.creditAppliedPence??0)))throw Error("The delivery payment does not match its accepted account-credit balance.");
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
    if (quote.checkoutSessionId !== a.sessionId || !quote.acceptedAt || a.amountPence !== (quote.cardDuePence??quote.amountPence) || (quote.cardDuePence??quote.amountPence) <= 0) throw Error("The delivery payment does not match the accepted quote.");
    const booking = await ctx.db.get(quote.bookingId);
    if (!booking) throw Error("The rental no longer exists.");
    const result = await applyDelivery(ctx, quote, booking, a.paymentIntentId);
    const account = await ctx.db.get(quote.accountId);
    if (account) await postRentalMessage(ctx, { accountId: account._id, bookingId: booking._id, sender: "system", text: quote.deliveryLegs === "one_way" ? "Delivery payment received. One-way delivery is confirmed. Return the equipment at the agreed time in Trafalgar Square; your rental details show the meeting point when ready." : "Delivery payment received. Delivery and courier collection are now confirmed for this rental.", meta: { kind: "delivery_paid", deliveryQuoteId: quote._id } });
    await ctx.scheduler.runAfter(0, internal.invoice.invoiceEmail, { bookingId: booking._id });
    return { ...result, paid: true, already: false };
  },
});

export const markFailed = internalMutation({
  args: { id: v.id("rental_delivery_quotes"), sessionId: v.string() },
  handler: async (ctx, { id, sessionId }) => {
    const quote = await ctx.db.get(id);
    if (!quote || quote.checkoutSessionId !== sessionId || quote.status === "paid") return false;
    await releaseRentalCredit(ctx,"delivery",String(quote._id));
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
    if (quote.status === "creating_checkout" && quote.checkoutParams && !quote.checkoutSessionId) throw Error("The delivery payment needs provider reconciliation before this quote can be closed.");
    await releaseRentalCredit(ctx,"delivery",String(quote._id));
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
    const creating = await ctx.db.query("rental_delivery_quotes").withIndex("by_status_recovery_updated", q => q.eq("status", "creating_checkout").eq("recoveryAutoCheckedAt", undefined)).order("asc").take(100);
    const accepting = await ctx.db.query("rental_delivery_quotes").withIndex("by_status_updated", q => q.eq("status", "awaiting_acceptance")).order("asc").take(100);
    return [...open, ...creating.filter(q => q.updatedAt < Date.now() - 5 * 60 * 1000), ...accepting.filter(q => q.expiresAt <= Date.now())]
      .sort((a,b) => a.updatedAt - b.updatedAt).slice(0, 100);
  },
});
