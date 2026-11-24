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
assert.match(adminPanelSource, /requestRef\.current\?\.key === requestKey \? requestRef\.current\.id : crypto\.randomUUID\(\)/, "retrying an unchanged admin quote reuses its idempotency key instead of creating a second quote");
assert.match(adminPanelSource, /!booking\.activeItemSwapId/, "the admin quote control is disabled while an item swap is pending");
assert.match(adminPanelSource, /requestAllowsQuote = !latestDeliveryRequest \|\| latestDeliveryRequest\.status === "approved"/, "a typed renter request must be manually approved before its quote can be prepared");
assert.match(deliveryActionSource, /activePriceAdjustmentId\s*\|\|\s*booking\.activeItemSwapId/, "the quote action rejects a pending item swap before calculating delivery");
assert.match(deliveryActionSource, /context\.deliveryRequest\.status !== "approved"/, "the server blocks a quote while the latest renter delivery request is pending or declined");
assert.match(deliveryActionSource, /renterHandoverDetailsReady\(booking\)/, "the quote action uses the shared paid, verified handover gate");
assert.match(source("convex/rentalDeliveryState.ts"), /if \(!renterHandoverDetailsReady\(booking\)\) return null/, "renter quote reads hide exact return instructions if the booking loses any gate");
assert.match(rentalToolsSource, /<RentalDeliveryQuotePanel\s+token=\{token\}\s+booking=\{b\}\s*\/>/, "the quote control is available in the rental manager panel");
assert.match(renterConversationSource, /m\.meta\?\.kind === "delivery_quote" && !admin && m\.meta\.quoteId/, "the renter's rental chat renders the quote card");
assert.match(renterApprovalSource, /checked=\{termsAccepted\}/, "renter must explicitly accept delivery terms");
assert.match(renterApprovalSource, /accepted:\s*true/, "terms acceptance is sent to the server before payment creation");
assert.match(renterApprovalSource, /quote\.deliveryLegs === "one_way"[\s\S]*?Waterstones bookstore in Trafalgar Square/, "one-way renter copy names the in-person return point");
assert.match(renterApprovalSource, /const paymentUrl = approvedStripeCheckoutUrl\(quote\.paymentUrl\)/, "the renter payment link must pass the approved Stripe URL check");
assert.match(renterApprovalSource, /href=\{paymentUrl\}/, "only a verified Stripe checkout link is clickable in chat");
assert.match(renterApprovalSource, /quote\.amountPence\s*\/\s*100/, "the renter sees the calculated amount");
assert.match(renterApprovalSource, /quote\.checkoutExpiresAt\s*\?\?\s*quote\.expiresAt/, "the renter UI uses Stripe's checkout expiry, not only the longer quote expiry");
assert.match(source("src/components/rentals/RenterRentalTools.tsx"), /data-testid="renter-delivery-request"/, "the renter can request one-way or round-trip delivery from rental controls");
assert.match(source("src/components/rentals/RentalRequestHistory.tsx"), /Approve for quote/, "the admin receives explicit approve/decline controls for a renter delivery request");

const messages = [];
const queuedRentalSyncs = [];
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
setMock("./lib/rmv2SyncQueue", { queueRmv2Sync: async (_ctx, bookingId) => { queuedRentalSyncs.push(bookingId); } });

const quoteMath = load("shared/rentalDeliveryQuote.ts");
const agreement = load("shared/rentalAgreement.ts");
const memberDelivery = load("convex/lib/memberDelivery.ts");
const state = load("convex/rentalDeliveryState.ts");
const delivery = load("convex/rentalDelivery.ts");
const paymentSources = load("convex/lib/rentalPaymentSources.ts");
const checkoutProof = load("convex/lib/cleanCompletedRental.ts");
const reviewEligibility = load("convex/lib/reviewEligibility.ts");
const rmv2Sync = load("convex/rmv2_sync.ts");
const account = put("accounts", { email: "delivery-test@rental.invalid", blockedAt: null, sessionToken: "renter-session" });
const listing = put("listings", { title: "Camera kit", reviewedImageUrls: ["https://cdn.example.invalid/camera-reviewed.webp"], sourceImages: ["https://cdn.example.invalid/camera-old-import.webp"] });
const start = Date.UTC(2030, 10, 1);
const context = { db, scheduler: { runAfter: async () => {} } };

async function testCheckoutDeliveryQuoteLegs() {
  const deliveryModule = load("convex/delivery.ts");
  const previousFetch = global.fetch;
  global.fetch = async () => ({ ok: true, json: async () => ({ result: { latitude: 51.5095, longitude: -0.1281, region: "London" } }) });
  try {
    const checkoutDeliveryContext = {
      runQuery: async (reference, args) => {
        if (reference === "settings.get") return { deliveryMaxKm: 30, deliveryMarginPct: 10 };
        if (reference === "delivery.specsFor") return await deliveryModule.specsFor.handler(context, args);
        throw Error(`unexpected delivery quote query ${reference}`);
      },
    };
    const groups = [{ start, end: start + 86400000, listingIds: [listing._id] }];
    const defaultQuote = await deliveryModule.quote.handler(checkoutDeliveryContext, { postcode: "SW1A 1AA", groups });
    const oneWayQuote = await deliveryModule.quote.handler(checkoutDeliveryContext, { postcode: "SW1A 1AA", groups, deliveryLegs: "one_way" });
    assert.equal(defaultQuote.deliveryLegs, "round_trip", "legacy checkout callers default to courier delivery and collection");
    assert.equal(oneWayQuote.deliveryLegs, "one_way");
    assert.equal(oneWayQuote.groups[0].fee, oneWayQuote.groups[0].oneWayFee, "one-way checkout quotes charge only one courier leg");
    assert.equal(defaultQuote.groups[0].fee, defaultQuote.groups[0].roundTripFee, "round-trip checkout quotes preserve both courier legs");
    assert(oneWayQuote.fee < defaultQuote.fee, "a one-way checkout quote is lower than the same round-trip quote");
  } finally {
    global.fetch = previousFetch;
  }
}

