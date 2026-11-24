const assert = require("node:assert/strict");
const { db, load, put, setMock, tables } = require("./lib/rentalTestHarness.cjs");

process.env.ADMIN_TOKEN = "delivery-async-payment-test-owner";
process.env.STRIPE_SECRET_KEY = "sk_test_fixture";

let stripeSession, recoverySession, recoveryCreates = 0, listedSessions = [], listHasMore = false, listCalls = 0;
setMock("stripe", {
  __esModule: true,
  default: class StripeFixture {
    constructor() {
      this.checkout = { sessions: { retrieve: async id => id === recoverySession?.id ? recoverySession : stripeSession, create: async (params, options) => { recoveryCreates++; assert.equal(options.idempotencyKey, `dbc-delivery-quote-${params.metadata.rentalDeliveryQuoteId}`); return recoverySession; }, list: async () => { listCalls++; return { data: listedSessions, has_more: listHasMore }; }, expire: async () => ({ ...stripeSession, status: "expired", payment_status: "unpaid" }) } };
      this.paymentIntents = { retrieve: async id => ({ id, status: "succeeded", currency: "gbp", amount_received: stripeSession.amount_total, metadata: stripeSession.metadata }) };
    }
  },
});
setMock("./lib/rentalAccount", {
  accountForRental: async (_ctx, booking) => tables.get("accounts").find(account => account.email === booking.guestEmail),
});
setMock("./lib/rentalChat", {
  accountForToken: async (_ctx, token) => tables.get("accounts").find(account => account.sessionToken === token) ?? null,
  ownedBooking: async (_ctx, account, bookingId) => {
    const booking = await db.get(bookingId);
    if (!booking || booking.guestEmail !== account.email) throw Error("not owned");
    return booking;
  },
  postRentalMessage: async (ctx, message) => await ctx.db.insert("messages", message),
});
setMock("./lib/rmv2SyncQueue", { queueRmv2Sync: async () => {} });

const state = load("convex/rentalDeliveryState.ts");
const delivery = load("convex/rentalDelivery.ts");
const { rentalDeliveryBookingFingerprint, deliveryQuoteTermsVersion, deliveryQuoteTerms } = load("shared/rentalDeliveryQuote.ts");
const { DELIVERY_TERMS_VERSION, DELIVERY_ACCEPTANCE_TEXT } = load("shared/rentalAgreement.ts");
const start = Date.UTC(2030, 10, 1);
const account = put("accounts", { email: "delayed-payment@rental.invalid", sessionToken: "renter-token" });
const listing = put("listings", { title: "Cinema lens" });

function makePendingQuote(requestId) {
  const booking = put("bookings", {
    accountId: account._id,
    guestEmail: account.email,
    status: "confirmed",
    idVerifyStatus: "verified",
    verificationProvider: "didit",
    idVerificationSource: "didit",
    idVerifiedAt: start - 1000,
    verificationChecks: { identity: "approved", selfie: "approved", address: "approved" },
    paidConfirmedAt: start - 1000,
    fulfilment: "pickup",
    deliveryFee: 0,
    total: 100,
    rentalPaidPence: 10000,
    lineItems: [{ listingId: listing._id, title: "Cinema lens", start, end: start + 86400000, qty: 1, lineTotal: 100 }],
  });
  const quote = put("rental_delivery_quotes", {
    accountId: account._id,
    bookingId: booking._id,
    requestId,
    deliveryLegs: "one_way",
    deliveryAddress: "10 Example Street, London, WC2N 5EJ",
    postcode: "WC2N 5EJ",
    baseAmountPence: 4400,
    discountPence: 0,
    amountPence: 4400,
    termsVersion: deliveryQuoteTermsVersion(DELIVERY_TERMS_VERSION),
    termsText: deliveryQuoteTerms(DELIVERY_ACCEPTANCE_TEXT, "one_way"),
    bookingFingerprint: rentalDeliveryBookingFingerprint(booking),
    status: "checkout_open",
    acceptedAt: Date.now() - 1000,
    creditOptIn: true,
    creditAppliedPence: 1400,
    cardDuePence: 3000,
    expiresAt: Date.now() + 30 * 60 * 1000,
    checkoutSessionId: `cs_${requestId}`,
    paymentUrl: "https://checkout.stripe.com/c/pay/test",
    updatedAt: Date.now(),
  });
  booking.activeDeliveryQuoteId = quote._id;
  const credit = put("credits", {
    accountId: account._id,
    kind: "refund",
    currency: "GBP",
    amount: 14,
    remaining: 14,
    reason: "rental_refund:delivery-async-fixture",
    createdAt: Date.now(),
    expiresAt: Date.now() + 86400000,
    status: "active",
  });
  const reservation = put("rental_credit_reservations", {
    accountId: account._id,
    bookingId: booking._id,
    operationType: "delivery",
    operationId: String(quote._id),
    state: "reserved",
    requestedPence: 1400,
    amountPence: 1400,
    allocations: [{ creditId: credit._id, amountPence: 1400, kind: "refund" }],
    createdAt: Date.now(),
    updatedAt: Date.now(),
    expiresAt: quote.expiresAt,
  });
  quote.creditReservationId = reservation._id;
  return { booking, quote, credit, reservation };
}

