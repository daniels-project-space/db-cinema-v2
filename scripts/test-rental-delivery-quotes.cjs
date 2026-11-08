const assert = require("node:assert/strict");
const { load, db, put, setMock, tables } = require("./lib/rentalTestHarness.cjs");
process.env.ADMIN_TOKEN = "rental-delivery-test-owner";

const messages = [];
setMock("./lib/rentalAccount", {
  accountForRental: async (_ctx, booking) => tables.get("accounts").find(account => account.email === booking.guestEmail),
});
setMock("./lib/rentalChat", {
  accountForToken: async (_ctx, token) => token === "renter-session" ? tables.get("accounts")[0] : null,
  ownedBooking: async (_ctx, account, bookingId) => {
    const booking = await db.get(bookingId);
    if (!booking || booking.guestEmail !== account.email) throw Error("not owned");
    return booking;
  },
  postRentalMessage: async (ctx, message) => {
    messages.push(message);
    return await ctx.db.insert("messages", message);
  },
});
setMock("./lib/rmv2SyncQueue", { queueRmv2Sync: async () => {} });

const quoteMath = load("shared/rentalDeliveryQuote.ts");
const state = load("convex/rentalDeliveryState.ts");
const paymentSources = load("convex/lib/rentalPaymentSources.ts");
const rmv2Sync = load("convex/rmv2_sync.ts");
const account = put("accounts", { email: "delivery-test@rental.invalid", blockedAt: null });
const listing = put("listings", { title: "Camera kit" });
const start = Date.UTC(2030, 10, 1);
const context = { db, scheduler: { runAfter: async () => {} } };

assert.equal(quoteMath.deliveryAmountPence([{ oneWay: 20, fee: 44 }, { oneWay: 30, fee: 66 }], "round_trip", 10), 11000);
assert.equal(quoteMath.deliveryAmountPence([{ oneWay: 20, fee: 44 }], "one_way", 10), 2200);
assert.equal(quoteMath.deliveryDiscountPence(4400, 15), 660);
assert.match(quoteMath.deliveryQuoteTerms("Base terms.", "one_way"), /The Grand Building, Trafalgar Square, London, WC2N 5EJ/);
assert.match(quoteMath.deliveryQuoteTerms("Base terms.", "round_trip"), /courier collection/);
assert.equal(quoteMath.deliveryQuoteTermsVersion("delivery-v2"), "delivery-v2+2026-11-chat-delivery-v1");

function makeBooking() {
  return put("bookings", {
    guestEmail: account.email,
    status: "confirmed",
    idVerifyStatus: "verified",
    fulfilment: "pickup",
    address: "",
    deliveryFee: 0,
    total: 100,
    rentalPaidPence: 10000,
    lineItems: [{ listingId: listing._id, title: "Camera kit", start, end: start + 86400000, qty: 1, lineTotal: 100 }],
  });
}

async function prepare(booking, requestId, legs = "one_way") {
  return await state.prepareQuote.handler(context, {
    token: process.env.ADMIN_TOKEN,
    bookingId: booking._id,
    requestId,
    deliveryLegs: legs,
    deliveryAddress: "10 Example Street, London, WC2N 5EJ",
    postcode: "WC2N 5EJ",
    baseAmountPence: 4400,
    discountPence: 0,
    amountPence: 4400,
    isStudioBenefit: false,
    termsVersion: quoteMath.deliveryQuoteTermsVersion("2026-10-delivery-v2"),
    termsText: quoteMath.deliveryQuoteTerms("Courier terms", legs),
    expectedFingerprint: quoteMath.rentalDeliveryBookingFingerprint(booking),
  });
}