assert.equal(quoteMath.deliveryAmountPence([{ oneWay: 20, fee: 44 }, { oneWay: 30, fee: 66 }], "round_trip", 10), 11000);
assert.equal(quoteMath.deliveryAmountPence([{ oneWay: 20, fee: 44 }], "one_way", 10), 2200);
assert.equal(quoteMath.deliveryDiscountPence(4400, 15), 660);
const oneWayTerms = quoteMath.deliveryQuoteTerms(agreement.DELIVERY_ACCEPTANCE_TEXT, "one_way");
const roundTripTerms = quoteMath.deliveryQuoteTerms(agreement.DELIVERY_ACCEPTANCE_TEXT, "round_trip");
assert.match(oneWayTerms, /Trafalgar Square/i);
assert.match(oneWayTerms, /exact meeting point after payment, verification and booking confirmation/i);
assert.doesNotMatch(oneWayTerms, /Waterstones|Grand Building|WC2N 5EJ/i, "checkout quote terms do not disclose the exact handover point before booking confirmation");
assert.doesNotMatch(roundTripTerms, /Waterstones|Trafalgar Square/i, "courier collection quotes do not imply an in-person return leg");
assert.match(roundTripTerms, /courier collection/);
assert.equal(quoteMath.deliveryQuoteTermsVersion("delivery-v2"), "delivery-v2+2026-11-chat-delivery-v3");
assert(quoteMath.supportsDeliveryQuoteTerms("2026-10-delivery-v2", agreement.DELIVERY_ACCEPTANCE_TEXT, quoteMath.deliveryQuoteTermsVersion("2026-10-delivery-v2"), oneWayTerms, "one_way"), "new one-way terms are accepted for the correct delivery leg");
assert(quoteMath.supportsDeliveryQuoteTerms("2026-10-delivery-v2", agreement.DELIVERY_ACCEPTANCE_TEXT, "2026-10-delivery-v2+2026-11-chat-delivery-v2", `${agreement.DELIVERY_ACCEPTANCE_TEXT} This quote covers delivery to your address only. You must return the equipment at the agreed return time to The Grand Building, Trafalgar Square, London, WC2N 5EJ. Please meet us at the confirmed time outside the Waterstones bookstore in Trafalgar Square.`, "one_way"), "previously issued v2 agreements remain valid without rewriting their exact accepted wording");
assert(quoteMath.supportsDeliveryQuoteTerms("2026-10-delivery-v2", agreement.DELIVERY_ACCEPTANCE_TEXT, "2026-10-delivery-v2+2026-11-chat-delivery-v1", `${agreement.DELIVERY_ACCEPTANCE_TEXT} This quote covers delivery to your address only. Return the equipment at the agreed time in Trafalgar Square. The exact meeting point is shared after payment, verification and booking confirmation.`, "one_way"), "previously issued one-way terms remain acceptable without being rewritten");
assert(quoteMath.supportsDeliveryQuoteTerms("2026-10-delivery-v2", agreement.DELIVERY_ACCEPTANCE_TEXT, "2026-10-delivery-v2+2026-11-chat-delivery-v1", `${agreement.DELIVERY_ACCEPTANCE_TEXT} This quote covers delivery to your address only. You must return the equipment at the agreed return time to The Grand Building, Trafalgar Square, London, WC2N 5EJ. Please meet us outside the Waterstones bookstore at Trafalgar Square at the confirmed time.`, "one_way"), "checked-in v1 wording also remains valid when already issued");
assert(!quoteMath.supportsDeliveryQuoteTerms("2026-10-delivery-v2", agreement.DELIVERY_ACCEPTANCE_TEXT, quoteMath.deliveryQuoteTermsVersion("2026-10-delivery-v2"), roundTripTerms, "one_way"), "terms cannot be accepted under a different delivery leg");

function makeBooking(owner = account) {
  return put("bookings", {
    accountId: owner._id,
    guestEmail: owner.email,
    status: "confirmed",
    idVerifyStatus: "verified",
    verificationProvider: "didit",
    idVerificationSource: "didit",
    idVerifiedAt: Date.now(),
    verificationChecks: { identity: "approved", selfie: "approved", address: "approved" },
    paidConfirmedAt: Date.now(),
    fulfilment: "pickup",
    address: "",
    deliveryFee: 0,
    total: 100,
    rentalPaidPence: 10000,
    lineItems: [{ listingId: listing._id, title: "Camera kit", start, end: start + 86400000, qty: 1, lineTotal: 100 }],
  });
}

