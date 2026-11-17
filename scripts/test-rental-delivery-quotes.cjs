const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { load, db, put, setMock, tables } = require("./lib/rentalTestHarness.cjs");
process.env.ADMIN_TOKEN = "rental-delivery-test-owner";

const source = file => fs.readFileSync(path.resolve(__dirname, "..", file), "utf8");
const adminPanelSource = source("src/components/admin/RentalDeliveryQuotePanel.tsx");
const rentalToolsSource = source("src/components/admin/RentalOrderTools.tsx");
const renterConversationSource = source("src/components/rentals/RentalConversation.tsx");
const renterApprovalSource = source("src/components/rentals/RentalDeliveryQuoteApproval.tsx");
const deliveryActionSource = source("convex/rentalDelivery.ts");
assert.match(adminPanelSource, /api\.rentalDelivery\.createQuote/, "admins create delivery quotes through the server calculator");
assert.match(adminPanelSource, /value="one_way"/, "admins can quote one-way delivery");
assert.match(adminPanelSource, /value="round_trip"/, "admins can quote delivery and collection");
assert.match(adminPanelSource, /const deliveryAddress = addressDraft\.bookingId === booking\._id/, "the quote address is keyed to the selected rental before effects run");
assert.match(adminPanelSource, /setAddressDraft\(\{ bookingId: booking\._id, sourceAddress: booking\.address \?\? "", value: booking\.address \?\? "" \}\)/, "switching rentals resets the delivery address instead of leaking the prior renter's address");
assert.match(adminPanelSource, /!booking\.activeItemSwapId/, "the admin quote control is disabled while an item swap is pending");
assert.match(deliveryActionSource, /activePriceAdjustmentId\s*\|\|\s*booking\.activeItemSwapId/, "the quote action rejects a pending item swap before calculating delivery");
assert.match(rentalToolsSource, /<RentalDeliveryQuotePanel\s+token=\{token\}\s+booking=\{b\}\s*\/>/, "the quote control is available in the rental manager panel");
assert.match(renterConversationSource, /m\.meta\?\.kind === "delivery_quote" && !admin && m\.meta\.quoteId/, "the renter's rental chat renders the quote card");
assert.match(renterApprovalSource, /checked=\{termsAccepted\}/, "renter must explicitly accept delivery terms");
assert.match(renterApprovalSource, /accepted:\s*true/, "terms acceptance is sent to the server before payment creation");
assert.match(renterApprovalSource, /href=\{quote\.paymentUrl\}/, "the renter can continue from the chat using the payment link");
assert.match(renterApprovalSource, /quote\.amountPence\s*\/\s*100/, "the renter sees the calculated amount");

const messages = [];
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
  postRentalMessage: async (ctx, message) => {
    messages.push(message);
    return await ctx.db.insert("messages", message);
  },
});
setMock("./lib/rmv2SyncQueue", { queueRmv2Sync: async () => {} });

const quoteMath = load("shared/rentalDeliveryQuote.ts");
const memberDelivery = load("convex/lib/memberDelivery.ts");
const state = load("convex/rentalDeliveryState.ts");
const delivery = load("convex/rentalDelivery.ts");
const paymentSources = load("convex/lib/rentalPaymentSources.ts");
const rmv2Sync = load("convex/rmv2_sync.ts");
const account = put("accounts", { email: "delivery-test@rental.invalid", blockedAt: null, sessionToken: "renter-session" });
const listing = put("listings", { title: "Camera kit" });
const start = Date.UTC(2030, 10, 1);
const context = { db, scheduler: { runAfter: async () => {} } };

assert.equal(quoteMath.deliveryAmountPence([{ oneWay: 20, fee: 44 }, { oneWay: 30, fee: 66 }], "round_trip", 10), 11000);
assert.equal(quoteMath.deliveryAmountPence([{ oneWay: 20, fee: 44 }], "one_way", 10), 2200);
assert.equal(quoteMath.deliveryDiscountPence(4400, 15), 660);
assert.match(quoteMath.deliveryQuoteTerms("Base terms.", "one_way"), /The Grand Building, Trafalgar Square, London, WC2N 5EJ/);
assert.match(quoteMath.deliveryQuoteTerms("Base terms.", "round_trip"), /courier collection/);
assert.equal(quoteMath.deliveryQuoteTermsVersion("delivery-v2"), "delivery-v2+2026-11-chat-delivery-v1");