(async () => {
  const booking = makeBooking();
  const quote = await prepare(booking, "delivery-one-way-001");
  const messagesAfterInitialQuote = messages.length;
  const retriedQuote = await prepare(booking, "delivery-one-way-001");
  assert.equal(retriedQuote._id, quote._id, "retrying the same quote request returns its original quote");
  assert.equal(messages.length, messagesAfterInitialQuote, "idempotent quote retries do not duplicate rental chat messages");
  await assert.rejects(prepare(booking, "delivery-one-way-001", "round_trip"), /already used with different details/);
  assert.equal(booking.activeDeliveryQuoteId, undefined, "an unaccepted proposal does not block booking edits");
  await assert.rejects(state.accept.handler(context, { token: "renter-session", id: quote._id, accepted: false }), /tick the delivery-terms box/);
  await state.accept.handler(context, { token: "renter-session", id: quote._id, accepted: true });
  assert.equal(booking.activeDeliveryQuoteId, quote._id, "accepted delivery locks overlapping operations until provider resolution");
  const linked = await state.bindSession.handler(context, { id: quote._id, sessionId: "cs_delivery_001", url: "https://checkout.stripe.test/session", sessionParams: "{}" });
  assert.equal(linked.status, "checkout_open");
  const paid = await state.markPaid.handler(context, { id: quote._id, sessionId: "cs_delivery_001", paymentIntentId: "pi_delivery_001", amountPence: 4400 });
  assert.equal(paid.paid, true);
  assert.equal(booking.fulfilment, "delivery");
  assert.equal(booking.deliveryLegs, "one_way");
  assert.equal(booking.deliveryFee, 44);
  assert.equal(booking.total, 144);
  assert.equal(booking.address, "10 Example Street, London, WC2N 5EJ");
  assert.equal(booking.activeDeliveryQuoteId, undefined);
  assert.equal(tables.get("rental_delivery_quotes").find(row => row._id === quote._id).status, "paid");
  assert(messages.some(message => message.meta?.kind === "paylink"), "the accepted quote payment link is posted inside the rental chat");
  assert(messages.some(message => message.meta?.kind === "delivery_paid"), "payment confirmation is posted inside the rental chat");
  const oneWayProjection = rmv2Sync.mapBookingForSync(booking, new Map(), new Map(), new Map());
  assert.equal(oneWayProjection.deliveryLegs, "one_way", "the Rental Manager projection carries the paid one-way choice");
  assert.equal(oneWayProjection.fulfilment, "delivery");
  const sources = await paymentSources.rentalPaymentSources(context, booking);
  assert(sources.some(source => source.paymentIntentId === "pi_delivery_001" && source.maxPaidPence === 4400), "delivery payment is included in the rental's refundable payment sources");

  const roundTripBooking = makeBooking();
  const roundTripQuote = await prepare(roundTripBooking, "delivery-round-trip-001", "round_trip");
  await state.accept.handler(context, { token: "renter-session", id: roundTripQuote._id, accepted: true });
  await state.bindSession.handler(context, { id: roundTripQuote._id, sessionId: "cs_delivery_round_trip", url: "https://checkout.stripe.test/round-trip", sessionParams: "{}" });
  await state.markPaid.handler(context, { id: roundTripQuote._id, sessionId: "cs_delivery_round_trip", paymentIntentId: "pi_delivery_round_trip", amountPence: 4400 });
  const roundTripProjection = rmv2Sync.mapBookingForSync(roundTripBooking, new Map(), new Map(), new Map());
  assert.equal(roundTripProjection.deliveryLegs, "round_trip", "the Rental Manager projection carries the paid round-trip choice");
  assert.equal(roundTripProjection.fulfilment, "delivery");

  const failedBooking = makeBooking();
  const failedQuote = await prepare(failedBooking, "delivery-failed-001", "round_trip");
  await state.accept.handler(context, { token: "renter-session", id: failedQuote._id, accepted: true });
  await state.bindSession.handler(context, { id: failedQuote._id, sessionId: "cs_delivery_002", url: "https://checkout.stripe.test/second", sessionParams: "{}" });
  await state.markFailed.handler(context, { id: failedQuote._id, sessionId: "cs_delivery_002" });
  assert.equal(failedBooking.fulfilment, "pickup", "a failed payment never changes booking fulfilment");
  assert.equal(failedBooking.deliveryLegs, undefined);
  assert.equal(failedBooking.activeDeliveryQuoteId, undefined, "failed payment releases the booking lock");
  assert.equal(tables.get("rental_delivery_quotes").find(row => row._id === failedQuote._id).status, "failed");
  console.log("PASS delivery quote calculation, terms acceptance, chat payment link, paid status, and failed-payment rollback.");
})().catch(error => { console.error(error); process.exitCode = 1; });