const { booking, quote, credit, reservation } = makePendingQuote("delayed-settlement");
stripeSession = {
  id: quote.checkoutSessionId,
  status: "complete",
  payment_status: "unpaid",
  amount_total: quote.cardDuePence,
  currency: "gbp",
  payment_intent: "pi_delayed_delivery",
  metadata: { rentalDeliveryQuoteId: quote._id, bookingId: booking._id, cardDuePence: String(quote.cardDuePence), creditAppliedPence: String(quote.creditAppliedPence) },
};

const stateContext = { db, scheduler: { runAfter: async () => {} } };
const actionContext = {
  runMutation: async (reference, args) => {
    if (String(reference).endsWith("adminAuth.assertAdminInternal")) { if (args.token !== process.env.ADMIN_TOKEN) throw Error("Unauthorized"); return; }
    if (String(reference).endsWith("rentalDeliveryState.accept")) return await state.accept.handler(stateContext, args);
    if (String(reference).endsWith("rentalDeliveryState.markPaid")) return await state.markPaid.handler(stateContext, args);
    if (String(reference).endsWith("rentalDeliveryState.bindSession")) return await state.bindSession.handler(stateContext, args);
    if (String(reference).endsWith("rentalDeliveryState.bindRecoveredSession")) return await state.bindRecoveredSession.handler(stateContext, args);
    if (String(reference).endsWith("rentalDeliveryState.markRecoveryNeedsReview")) return await state.markRecoveryNeedsReview.handler(stateContext, args);
    if (String(reference).endsWith("rentalDeliveryState.expire")) return await state.expire.handler(stateContext, args);
    throw Error(`Unexpected mutation ${reference}`);
  },
  runQuery: async (reference, args) => {
    if (String(reference).endsWith("rentalDeliveryState.quoteContext")) return await state.quoteContext.handler(stateContext, args);
    if (String(reference).endsWith("rentalDeliveryState.pendingReconcile")) return await state.pendingReconcile.handler(stateContext, args);
    throw Error(`Unexpected query ${reference}`);
  },
  runAction: async (reference, args) => {
    if (String(reference).endsWith("rentalDelivery.finalizePaid")) return await delivery.finalizePaid.handler(actionContext, args);
    if (String(reference).endsWith("rentalDelivery.expire")) return await state.expire.handler(stateContext, args);
    throw Error(`Unexpected action ${reference}`);
  },
};