function makeBooking(owner = account) {
  return put("bookings", {
    accountId: owner._id,
    guestEmail: owner.email,
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

async function prepareStudio(booking, requestId) {
  return await state.prepareQuote.handler(context, {
    token: process.env.ADMIN_TOKEN,
    bookingId: booking._id,
    requestId,
    deliveryLegs: "one_way",
    deliveryAddress: "10 Example Street, London, WC2N 5EJ",
    postcode: "WC2N 5EJ",
    baseAmountPence: 4400,
    discountPence: 4400,
    amountPence: 0,
    membershipTier: "studio",
    benefitMonth: memberDelivery.londonMonth(),
    isStudioBenefit: true,
    termsVersion: quoteMath.deliveryQuoteTermsVersion("2026-10-delivery-v2"),
    termsText: quoteMath.deliveryQuoteTerms("Courier terms", "one_way"),
    expectedFingerprint: quoteMath.rentalDeliveryBookingFingerprint(booking),
  });
}

async function assertPendingSwapBlocksQuoteAction() {
  const booking = makeBooking();
  booking.activeItemSwapId = "pending-item-swap";
  let deliveryPriceCalls = 0;
  const actionContext = {
    runMutation: async () => undefined,
    runQuery: async () => ({ booking, account }),
    runAction: async () => { deliveryPriceCalls++; throw Error("delivery pricing should not run"); },
  };
  await assert.rejects(delivery.createQuote.handler(actionContext, {
    token: process.env.ADMIN_TOKEN,
    bookingId: booking._id,
    requestId: "pending-swap-delivery-quote",
    deliveryLegs: "one_way",
    deliveryAddress: "10 Example Street, London, WC2N 5EJ",
  }), /Only a verified, confirmed rental with pickup selected/);
  assert.equal(deliveryPriceCalls, 0, "a pending swap is rejected before the delivery calculator is called");
  await assert.rejects(prepare(booking, "pending-swap-state-quote"), /Only a verified, confirmed rental with pickup selected/);
  assert.equal((tables.get("rental_delivery_quotes") ?? []).some(row => row.bookingId === booking._id), false, "the authoritative quote state creates no quote while a swap is pending");
}

(async () => {
  await assertPendingSwapBlocksQuoteAction();
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

  const declineBooking = makeBooking();
  const declineQuote = await prepare(declineBooking, "delivery-decline-001");
  const declined = await state.decline.handler(context, { token: "renter-session", id: declineQuote._id });
  assert.equal(declined.status, "declined");
  assert.equal(declineBooking.activeDeliveryQuoteId, undefined, "declining leaves the rental collection-only and unlocked");
  assert.equal(messages.filter(message => message.meta?.kind === "delivery_quote_declined" && message.meta.deliveryQuoteId === declineQuote._id).length, 1, "the team receives one chat event when the renter declines");
  await state.decline.handler(context, { token: "renter-session", id: declineQuote._id });
  assert.equal(messages.filter(message => message.meta?.kind === "delivery_quote_declined" && message.meta.deliveryQuoteId === declineQuote._id).length, 1, "declining is idempotent");
  await assert.rejects(state.accept.handler(context, { token: "renter-session", id: declineQuote._id, accepted: true }), /expired|already|current/i);

  // An unaccepted/expired Studio quote does not reserve the monthly benefit.
  const expiryAccount = put("accounts", {
    email: "studio-expiry@rental.invalid", sessionToken: "studio-expiry-session",
    membershipActive: true, membershipTier: "studio", blockedAt: null,
  });
  const expiredBooking = makeBooking(expiryAccount);
  const expiredQuote = await prepareStudio(expiredBooking, "studio-expired-quote-001");
  await state.expire.handler(context, { id: expiredQuote._id });
  const replacementBooking = makeBooking(expiryAccount);
  const replacementQuote = await prepareStudio(replacementBooking, "studio-replacement-quote-001");
  await state.accept.handler(context, { token: expiryAccount.sessionToken, id: replacementQuote._id, accepted: true });
  assert.equal(replacementBooking.deliveryBenefitConsumed, true, "expiring an unaccepted quote leaves the month's Studio benefit available");
  assert.equal(expiredBooking.deliveryBenefitConsumed, undefined);

  // Two independent quotes may both be prepared, but serialized acceptance
  // mutations can consume the account/month entitlement only once.
  const concurrentAccount = put("accounts", {
    email: "studio-concurrent@rental.invalid", sessionToken: "studio-concurrent-session",
    membershipActive: true, membershipTier: "studio", blockedAt: null,
  });
  const concurrentBookingA = makeBooking(concurrentAccount), concurrentBookingB = makeBooking(concurrentAccount);
  const concurrentQuoteA = await prepareStudio(concurrentBookingA, "studio-concurrent-quote-a");
  const concurrentQuoteB = await prepareStudio(concurrentBookingB, "studio-concurrent-quote-b");
  let mutationQueue = Promise.resolve();
  const acceptSerialized = id => {
    const result = mutationQueue.then(() => state.accept.handler(context, { token: concurrentAccount.sessionToken, id, accepted: true }));
    mutationQueue = result.catch(() => {});
    return result;
  };
  const competingAccepts = await Promise.allSettled([
    acceptSerialized(concurrentQuoteA._id), acceptSerialized(concurrentQuoteB._id),
  ]);
  assert.equal(competingAccepts.filter(result => result.status === "fulfilled").length, 1, "only one simultaneous quote acceptance consumes the Studio benefit");
  assert.equal(competingAccepts.filter(result => result.status === "rejected").length, 1);
  assert.equal([concurrentBookingA, concurrentBookingB].filter(row => row.deliveryBenefitConsumed).length, 1);
  const winningQuote = competingAccepts[0].status === "fulfilled" ? concurrentQuoteA : concurrentQuoteB;
  const deliveredBooking = competingAccepts[0].status === "fulfilled" ? concurrentBookingA : concurrentBookingB;
  const deliveryMessagesBeforeReplay = messages.filter(message => message.meta?.kind === "delivery_paid" && message.meta.deliveryQuoteId === winningQuote._id).length;
  const replay = await state.accept.handler(context, { token: concurrentAccount.sessionToken, id: winningQuote._id, accepted: true });
  assert.equal(replay._id, winningQuote._id, "replaying accepted free delivery returns the original result");
  assert.equal(messages.filter(message => message.meta?.kind === "delivery_paid" && message.meta.deliveryQuoteId === winningQuote._id).length, deliveryMessagesBeforeReplay, "replay does not duplicate delivery confirmation");
  assert.equal(deliveredBooking.deliveryBenefitConsumed, true);

  // Account ID, rather than the current email alone, preserves the monthly
  // check if a renter changes their account email after using the benefit.
  concurrentAccount.email = "studio-concurrent-new-email@rental.invalid";
  const renamedEmailBooking = makeBooking(concurrentAccount);
  const renamedEmailQuote = await prepareStudio(renamedEmailBooking, "studio-renamed-email-quote");
  await assert.rejects(
    state.accept.handler(context, { token: concurrentAccount.sessionToken, id: renamedEmailQuote._id, accepted: true }),
    /monthly Studio delivery benefit is no longer available/,
  );
  assert.equal(renamedEmailBooking.fulfilment, "pickup", "a second email cannot bypass the account's consumed entitlement");

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
  console.log("PASS delivery quote calculation, terms acceptance, chat payment link, paid status, failed-payment rollback, and atomic Studio monthly entitlement/replay/expiry behavior.");
})().catch(error => { console.error(error); process.exitCode = 1; });