async function prepare(booking, requestId, legs = "one_way", overrides = {}) {
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
    termsText: quoteMath.deliveryQuoteTerms(agreement.DELIVERY_ACCEPTANCE_TEXT, legs),
    expectedFingerprint: quoteMath.rentalDeliveryBookingFingerprint(booking),
    ...overrides,
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
    termsText: quoteMath.deliveryQuoteTerms(agreement.DELIVERY_ACCEPTANCE_TEXT, "one_way"),
    expectedFingerprint: quoteMath.rentalDeliveryBookingFingerprint(booking),
  });
}

function checkoutParams(quote) {
  const cardDuePence = quote.cardDuePence ?? quote.amountPence;
  const metadata = { rentalDeliveryQuoteId: String(quote._id) };
  if (quote.creditOptIn) {
    metadata.cardDuePence = String(cardDuePence);
    metadata.creditAppliedPence = String(quote.creditAppliedPence ?? 0);
  }
  return JSON.stringify({
    line_items: [{ quantity: 1, price_data: { unit_amount: cardDuePence } }],
    metadata,
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
  }), /Only a paid, verified, confirmed rental with pickup selected/);
  assert.equal(deliveryPriceCalls, 0, "a pending swap is rejected before the delivery calculator is called");
  await assert.rejects(prepare(booking, "pending-swap-state-quote"), /Only a paid, verified, confirmed rental with pickup selected/);
  assert.equal((tables.get("rental_delivery_quotes") ?? []).some(row => row.bookingId === booking._id), false, "the authoritative quote state creates no quote while a swap is pending");
}