(async () => {
  const pending = await delivery.accept.handler(actionContext, { token: account.sessionToken, id: quote._id, accepted: true, useAccountCredit: true });
  assert.equal(pending.processing, true, "a completed but unpaid Stripe session is presented as processing");
  assert.equal(pending.paid, false);
  assert.equal(quote.status, "checkout_open", "pending async payment remains recoverable");
  assert.equal(credit.remaining, 14, "reserved account credit is not spent before Stripe confirms payment");
  assert.equal(reservation.state, "reserved");
  assert.equal(quote.cardDuePence, 3000, "the Stripe balance is the delivery amount after credit tender");
  assert.equal(booking.fulfilment, "pickup", "delivery is not applied before settlement");
  assert.equal(booking.activeDeliveryQuoteId, quote._id, "the rental stays locked while Stripe's delayed method settles");

  await delivery.reconcile.handler(actionContext, {});
  assert.equal(quote.status, "checkout_open", "reconciliation does not expire a complete-but-unpaid session");
  assert.equal(credit.remaining, 14, "reconciliation preserves credit while delayed payment is pending");
  assert.equal(booking.activeDeliveryQuoteId, quote._id);
  assert.equal(booking.fulfilment, "pickup");

  stripeSession = { ...stripeSession, payment_status: "paid" };
  await delivery.reconcile.handler(actionContext, {});
  assert.equal(quote.status, "paid", "a later verified settlement is finalized by reconciliation");
  assert.equal(quote.paymentIntentId, "pi_delayed_delivery");
  assert.equal(booking.fulfilment, "delivery");
  assert.equal(booking.deliveryLegs, "one_way");
  assert.equal(booking.activeDeliveryQuoteId, undefined);
  assert.equal(booking.deliveryFee, 44);
  assert.equal(credit.remaining, 0, "confirmed payment consumes the reserved account credit exactly once");
  assert.equal(reservation.state, "consumed");
  await delivery.reconcile.handler(actionContext, {});
  assert.equal(credit.remaining, 0, "payment reconciliation replay does not consume credit again");
  const recovery = makePendingQuote("lost-provider-response");
  recovery.quote.status = "creating_checkout"; recovery.quote.checkoutSessionId = undefined; recovery.quote.paymentUrl = undefined;
  recovery.quote.updatedAt = Date.now() - 6 * 60 * 1000; recovery.quote.checkoutExpiresAt = Date.now() + 25 * 60 * 1000;
  const metadata = { rentalDeliveryQuoteId: recovery.quote._id, bookingId: recovery.booking._id, cardDuePence: String(recovery.quote.cardDuePence), creditAppliedPence: String(recovery.quote.creditAppliedPence) };
  recovery.quote.checkoutParams = JSON.stringify({ line_items: [{ price_data: { unit_amount: recovery.quote.cardDuePence } }], metadata });
  recoverySession = { id: "cs_recovered_delivery", url: "https://checkout.stripe.com/c/pay/recovered", status: "open", payment_status: "unpaid", metadata };
  await delivery.reconcile.handler(actionContext, {});
  assert.equal(recoveryCreates, 1, "lost checkout creation is retried using the original idempotency key");
  assert.equal(recovery.quote.checkoutSessionId, recoverySession.id); assert.equal(recovery.quote.status, "checkout_open");
  assert.equal(recovery.reservation.state, "reserved", "recovery does not release credit against a potentially payable link");
  const oldRecovery = makePendingQuote("expired-unbound-response");
  oldRecovery.quote.status = "creating_checkout"; oldRecovery.quote.checkoutSessionId = undefined; oldRecovery.quote.paymentUrl = undefined;
  oldRecovery.quote.updatedAt = Date.now() - 40 * 60 * 1000; oldRecovery.quote.checkoutExpiresAt = Date.now() - 1000; oldRecovery.quote.checkoutParams = "{}";
  await delivery.reconcile.handler(actionContext, {});
  assert.equal(recoveryCreates, 1, "an expired prepared session is not recreated");
  assert.equal(oldRecovery.quote.status, "creating_checkout", "an unknown provider outcome remains locked for investigation");
  assert(oldRecovery.quote.recoveryAutoCheckedAt, "an ambiguous automatic recovery is flagged for the team instead of retried endlessly");
  assert.equal(oldRecovery.reservation.state, "reserved", "unknown provider outcome cannot release reserved credit");
  await assert.rejects(state.expire.handler(stateContext, { id: oldRecovery.quote._id }), /provider reconciliation/, "direct expiry cannot bypass the unknown-provider-outcome guard");
  assert.equal(oldRecovery.booking.activeDeliveryQuoteId, oldRecovery.quote._id);
  const listsBeforeAuth = listCalls;
  await assert.rejects(delivery.recoverQuotePayment.handler(actionContext, { token: "renter-token", id: oldRecovery.quote._id }), /Unauthorized/);
  assert.equal(listCalls, listsBeforeAuth, "renters cannot search provider payments");
  listedSessions = [];
  assert.equal((await delivery.recoverQuotePayment.handler(actionContext, { token: process.env.ADMIN_TOKEN, id: oldRecovery.quote._id })).status, "needs_review");
  assert.equal(oldRecovery.reservation.state, "reserved", "no search result is not proof of no payment");
  listedSessions = [{ id: "cs_ambiguous_a", metadata: { rentalDeliveryQuoteId: oldRecovery.quote._id } }, { id: "cs_ambiguous_b", metadata: { rentalDeliveryQuoteId: oldRecovery.quote._id } }];
  assert.equal((await delivery.recoverQuotePayment.handler(actionContext, { token: process.env.ADMIN_TOKEN, id: oldRecovery.quote._id })).status, "needs_review");
  listHasMore = true; listedSessions = [{ id: "cs_truncated", metadata: { rentalDeliveryQuoteId: oldRecovery.quote._id } }];
  assert.equal((await delivery.recoverQuotePayment.handler(actionContext, { token: process.env.ADMIN_TOKEN, id: oldRecovery.quote._id })).status, "needs_review"); listHasMore = false;
  assert.equal(oldRecovery.reservation.state, "reserved", "duplicate or incomplete provider results never release credit");
  function recoveryEvidence(fixture, suffix, paymentStatus, status = "complete") {
    const metadata = { rentalDeliveryQuoteId: fixture.quote._id, bookingId: fixture.booking._id, purpose: "rental_delivery", cardDuePence: String(fixture.quote.cardDuePence), creditAppliedPence: String(fixture.quote.creditAppliedPence) };
    return { id: `cs_admin_${suffix}`, mode: "payment", currency: "gbp", amount_total: fixture.quote.cardDuePence, status, payment_status: paymentStatus, payment_intent: `pi_admin_${suffix}`, metadata };
  }
  stripeSession = recoveryEvidence(oldRecovery, "unpaid", "unpaid", "expired"); listedSessions = [stripeSession];
  assert.equal((await delivery.recoverQuotePayment.handler(actionContext, { token: process.env.ADMIN_TOKEN, id: oldRecovery.quote._id })).status, "expired");
  assert.equal(oldRecovery.reservation.state, "released", "only a matching expired unpaid Stripe session releases credit");
  assert.equal((await delivery.recoverQuotePayment.handler(actionContext, { token: process.env.ADMIN_TOKEN, id: oldRecovery.quote._id })).status, "expired", "provider recovery replay is harmless");
  const processingRecovery = makePendingQuote("processing-unbound-response");
  processingRecovery.quote.status = "creating_checkout"; processingRecovery.quote.checkoutSessionId = undefined; processingRecovery.quote.paymentUrl = undefined; processingRecovery.quote.checkoutParams = "{}"; processingRecovery.quote.checkoutExpiresAt = Date.now() - 1000;
  stripeSession = recoveryEvidence(processingRecovery, "processing", "unpaid"); stripeSession.metadata.bookingId = "other-booking"; listedSessions = [stripeSession];
  assert.equal((await delivery.recoverQuotePayment.handler(actionContext, { token: process.env.ADMIN_TOKEN, id: processingRecovery.quote._id })).status, "needs_review", "mismatched provider metadata does not bind or release credit");
  assert.equal(processingRecovery.quote.checkoutSessionId, undefined); assert.equal(processingRecovery.reservation.state, "reserved");
  stripeSession = recoveryEvidence(processingRecovery, "processing", "unpaid"); listedSessions = [stripeSession];
  assert.equal((await delivery.recoverQuotePayment.handler(actionContext, { token: process.env.ADMIN_TOKEN, id: processingRecovery.quote._id })).status, "processing");
  assert.equal(processingRecovery.quote.checkoutSessionId, stripeSession.id); assert.equal(processingRecovery.reservation.state, "reserved", "completed but unpaid provider sessions stay locked");
  const paidRecovery = makePendingQuote("paid-unbound-response");
  paidRecovery.quote.status = "creating_checkout"; paidRecovery.quote.checkoutSessionId = undefined; paidRecovery.quote.paymentUrl = undefined; paidRecovery.quote.checkoutParams = "{}"; paidRecovery.quote.checkoutExpiresAt = Date.now() - 1000;
  stripeSession = recoveryEvidence(paidRecovery, "paid", "paid"); listedSessions = [stripeSession];
  assert.equal((await delivery.recoverQuotePayment.handler(actionContext, { token: process.env.ADMIN_TOKEN, id: paidRecovery.quote._id })).status, "paid");
  assert.equal(paidRecovery.booking.fulfilment, "delivery"); assert.equal(paidRecovery.reservation.state, "consumed");
  assert.equal((await delivery.recoverQuotePayment.handler(actionContext, { token: process.env.ADMIN_TOKEN, id: paidRecovery.quote._id })).status, "paid"); assert.equal(paidRecovery.credit.remaining, 0);
  recovery.quote.status = "paid"; processingRecovery.quote.status = "paid";
  const automatic = makePendingQuote("automatic-paid-response");
  automatic.quote.status = "creating_checkout"; automatic.quote.checkoutSessionId = undefined; automatic.quote.paymentUrl = undefined; automatic.quote.checkoutParams = "{}"; automatic.quote.checkoutExpiresAt = Date.now() - 1000; automatic.quote.updatedAt = Date.now() - 6 * 60 * 1000;
  stripeSession = recoveryEvidence(automatic, "automatic", "paid"); listedSessions = [stripeSession];
  await delivery.reconcile.handler(actionContext, {});
  assert.equal(automatic.quote.status, "paid", "scheduled recovery applies the same verified paid-session path as the admin action");
  assert.equal(automatic.credit.remaining, 0); await delivery.reconcile.handler(actionContext, {}); assert.equal(automatic.credit.remaining, 0, "scheduled recovery replay does not spend credit twice");
  const automaticUnpaid = makePendingQuote("automatic-unpaid-response");
  automaticUnpaid.quote.status = "creating_checkout"; automaticUnpaid.quote.checkoutSessionId = undefined; automaticUnpaid.quote.paymentUrl = undefined; automaticUnpaid.quote.checkoutParams = "{}"; automaticUnpaid.quote.checkoutExpiresAt = Date.now() - 1000; automaticUnpaid.quote.updatedAt = Date.now() - 6 * 60 * 1000;
  stripeSession = recoveryEvidence(automaticUnpaid, "automatic-unpaid", "unpaid", "expired"); listedSessions = [stripeSession];
  await delivery.reconcile.handler(actionContext, {});
  assert.equal(automaticUnpaid.quote.status, "expired"); assert.equal(automaticUnpaid.reservation.state, "released", "scheduled recovery releases credit only on verified expired unpaid sessions");
  const ambiguousBatch = ["one", "two", "three"].map(suffix => makePendingQuote(`automatic-ambiguous-${suffix}`));
  for (const fixture of ambiguousBatch) { fixture.quote.status = "creating_checkout"; fixture.quote.checkoutSessionId = undefined; fixture.quote.paymentUrl = undefined; fixture.quote.checkoutParams = "{}"; fixture.quote.checkoutExpiresAt = Date.now() - 1000; fixture.quote.updatedAt = Date.now() - 6 * 60 * 1000; }
  listedSessions = []; const listCallsBeforeBatch = listCalls; await delivery.reconcile.handler(actionContext, {});
  assert.equal(listCalls - listCallsBeforeBatch, 2, "each scheduled run performs at most two bounded recovery searches");
  assert.equal(ambiguousBatch.filter(fixture => fixture.quote.recoveryAutoCheckedAt).length, 2);
  await delivery.reconcile.handler(actionContext, {}); assert.equal(listCalls - listCallsBeforeBatch, 3, "remaining cases progress next run without retrying reviewed ambiguities");
  await delivery.reconcile.handler(actionContext, {}); assert.equal(listCalls - listCallsBeforeBatch, 3, "ambiguous cases wait for admin rather than repeated provider reads");
  assert(ambiguousBatch.every(fixture => fixture.reservation.state === "reserved"));
  console.log("PASS delivery async payment: completed/unpaid stays pending and locked; verified later settlement applies delivery exactly once.");
})().catch(error => { console.error(error); process.exitCode = 1; });