(async () => {
  await testCheckoutDeliveryQuoteLegs();
  await assertPendingSwapBlocksQuoteAction();

  for (const [label, invalidFields] of [
    ["unpaid", { paidConfirmedAt: undefined }],
    ["incomplete Didit", { verificationChecks: { identity: "approved", selfie: "approved", address: "pending" } }],
    ["untrusted Didit source", { idVerificationSource: undefined }],
  ]) {
    const ineligibleBooking = makeBooking();
    await db.patch(ineligibleBooking._id, invalidFields);
    await assert.rejects(prepare(ineligibleBooking, `ineligible-${label}`), /Only a paid, verified, confirmed rental with pickup selected/,
      `${label} rentals cannot receive one-way terms containing the exact return point`);
    let quoteCalculatorCalls = 0;
    const actionContext = {
      runMutation: async () => undefined,
      runQuery: async () => ({ booking: { ...ineligibleBooking, ...invalidFields }, account }),
      runAction: async () => { quoteCalculatorCalls++; throw Error("delivery pricing should not run"); },
    };
    await assert.rejects(delivery.createQuote.handler(actionContext, {
      token: process.env.ADMIN_TOKEN,
      bookingId: ineligibleBooking._id,
      requestId: `ineligible-action-${label}`,
      deliveryLegs: "one_way",
      deliveryAddress: "10 Example Street, London, WC2N 5EJ",
    }), /Only a paid, verified, confirmed rental with pickup selected/,
    `${label} rentals cannot reach the quote action's renter-facing terms`);
    assert.equal(quoteCalculatorCalls, 0, "ineligible rentals are rejected before delivery pricing or quote creation");
  }

  const gatedQuoteBooking = makeBooking();
  const gatedQuote = await prepare(gatedQuoteBooking, "quote-hidden-after-gate-loss");
  await db.patch(gatedQuoteBooking._id, { paidConfirmedAt: undefined });
  assert.equal(await state.customerQuote.handler(context, { token: "renter-session", id: gatedQuote._id }), null,
    "a renter cannot read a saved one-way quote with the exact return point after payment confirmation is lost");

  const booking = makeBooking();
  Object.assign(booking, {
    stripePaymentIntentId: "pi_checkout_delivery_001",
    currency: "GBP",
    checkoutExpectedAmountPence: 10000,
    checkoutPaidAt: Date.now(),
    checkoutPaymentAmountPence: 10000,
    checkoutPaymentCurrency: "GBP",
    checkoutPaymentStatus: "paid",
  });
  await assert.rejects(
    prepare(booking, "delivery-forged-benefit", "one_way", { discountPence: 4400, amountPence: 0, membershipTier: "studio", benefitMonth: memberDelivery.londonMonth(), isStudioBenefit: true }),
    /delivery benefit changed/i,
    "the authoritative quote boundary rejects a forged member discount for a non-member",
  );
  await assert.rejects(
    prepare(booking, "delivery-forged-terms", "one_way", { termsText: "This one-way quote includes courier collection." }),
    /incomplete or invalid/i,
    "the quote mutation rejects noncanonical delivery terms before persisting renter-facing text",
  );
  const tamperedTermsBooking = makeBooking();
  const tamperedTermsQuote = await prepare(tamperedTermsBooking, "delivery-terms-mutated-after-creation");
  tamperedTermsQuote.termsText = "This quote now says courier collection is included.";
  await assert.rejects(
    state.accept.handler(context, { token: account.sessionToken, id: tamperedTermsQuote._id, accepted: true }),
    /delivery terms have changed/i,
    "renter acceptance fails closed if the stored quote terms no longer match the canonical accepted text",
  );
  assert.equal(tamperedTermsBooking.activeDeliveryQuoteId, undefined, "invalid terms do not lock the rental or start payment");
  const legacyTermsBooking = makeBooking();
  const legacyTermsQuote = await prepare(legacyTermsBooking, "delivery-legacy-terms");
  const originalLegacyTerms = "Delivery uses an agreed third-party courier. Times are estimates and may be affected by traffic. The final delivery price is shown in your accepted quotation. Courier delays do not remove statutory rights; tell us promptly so we can assess the delay and available remedy. This quote covers delivery to your address only. Return the equipment at the agreed time in Trafalgar Square. The exact meeting point is shared after payment, verification and booking confirmation.";
  legacyTermsQuote.termsVersion = "2026-10-delivery-v2+2026-11-chat-delivery-v1";
  legacyTermsQuote.termsText = originalLegacyTerms;
  const legacyAccepted = await state.accept.handler(context, { token: account.sessionToken, id: legacyTermsQuote._id, accepted: true });
  assert.equal(legacyAccepted.status, "creating_checkout", "previously issued, unchanged delivery terms remain usable after the new wording ships");
  assert.equal(legacyTermsQuote.termsText, originalLegacyTerms, "the renter's accepted quote text is never rewritten");
  const paidPlus = put("accounts", {
    email: "delivery-paid-plus@rental.invalid", sessionToken: "delivery-paid-plus-session",
    membershipActive: true, membershipTier: "plus", membershipStatus: "active",
    membershipPaidThrough: Date.now() + 30 * 86400000, stripeSubscriptionId: "sub-delivery-paid-plus", firstRentalPaidAt: Date.now() - 86400000, firstCleanRentalCompletedAt: Date.now() - 86400000, blockedAt: null,
  });
  const plusBooking = makeBooking(paidPlus);
  const adminQuoteContext = {
    runMutation: async (ref, args) => {
      if (ref === "adminAuth.assertAdminInternal") return;
      if (ref === "rentalDeliveryState.prepareQuote") return state.prepareQuote.handler(context, args);
      throw Error(`unexpected mutation ${ref}`);
    },
    runQuery: async (ref, args) => {
      if (ref === "rentalDeliveryState.bookingContext") return state.bookingContext.handler(context, args);
      if (ref === "settings.get") return { deliveryMarginPct: 10 };
      throw Error(`unexpected query ${ref}`);
    },
    runAction: async (ref) => {
      if (ref !== "delivery.quote") throw Error(`unexpected action ${ref}`);
      return { ok: true, isLondon: false, groups: [{ start, end: start + 86400000, oneWay: 40, fee: 88 }] };
    },
  };
  const createAdminQuote = load("convex/rentalDelivery.ts").createQuote;
  const requestedBooking = makeBooking();
  const pendingDeliveryRequest = put("rental_change_requests", {
    bookingId: requestedBooking._id, accountId: account._id, requestId: "delivery-renter-request-01", kind: "delivery", detail: "Please quote delivery.",
    requestedDeliveryLegs: "one_way", messageId: "delivery-request-message", createdAt: Date.now(), status: "pending",
  });
  let deliveryCalculatorCalls = 0;
  const guardedQuoteContext = { ...adminQuoteContext, runAction: async (ref, args) => {
    if (ref !== "delivery.quote") throw Error(`unexpected action ${ref}`);
    deliveryCalculatorCalls += 1;
    return adminQuoteContext.runAction(ref, args);
  } };
  await assert.rejects(createAdminQuote.handler(guardedQuoteContext, {
    token: process.env.ADMIN_TOKEN, bookingId: requestedBooking._id, requestId: "delivery-pending-request-quote",
    deliveryLegs: "one_way", deliveryAddress: "10 Example Street, London, WC2N 5EJ",
  }), /Review the renter’s latest delivery request/i, "a pending request cannot be bypassed by using the admin quote panel");
  assert.equal(deliveryCalculatorCalls, 0, "a blocked request does not call the checkout delivery calculator");
  await assert.rejects(prepare(requestedBooking, "delivery-pending-request-direct"), /Review the renter’s latest delivery request/i,
    "the authoritative prepare mutation rechecks pending requests against action races");
  pendingDeliveryRequest.status = "approved";
  await assert.rejects(createAdminQuote.handler(adminQuoteContext, {
    token: process.env.ADMIN_TOKEN, bookingId: requestedBooking._id, requestId: "delivery-approved-leg-mismatch",
    deliveryLegs: "round_trip", deliveryAddress: "10 Example Street, London, WC2N 5EJ",
  }), /approved delivery type/i, "an admin quote must match the delivery type the renter requested and staff approved");
  const approvedDeliveryQuote = await prepare(requestedBooking, "delivery-approved-request-match", "one_way");
  assert.equal(approvedDeliveryQuote.deliveryLegs, "one_way", "the exact approved request type can proceed to the separate quote/payment flow");
  assert.equal(requestedBooking.fulfilment, "pickup", "preparing an approved quote still does not activate delivery");
  const plusResult = await createAdminQuote.handler(adminQuoteContext, {
    token: process.env.ADMIN_TOKEN, bookingId: plusBooking._id, requestId: "delivery-paid-plus-quote",
    deliveryLegs: "one_way", deliveryAddress: "10 Example Street, London, WC2N 5EJ",
  });
  const plusQuote = await db.get(plusResult.id);
  assert.equal(plusQuote.baseAmountPence, 4400);
  assert.equal(plusQuote.discountPence, 440, "admin chat quote applies the same active Plus delivery discount as checkout");
  assert.equal(plusQuote.amountPence, 3960);
  assert.equal(plusQuote.membershipTier, "plus");
  const deliveryQuoteMessageCount = messages.filter(message => message.meta?.kind === "delivery_quote").length;
  const plusReplay = await createAdminQuote.handler(adminQuoteContext, {
    token: process.env.ADMIN_TOKEN, bookingId: plusBooking._id, requestId: "delivery-paid-plus-quote",
    deliveryLegs: "one_way", deliveryAddress: "10 Example Street, London, WC2N 5EJ",
  });
  assert.equal(plusReplay.id, plusResult.id, "retrying a quote after a lost response returns the original quote row");
  assert.equal(messages.filter(message => message.meta?.kind === "delivery_quote").length, deliveryQuoteMessageCount, "a quote retry does not duplicate the chat card");
  const plusAccepted = await state.accept.handler(context, { token: paidPlus.sessionToken, id: plusQuote._id, accepted: true });
  assert.equal(plusAccepted.cardDuePence, 3960);
  const plusLinked = await state.bindSession.handler(context, { id: plusQuote._id, sessionId: "cs_delivery_paid_plus", url: "https://checkout.stripe.test/paid-plus", sessionParams: checkoutParams(plusAccepted) });
  assert.equal(JSON.parse(plusLinked.checkoutParams).line_items[0].price_data.unit_amount, 3960, "the saved payment-link snapshot charges the exact benefit-adjusted quote");
  await state.markPaid.handler(context, { id: plusQuote._id, sessionId: "cs_delivery_paid_plus", paymentIntentId: "pi_delivery_paid_plus", amountPence: 3960 });

  const trialAccount = put("accounts", {
    email: "delivery-first-trial@rental.invalid", sessionToken: "delivery-first-trial-session",
    membershipActive: true, membershipTier: "pro", membershipStatus: "trialing",
    membershipTrialEnd: Date.now() + 7 * 86400000, stripeSubscriptionId: "sub-delivery-first-trial", blockedAt: null,
  });
  const trialBooking = makeBooking(trialAccount);
  const trialQuoteContext = { ...adminQuoteContext,
    runQuery: async (ref, args) => ref === "rentalDeliveryState.bookingContext" ? state.bookingContext.handler(context, args) : ref === "settings.get" ? { deliveryMarginPct: 10 } : Promise.reject(Error(`unexpected query ${ref}`)),
    runMutation: async (ref, args) => ref === "adminAuth.assertAdminInternal" ? undefined : ref === "rentalDeliveryState.prepareQuote" ? state.prepareQuote.handler(context, args) : Promise.reject(Error(`unexpected mutation ${ref}`)),
  };
  const trialResult = await createAdminQuote.handler(trialQuoteContext, {
    token: process.env.ADMIN_TOKEN, bookingId: trialBooking._id, requestId: "delivery-first-trial-quote",
    deliveryLegs: "one_way", deliveryAddress: "10 Example Street, London, WC2N 5EJ",
  });
  const trialQuote = await db.get(trialResult.id);
  assert.equal(trialQuote.discountPence, 0, "a first paid or confirmed trial rental does not unlock delivery benefits before a clean return");
  assert.equal(trialQuote.amountPence, 4400);
  trialAccount.firstCleanRentalCompletedAt = Date.now();
  const returningTrialBooking = makeBooking(trialAccount);
  const returningTrialResult = await createAdminQuote.handler(trialQuoteContext, {
    token: process.env.ADMIN_TOKEN, bookingId: returningTrialBooking._id, requestId: "delivery-returning-trial-quote",
    deliveryLegs: "one_way", deliveryAddress: "10 Example Street, London, WC2N 5EJ",
  });
  const returningTrialQuote = await db.get(returningTrialResult.id);
  assert.equal(returningTrialQuote.discountPence, 0, "a clean completed rental alone does not unlock a trial member's subscription delivery benefit before its first paid invoice");
  assert.equal(returningTrialQuote.amountPence, 4400);
  trialAccount.membershipPaidThrough = Date.now() + 30 * 86400000;
  const paidTrialQuoteResult = await createAdminQuote.handler(trialQuoteContext, {
    token: process.env.ADMIN_TOKEN, bookingId: makeBooking(trialAccount)._id, requestId: "delivery-paid-trial-quote",
    deliveryLegs: "one_way", deliveryAddress: "10 Example Street, London, WC2N 5EJ",
  });
  const paidTrialQuote = await db.get(paidTrialQuoteResult.id);
  assert.equal(paidTrialQuote.discountPence, 1320, "delivery applies the subscription benefit after both clean completion and successful paid-through evidence");
  assert.equal(paidTrialQuote.amountPence, 3080);

  const quote = await prepare(booking, "delivery-one-way-001");
  const renterQuote = await state.customerQuote.handler(context, { token: account.sessionToken, id: quote._id });
  assert.deepEqual(renterQuote.items, [{ title: "Camera kit", qty: 1, imageSources: ["https://cdn.example.invalid/camera-reviewed.webp"] }], "the renter delivery card receives the booked listing's canonical reviewed photo, not an old imported image");
  const messagesAfterInitialQuote = messages.length;
  const retriedQuote = await prepare(booking, "delivery-one-way-001");
  assert.equal(retriedQuote._id, quote._id, "retrying the same quote request returns its original quote");
  assert.equal(messages.length, messagesAfterInitialQuote, "idempotent quote retries do not duplicate rental chat messages");
  await assert.rejects(prepare(booking, "delivery-one-way-001", "round_trip"), /already used with different details/);
  assert.equal(booking.activeDeliveryQuoteId, undefined, "an unaccepted proposal does not block booking edits");
  await assert.rejects(state.accept.handler(context, { token: "renter-session", id: quote._id, accepted: false }), /tick the delivery-terms box/);
  await state.accept.handler(context, { token: "renter-session", id: quote._id, accepted: true });
  assert.equal(booking.activeDeliveryQuoteId, quote._id, "accepted delivery locks overlapping operations until provider resolution");
  assert.equal(queuedRentalSyncs.includes(booking._id), false, "acceptance alone does not tell Rental Manager that delivery is confirmed");
  const linked = await state.bindSession.handler(context, { id: quote._id, sessionId: "cs_delivery_001", url: "https://checkout.stripe.test/session", sessionParams: checkoutParams(quote) });
  assert.equal(linked.status, "checkout_open");
  const paid = await state.markPaid.handler(context, { id: quote._id, sessionId: "cs_delivery_001", paymentIntentId: "pi_delivery_001", amountPence: 4400 });
  assert.equal(paid.paid, true);
  assert.equal(queuedRentalSyncs.filter(id => id === booking._id).length, 1, "verified payment queues one Rental Manager delivery update");
  assert.equal(booking.fulfilment, "delivery");
  assert.equal(booking.deliveryLegs, "one_way");
  assert.equal(booking.deliveryFee, 44);
  assert.equal(booking.total, 144);
  assert.equal(booking.rentalPaidPence, 10000, "a separately paid delivery quote never changes the checkout-only rental allocation");
  assert.equal(booking.address, "10 Example Street, London, WC2N 5EJ");
  assert.equal(booking.activeDeliveryQuoteId, undefined);
  assert.equal(tables.get("rental_delivery_quotes").find(row => row._id === quote._id).status, "paid");
  assert(messages.some(message => message.meta?.kind === "paylink"), "the accepted quote payment link is posted inside the rental chat");
  assert(messages.some(message => message.meta?.kind === "delivery_paid"), "payment confirmation is posted inside the rental chat");
  const oneWayProjection = rmv2Sync.mapBookingForSync(booking, new Map(), new Map(), new Map());
  assert.equal(oneWayProjection.deliveryLegs, "one_way", "the Rental Manager projection carries the paid one-way choice");
  assert.equal(oneWayProjection.fulfilment, "delivery");
  const sources = await paymentSources.rentalPaymentSources(context, booking);
  assert(sources.some(source => source.paymentIntentId === "pi_checkout_delivery_001" && source.maxPaidPence === 10000), "the original checkout refund source remains capped at its recorded rental allocation");
  assert(sources.some(source => source.paymentIntentId === "pi_delivery_001" && source.maxPaidPence === 4400), "delivery payment is included in the rental's refundable payment sources");
  const returnedAt = Date.now() - 86400000;
  const inspectedItems = [{ key: "legacy:0:0", title: "Camera kit", condition: "good", details: "", openCase: false }];
  const returnedBooking = {
    ...booking,
    status: "returned",
    pickedUpAt: returnedAt - 86400000,
    actualReturnedAt: returnedAt,
    returnedAt,
    returnDecision: { actualReturnedAt: returnedAt, chargeLate: false, lateClaimReason: "", damageKept: 0, depositKept: 0, inspection: inspectedItems },
    returnStatement: { actualReturnedAt: returnedAt, inspection: inspectedItems, damageTotal: 0, damageFromHold: 0, lateAssessed: 0, lateWaived: 0, rentalRefunded: 0 },
    depositAmount: 0,
    depositHoldAmount: 0,
    lineItems: [{ ...booking.lineItems[0], start: returnedAt - 2 * 86400000, end: returnedAt - 86400000 }],
  };
  assert.equal(checkoutProof.expectedCheckoutPaymentPence(returnedBooking), 10000, "clean-return accounting reads the persisted original checkout expectation, not aggregate rental totals");
  assert.equal(checkoutProof.hasCheckoutPaymentProof(returnedBooking, checkoutProof.expectedCheckoutPaymentPence(returnedBooking)), true, "a paid delivery ledger does not invalidate the verified checkout receipt");
  assert.equal(await checkoutProof.cleanCompletedRental(context, returnedBooking, account), true, "a clean return remains eligible when delivery was settled separately");
  assert.equal(reviewEligibility.customerReviewGate(returnedBooking), null, "a paid delivery quote cannot block an otherwise eligible renter review");

  const partialCreditAccount = put("accounts", { email: "delivery-credit@rental.invalid", blockedAt: null, sessionToken: "delivery-credit-session" });
  const partialCredit = put("credits", { accountId: partialCreditAccount._id, kind: "refund", currency: "GBP", amount: 25, remaining: 25, reason: "rental_refund", createdAt: Date.now(), expiresAt: Date.now() + 86400000, status: "active" });
  const partialCreditBooking = makeBooking(partialCreditAccount);
  const partialCreditQuote = await prepare(partialCreditBooking, "delivery-partial-credit-001");
  const foreignCreditAccount = put("accounts", { email: "delivery-foreign-credit@rental.invalid", blockedAt: null, sessionToken: "delivery-foreign-credit-session" });
  const foreignCredit = put("credits", { accountId: foreignCreditAccount._id, kind: "earned", currency: "GBP", amount: 100, remaining: 100, reason: "earned_credit", createdAt: Date.now(), expiresAt: Date.now() + 86400000, status: "active" });
  await assert.rejects(state.accept.handler(context, { token: foreignCreditAccount.sessionToken, id: partialCreditQuote._id, accepted: true, useAccountCredit: true }), /quote is unavailable/);
  assert.equal(foreignCredit.remaining, 100, "a different account cannot reserve or spend its credit on this renter's delivery quote");
  assert.equal(partialCreditBooking.activeDeliveryQuoteId, undefined, "a foreign acceptance attempt does not lock the booking");
  assert.equal((tables.get("rental_credit_reservations") ?? []).some(row => row.operationType === "delivery" && row.operationId === String(partialCreditQuote._id)), false, "a foreign acceptance attempt creates no reservation");
  const partialAccepted = await state.accept.handler(context, { token: partialCreditAccount.sessionToken, id: partialCreditQuote._id, accepted: true, useAccountCredit: true });
  assert.equal(partialAccepted.creditAppliedPence, 2500, "only explicitly selected available wallet credit is reserved");
  assert.equal(partialAccepted.cardDuePence, 1900, "Stripe is charged only the amount remaining after wallet credit");
  assert.equal(partialCredit.remaining, 25, "credit remains unspent while the card payment is pending");
  const replayedAcceptance = await state.accept.handler(context, { token: partialCreditAccount.sessionToken, id: partialCreditQuote._id, accepted: true, useAccountCredit: true });
  assert.equal(replayedAcceptance.creditAppliedPence, 2500, "replayed quote acceptance preserves the original credit allocation");
  assert.equal((tables.get("rental_credit_reservations") ?? []).filter(row => row.operationType === "delivery" && row.operationId === String(partialCreditQuote._id)).length, 1, "acceptance replay reuses one reservation");
  await assert.rejects(state.accept.handler(context, { token: partialCreditAccount.sessionToken, id: partialCreditQuote._id, accepted: true, useAccountCredit: false }), /different account-credit choice/);
  const partialLinked = await state.bindSession.handler(context, { id: partialCreditQuote._id, sessionId: "cs_delivery_credit_001", url: "https://checkout.stripe.test/partial-credit", sessionParams: checkoutParams(partialAccepted) });
  assert.equal(JSON.parse(partialLinked.checkoutParams).line_items[0].price_data.unit_amount, 1900);
  const partialPaid = await state.markPaid.handler(context, { id: partialCreditQuote._id, sessionId: "cs_delivery_credit_001", paymentIntentId: "pi_delivery_credit_001", amountPence: 1900 });
  assert.equal(partialPaid.paid, true);
  assert.equal(partialCredit.remaining, 0, "wallet credit is consumed once only after the card charge is confirmed");
  const replayedPartial = await state.markPaid.handler(context, { id: partialCreditQuote._id, sessionId: "cs_delivery_credit_001", paymentIntentId: "pi_delivery_credit_001", amountPence: 1900 });
  assert.equal(replayedPartial.already, true, "replayed payment confirmation does not consume wallet credit twice");
  assert.equal(queuedRentalSyncs.filter(id => id === partialCreditBooking._id).length, 1, "payment reconciliation replay does not enqueue a duplicate Rental Manager delivery transition");
  assert.equal(partialCredit.remaining, 0);
  const partialSources = await paymentSources.rentalPaymentSources(context, partialCreditBooking);
  assert(partialSources.some(source => source.paymentIntentId === "pi_delivery_credit_001" && source.maxPaidPence === 1900), "refund attribution records only the original card-paid portion, not wallet credit");

  const fullCreditAccount = put("accounts", { email: "delivery-full-credit@rental.invalid", blockedAt: null, sessionToken: "delivery-full-credit-session" });
  const fullCredit = put("credits", { accountId: fullCreditAccount._id, kind: "earned", currency: "GBP", amount: 44, remaining: 44, reason: "earned_credit", createdAt: Date.now(), expiresAt: Date.now() + 86400000, status: "active" });
  const fullCreditBooking = makeBooking(fullCreditAccount);
  const fullCreditQuote = await prepare(fullCreditBooking, "delivery-full-credit-001");
  const fullAccepted = await state.accept.handler(context, { token: fullCreditAccount.sessionToken, id: fullCreditQuote._id, accepted: true, useAccountCredit: true });
  assert.equal(fullAccepted.cardDuePence, 0, "full wallet coverage settles without creating a Stripe charge");
  assert.equal(fullCreditBooking.fulfilment, "delivery");
  assert.equal(queuedRentalSyncs.filter(id => id === fullCreditBooking._id).length, 1, "fully credit-funded accepted delivery queues its one settled Rental Manager update");
  assert.equal(fullCredit.remaining, 0);
  const fullSources = await paymentSources.rentalPaymentSources(context, fullCreditBooking);
  assert(!fullSources.some(source => source.paymentIntentId === fullCreditQuote.paymentIntentId), "wallet-funded delivery is not represented as card revenue");

  const failedCreditAccount = put("accounts", { email: "delivery-failed-credit@rental.invalid", blockedAt: null, sessionToken: "delivery-failed-credit-session" });
  const failedCredit = put("credits", { accountId: failedCreditAccount._id, kind: "refund", currency: "GBP", amount: 10, remaining: 10, reason: "rental_refund", createdAt: Date.now(), expiresAt: Date.now() + 86400000, status: "active" });
  const failedCreditBooking = makeBooking(failedCreditAccount);
  const failedCreditQuote = await prepare(failedCreditBooking, "delivery-failed-credit-001");
  const failedCreditAccepted = await state.accept.handler(context, { token: failedCreditAccount.sessionToken, id: failedCreditQuote._id, accepted: true, useAccountCredit: true });
  assert.equal(failedCreditAccepted.cardDuePence, 3400);
  await state.bindSession.handler(context, { id: failedCreditQuote._id, sessionId: "cs_delivery_credit_failed", url: "https://checkout.stripe.test/credit-failed", sessionParams: checkoutParams(failedCreditAccepted) });
  await state.markFailed.handler(context, { id: failedCreditQuote._id, sessionId: "cs_delivery_credit_failed" });
  assert.equal(failedCredit.remaining, 10, "failed card payment releases the wallet reservation without spending it");
  await state.markFailed.handler(context, { id: failedCreditQuote._id, sessionId: "cs_delivery_credit_failed" });
  assert.equal(failedCredit.remaining, 10, "failure reconciliation replay does not debit or duplicate the released wallet balance");
  assert.equal(failedCreditBooking.fulfilment, "pickup");
  assert.equal((await state.customerQuote.handler(context, { token: failedCreditAccount.sessionToken, id: failedCreditQuote._id })).availableAccountCreditPence, 1000, "released credit is available again after payment failure");

  const emptyCreditAccount = put("accounts", { email: "delivery-empty-credit@rental.invalid", blockedAt: null, sessionToken: "delivery-empty-credit-session" });
  const emptyCreditBooking = makeBooking(emptyCreditAccount);
  const emptyCreditQuote = await prepare(emptyCreditBooking, "delivery-empty-credit-001");
  await assert.rejects(state.accept.handler(context, { token: emptyCreditAccount.sessionToken, id: emptyCreditQuote._id, accepted: true, useAccountCredit: true }), /No account credit is currently available/);
  assert.equal(emptyCreditBooking.activeDeliveryQuoteId, undefined, "an empty account cannot accept a delivery quote using nonexistent credit");
  assert.equal(emptyCreditQuote.acceptedAt, undefined, "insufficient credit leaves the quote available for a card-only choice");

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
    membershipActive: true, membershipTier: "studio", firstCleanRentalCompletedAt: Date.now() - 86400000, blockedAt: null,
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
    membershipActive: true, membershipTier: "studio", firstCleanRentalCompletedAt: Date.now() - 86400000, blockedAt: null,
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
  await assert.rejects(
    prepareStudio(renamedEmailBooking, "studio-renamed-email-quote"),
    /delivery benefit changed/i,
    "the quote boundary rejects a repeated Studio benefit even after the renter changes email",
  );
  assert.equal(renamedEmailBooking.fulfilment, "pickup", "a second email cannot bypass the account's consumed entitlement");

  const roundTripBooking = makeBooking();
  const roundTripQuote = await prepare(roundTripBooking, "delivery-round-trip-001", "round_trip");
  await state.accept.handler(context, { token: "renter-session", id: roundTripQuote._id, accepted: true });
  await state.bindSession.handler(context, { id: roundTripQuote._id, sessionId: "cs_delivery_round_trip", url: "https://checkout.stripe.test/round-trip", sessionParams: checkoutParams(roundTripQuote) });
  await state.markPaid.handler(context, { id: roundTripQuote._id, sessionId: "cs_delivery_round_trip", paymentIntentId: "pi_delivery_round_trip", amountPence: 4400 });
  const roundTripProjection = rmv2Sync.mapBookingForSync(roundTripBooking, new Map(), new Map(), new Map());
  assert.equal(roundTripProjection.deliveryLegs, "round_trip", "the Rental Manager projection carries the paid round-trip choice");
  assert.equal(roundTripProjection.fulfilment, "delivery");

  const failedBooking = makeBooking();
  const failedQuote = await prepare(failedBooking, "delivery-failed-001", "round_trip");
  await state.accept.handler(context, { token: "renter-session", id: failedQuote._id, accepted: true });
  await state.bindSession.handler(context, { id: failedQuote._id, sessionId: "cs_delivery_002", url: "https://checkout.stripe.test/second", sessionParams: checkoutParams(failedQuote) });
  await state.markFailed.handler(context, { id: failedQuote._id, sessionId: "cs_delivery_002" });
  assert.equal(failedBooking.fulfilment, "pickup", "a failed payment never changes booking fulfilment");
  assert.equal(failedBooking.deliveryLegs, undefined);
  assert.equal(failedBooking.activeDeliveryQuoteId, undefined, "failed payment releases the booking lock");
  assert.equal(tables.get("rental_delivery_quotes").find(row => row._id === failedQuote._id).status, "failed");
  console.log("PASS delivery quote calculation, terms acceptance, chat payment link, paid status, failed-payment rollback, and atomic Studio monthly entitlement/replay/expiry behavior.");
})().catch(error => { console.error(error); process.exitCode = 1; });
