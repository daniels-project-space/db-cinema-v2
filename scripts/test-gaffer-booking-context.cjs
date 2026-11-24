const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");
const { load } = require("./lib/rentalTestHarness.cjs");
const { buildGafferMembershipContext, buildGafferRenterBookingFacts, focusGafferRenterBookings, gafferHandoverDisclosureReady, gafferNeedsRenterBookingContext, selectGafferCancellationBooking, selectGafferRenterBooking } = load("shared/gafferBookingContext.ts");
const { gafferCancellationFacts } = load("convex/lib/gafferCancellationFacts.ts");
const { cancellationEligibilityRecovery, gafferBookingStatus } = load("convex/lib/gafferBookingGuidance.ts");

const cancellationNow = Date.UTC(2026, 10, 21, 12);
const acceptedCancellationText = "This exact signed cancellation text must be used for this rental.";
const acceptedSnapshot = JSON.stringify({
  format: 1,
  version: "2026-11-v26",
  acceptedAt: cancellationNow - 86400000,
  signer: "Test renter",
  documents: [{
    kind: "cancellation",
    version: "2026-11-v26",
    text: { title: "Cancellation", updated: "November 2026", sections: [{ h: "Your cancellation", p: acceptedCancellationText }] },
  }],
  particulars: { timeZone: "Europe/London", lineItems: [] },
});
const cancellation = gafferCancellationFacts({
  agreementDocs: [{ kind: "cancellation", version: "2026-11-v26" }],
  agreementSnapshot: acceptedSnapshot,
  lineItems: [{ start: Date.UTC(2026, 11, 10), pickupTime: "12:00" }],
}, cancellationNow);
assert.equal(cancellation.termsVersion, "2026-11-v26");
assert.equal(cancellation.termsText, acceptedCancellationText, "personal eligibility uses the exact accepted snapshot, not just current terms");
assert.equal(cancellation.policy, "full_refund");
assert.equal(cancellation.timingBasis, "Seven or more London calendar days before the earliest equipment start");
const historicalCancellation = gafferCancellationFacts({
  agreementDocs: [{ kind: "cancellation", version: "2026-10-v16" }],
  lineItems: [{ start: Date.UTC(2026, 11, 10), pickupTime: "12:00" }],
}, cancellationNow);
assert.equal(historicalCancellation.termsVersion, "2026-10-v16", "older rentals retain their signed agreement version");
assert.match(historicalCancellation.termsText, /seven or fewer London calendar days/i);
assert.equal(historicalCancellation.policy, "full_refund");
const fullyApprovedRental = {
  status: "confirmed", paidConfirmedAt: cancellationNow, idVerifyStatus: "verified", verificationProvider: "didit",
  idVerificationSource: "didit", verificationChecks: { identity: "approved", selfie: "approved", address: "approved" },
  handoverDetails: { pickupAddress: "Trafalgar Square", phone: "+44 7000 000000" },
};
assert.equal(gafferHandoverDisclosureReady(fullyApprovedRental), true);
for (const change of [
  { paidConfirmedAt: null },
  { status: "pending_verification" },
  { verificationChecks: { identity: "approved", selfie: "approved", address: "waiting" } },
  { verificationProvider: "manual" },
  { handoverDetails: null },
]) assert.equal(gafferHandoverDisclosureReady({ ...fullyApprovedRental, ...change }), false,
  "Gaffer disclosure requires payment, complete Didit approval and confirmed status");
assert.equal(gafferCancellationFacts({ lineItems: [{ start: Date.UTC(2026, 11, 10) }] }, cancellationNow).policy, null,
  "unsigned or missing agreement facts do not fall back to a guessed policy");
const eligibleMessage = cancellationEligibilityRecovery("Am I still eligible for a refund?", {
  stage: "confirmed",
  verification: { status: "verified", expired: false, lateApprovalBlocked: false },
  cancellation,
});
assert.match(eligibleMessage, /full-refund window.*2026-11-v26/i);
assert.match(cancellationEligibilityRecovery("Am I eligible for a refund?", null, 2), /Which rental do you mean\?.*item name or pickup date/i,
  "ambiguous multi-rental cancellation questions ask for a specific rental instead of guessing or prematurely handing off");
assert.match(cancellationEligibilityRecovery("Am I eligible for a refund?", null, 0), /need the rental selected/i,
  "accounts without a rental still receive a clear context requirement");
assert.equal(cancellationEligibilityRecovery("Am I still eligible for a refund?", {
  stage: "confirmed",
  verification: { status: "verified", expired: false },
  cancellation: { ...cancellation, termsText: null },
}), "I can't verify the signed cancellation terms saved for this rental, so I won't guess whether a refund or credit applies. No cancellation or refund has been made.");
const bookings = [
  {
    _id: "private-internal-id",
    at: 2,
    status: "pending_verification",
    idVerifyStatus: "pending",
    address: "PRIVATE HOME ADDRESS",
    total: 900,
    depositHoldAmount: 200,
    pickupTime: "10:00",
    returnTime: "18:00",
    lineItems: [{ title: "Sony FX3", qty: 1, start: "2026-11-07", end: "2026-11-08" }],
  },
  { at: 1, status: "returned", idVerifyStatus: "verified", lineItems: [{ title: "Sony 24-70mm", start: "2026-10-01", end: "2026-10-02" }] },
];
const renterFacts = buildGafferRenterBookingFacts(bookings);
assert.deepEqual(focusGafferRenterBookings(bookings, "private-internal-id"), [bookings[0]]);
assert.deepEqual(focusGafferRenterBookings(bookings, "not-owned"), []);
assert.equal(focusGafferRenterBookings(bookings).length, 2);

const sonyRental = { lineItems: [{ title: "Sony FX3 cinema camera body", start: "2026-11-07", end: "2026-11-08" }] };
const canonRental = { lineItems: [{ title: "Canon RF 24-70mm F2.8 lens", start: "2026-11-12", end: "2026-11-13" }] };
assert.equal(selectGafferCancellationBooking([sonyRental, canonRental], "Can I cancel my Sony FX3 rental?"), sonyRental,
  "a distinct model reference safely selects the matching account-owned rental");
assert.equal(selectGafferCancellationBooking([sonyRental, canonRental], "Can I get a refund for my camera rental?"), null,
  "generic wording never guesses among multiple rentals");
assert.equal(selectGafferCancellationBooking([sonyRental, canonRental], "What is the refund window for 7 November?"), sonyRental,
  "an unambiguous day-and-month reference can select the matching rental");
assert.equal(selectGafferCancellationBooking([sonyRental, canonRental], "Can I cancel the rental on 2026-11-12?"), canonRental,
  "an unambiguous ISO rental date can select the matching rental");
assert.equal(selectGafferCancellationBooking([
  sonyRental,
  { lineItems: [{ title: "Sony FX3 cinema camera", start: "2026-12-07", end: "2026-12-08" }] },
], "Can I cancel my Sony FX3 rental?"), null, "the same item in two rentals remains ambiguous without a date");
assert.equal(selectGafferCancellationBooking([sonyRental, canonRental], "Can I cancel my Sony FX3 rental on 12 November?"), null,
  "conflicting item and date references fail closed instead of selecting either rental");
assert.equal(selectGafferCancellationBooking([
  sonyRental,
  { lineItems: [{ title: "Canon RF 24-70mm F2.8 lens", start: "2026-11-07", end: "2026-11-09" }] },
], "Can I cancel my rental on 7 November?"), null, "a date shared by multiple rentals remains ambiguous");
assert.equal(selectGafferCancellationBooking([sonyRental], "Can I get a refund?"), sonyRental,
  "single-rental accounts keep the existing deterministic path");
assert.equal(selectGafferCancellationBooking([sonyRental, canonRental], "Can I get a refund?"), null);
assert.equal(selectGafferRenterBooking([sonyRental], [
  { role: "user", content: "What is your general cancellation policy?" },
]), null, "a generic policy question must not inherit signed rental terms just because the account has one rental");
assert.equal(selectGafferRenterBooking([sonyRental], [
  { role: "user", content: "Can I get a refund for my rental?" },
]), sonyRental, "an explicit personal refund question still selects a sole rental");
const multiRentalFollowUp = [
  { role: "user", content: "Can you check the status of my Sony FX3 rental?" },
  { role: "assistant", content: "I found the rental." },
  { role: "user", content: "And the return time?" },
];
assert.equal(gafferNeedsRenterBookingContext(multiRentalFollowUp), true,
  "a short booking-detail fragment inherits only the immediately active rental topic");
assert.equal(selectGafferRenterBooking([sonyRental, canonRental], multiRentalFollowUp), sonyRental,
  "a multi-rental follow-up stays pinned to the renter's previously named booking");
const multiRentalItemsFollowUp = [
  { role: "user", content: "Can you check the status of my Sony FX3 rental?" },
  { role: "assistant", content: "I found the rental." },
  { role: "user", content: "And the items?" },
];
assert.equal(gafferNeedsRenterBookingContext(multiRentalItemsFollowUp), true,
  "a possessive item-list follow-up can inspect the selected rental contents");
assert.equal(selectGafferRenterBooking([sonyRental, canonRental], multiRentalItemsFollowUp), sonyRental,
  "a renter's item-list follow-up remains tied to the previously named booking");
const multiRentalCancellationFollowUp = [
  { role: "user", content: "Can you check the status of my Sony FX3 rental?" },
  { role: "assistant", content: "I found the rental." },
  { role: "user", content: "Can I get a refund for that?" },
];
assert.equal(selectGafferRenterBooking([sonyRental, canonRental], multiRentalCancellationFollowUp), sonyRental,
  "a later booking question can use the last uniquely identified rental without guessing among other rentals");
const rescheduleFollowUp = [
  { role: "user", content: "Can you check my Sony FX3 rental?" },
  { role: "assistant", content: "I found that rental." },
  { role: "user", content: "I'd like to change the return time." },
];
assert.equal(gafferNeedsRenterBookingContext(rescheduleFollowUp), true, "a natural multi-turn rescheduling request retains booking context");
assert.equal(selectGafferRenterBooking([sonyRental, canonRental], rescheduleFollowUp), sonyRental);
assert.equal(gafferNeedsRenterBookingContext([{ role: "user", content: "I'd like to change the return time." }]), false,
  "a context-free follow-up does not itself authorize selecting a rental");
assert.equal(selectGafferRenterBooking([sonyRental, canonRental], [
  { role: "user", content: "Can you check my Sony FX3 rental?" },
  { role: "assistant", content: "I found that rental." },
  { role: "user", content: "Can I get a refund for the Sony FX3 rental on 12 November?" },
]), null, "conflicting current item and date references must not inherit a previously selected rental");
assert.equal(selectGafferRenterBooking([
  sonyRental,
  { lineItems: [{ title: "Sony FX3 cinema camera", start: "2026-12-07", end: "2026-12-08" }] },
], [
  { role: "user", content: "Can you check my rental on 7 November?" },
  { role: "assistant", content: "I found that rental." },
  { role: "user", content: "Can I get a refund for my Sony FX3 rental?" },
]), null, "an explicitly named item shared by multiple rentals must not inherit the previously selected date");
const multiRentalPriceFollowUp = [
  { role: "user", content: "Can you check my Sony FX3 rental?" },
  { role: "assistant", content: "I found that rental." },
  { role: "user", content: "What did that cost?" },
];
const fx3PricedRental = {
  ...sonyRental,
  at: 2,
  total: 125,
  subtotal: 140,
  discount: 10,
  creditApplied: 20,
  membershipCreditApplied: 5,
  deliveryFee: 15,
  fulfilment: "delivery",
  deliveryLegs: "one_way",
  lineItems: [{ ...sonyRental.lineItems[0], lineTotal: 140, qty: 1 }],
};
const canonPricedRental = {
  ...canonRental,
  at: 1,
  total: 240,
  subtotal: 240,
  lineItems: [{ ...canonRental.lineItems[0], lineTotal: 240, qty: 1 }],
};
assert.equal(gafferNeedsRenterBookingContext([{ role: "user", content: "How much did I pay for my rental?" }]), true,
  "first-person price questions load the renter's own booking facts");
assert.equal(gafferNeedsRenterBookingContext([{ role: "user", content: "What did my rental cost?" }]), true,
  "natural cost wording is treated as a personal booking question");
assert.equal(gafferNeedsRenterBookingContext(multiRentalPriceFollowUp), true,
  "a multi-turn cost follow-up stays in the authenticated booking context");
const selectedFx3 = selectGafferRenterBooking([fx3PricedRental, canonPricedRental], multiRentalPriceFollowUp);
assert.equal(selectedFx3, fx3PricedRental,
  "the named rental is selected before building price facts for a deictic follow-up");
const selectedFx3Facts = buildGafferRenterBookingFacts([selectedFx3])[0];
assert.match(selectedFx3Facts, /Sony FX3.*listed rental line amount £140\.00/,
  "the actual item's saved rental line amount is provided rather than an inferred price");
assert.match(selectedFx3Facts, /Recorded rental checkout amount after discounts and applied credit: £125\.00/,
  "the renter receives the exact stored checkout amount after credits");
assert.match(selectedFx3Facts, /listed subtotal £140\.00; discounts £10\.00; delivery fee £15\.00; checkout credit applied £20\.00 \(including £5\.00 plan credit\)/,
  "the booking facts explain price components without conflating delivery or plan credit");
assert.match(selectedFx3Facts, /includes the recorded delivery fee when delivery was used, excludes separate security and any separate membership charge, and does not subtract later refunds\. It is not a payment-settlement record/,
  "price facts cannot be misrepresented as a capture, bank posting or refund balance");
assert.doesNotMatch(selectedFx3Facts, /Canon|£240\.00/,
  "a price follow-up never exposes another rental's line amount or checkout total");
assert.match(buildGafferRenterBookingFacts([{ status: "confirmed", lineItems: [{ title: "No price camera" }] }])[0],
  /saved rental checkout amount is not available.*do not estimate/,
  "missing saved prices are described as unavailable rather than fabricated");
const invalidPriceFacts = buildGafferRenterBookingFacts([{
  total: -1,
  subtotal: Number.NaN,
  lineItems: [{ title: "Invalid-price lens", lineTotal: Number.POSITIVE_INFINITY }],
}])[0];
assert.match(invalidPriceFacts, /saved rental checkout amount is not available/);
assert.doesNotMatch(invalidPriceFacts, /£/,
  "invalid monetary fields never leak as a fabricated rental price");
const staleRentalFollowUp = [
  { role: "user", content: "Can you check the status of my Sony FX3 rental?" },
  { role: "assistant", content: "I found the rental." },
  { role: "user", content: "What lens would suit an interview shoot?" },
  { role: "assistant", content: "A fast portrait lens may help." },
  { role: "user", content: "And the return time?" },
];
assert.equal(gafferNeedsRenterBookingContext(staleRentalFollowUp), false,
  "a new gear topic prevents old booking facts from leaking into a later ambiguous follow-up");
assert.equal(selectGafferRenterBooking([sonyRental, canonRental], staleRentalFollowUp), null,
  "a follow-up after a topic switch does not silently select an older rental");
assert.equal(gafferNeedsRenterBookingContext([
  { role: "user", content: "Can you check the status of my Sony FX3 rental?" },
  { role: "assistant", content: "I found the rental." },
  { role: "user", content: "Items for rent?" },
]), false, "a general inventory fragment does not inherit private rental facts");

const studioMembership = buildGafferMembershipContext({
  membershipActive: true,
  membershipTier: "studio",
  membershipStatus: "active",
  membershipPaidThrough: Date.UTC(2026, 11, 1),
  membershipCancelAtPeriodEnd: true,
  loyaltyEligible: true,
  loyaltyLevel: 2,
  loyaltyPercent: 4,
  loyaltyCompleted: 2,
  loyaltyAdminAssigned: false,
});
assert.equal(studioMembership.active, true);
assert.equal(studioMembership.tier.name, "Studio");
assert.equal(studioMembership.tier.monthlyRentalCredit, 128.7);
assert.equal(studioMembership.tier.includesMonthlyLondonDelivery, true);
assert.equal(studioMembership.cancelsAtPeriodEnd, true);
assert.deepEqual(studioMembership.encore, { level: 2, percent: 4, assigned: false, completed: 2 }, "Gaffer receives earned Encore progress separately from benefit access");
assert.deepEqual(buildGafferMembershipContext({ membershipActive: false, loyaltyEligible: true, loyaltyLevel: 3, loyaltyPercent: 10, loyaltyCompleted: 0, loyaltyAdminAssigned: true }).encore,
  { level: 3, percent: 10, assigned: true, completed: 0 }, "Gaffer identifies an immediate admin-assigned benefit without describing it as earned progress");
assert.equal(studioMembership.trialEnds, null, "an absent trial date is not invented");
assert.equal(buildGafferMembershipContext({ membershipActive: false, membershipTier: "studio" }).tier, null,
  "an inactive account never inherits tier entitlements from a stale tier key");
assert.equal(buildGafferMembershipContext({ membershipTier: "studio" }), null,
  "unknown membership activity is not promoted to an entitlement");
assert.equal(buildGafferMembershipContext({ membershipActive: true, membershipTier: "not-a-plan" }).tier, null,
  "an unknown plan cannot create guessed benefits");
assert.equal(buildGafferMembershipContext({ membershipActive: false, loyaltyEligible: false, loyaltyLevel: 0, loyaltyPercent: 0 }).encore, null,
  "an ineligible first-time account has no Encore entitlement");
assert.equal(buildGafferMembershipContext({ membershipActive: false, loyaltyEligible: true, loyaltyLevel: 2, loyaltyPercent: 10 }).encore, null,
  "a mismatched Encore percentage is not presented as a real entitlement");

const oneWayDeliveryFacts = buildGafferRenterBookingFacts([{
  status: "confirmed",
  idVerifyStatus: "verified",
  verificationExpiresAt: Date.now() + 86400000,
  fulfilment: "delivery",
  deliveryLegs: "one_way",
  deliveryFee: 25.5,
  address: "PRIVATE DELIVERY ADDRESS",
  lineItems: [{ title: "Sony FX3", start: "2026-11-21", end: "2026-11-22" }],
}]);
assert.match(oneWayDeliveryFacts[0], /Fulfilment: delivery \(one way\); recorded delivery fee £25\.50/);
assert.doesNotMatch(oneWayDeliveryFacts[0], /PRIVATE DELIVERY ADDRESS/,
  "delivery context includes the selected leg and stored fee, never the customer's private address");
const roundTripDeliveryFacts = buildGafferRenterBookingFacts([{
  status: "confirmed",
  fulfilment: "delivery",
  deliveryLegs: "round_trip",
  lineItems: [{ title: "Sony FX3", start: "2026-11-21", end: "2026-11-22" }],
}]);
assert.match(roundTripDeliveryFacts[0], /Fulfilment: delivery \(delivery and collection\)/,
  "an explicitly recorded round trip is described accurately");
for (const deliveryLegs of [undefined, "unknown"]) {
  const unknownDeliveryFacts = buildGafferRenterBookingFacts([{
    status: "confirmed",
    fulfilment: "delivery",
    deliveryLegs,
    lineItems: [{ title: "Sony FX3", start: "2026-11-21", end: "2026-11-22" }],
  }]);
  assert.match(unknownDeliveryFacts[0], /Fulfilment: delivery \(leg not recorded\)/,
    "missing or invalid delivery-leg data is not silently described as round trip");
  assert.doesNotMatch(unknownDeliveryFacts[0], /delivery and collection/);
}
assert.equal(gafferNeedsRenterBookingContext([{ role: "user", content: "What delivery did I choose?" }]), true);
assert.equal(gafferNeedsRenterBookingContext([{ role: "user", content: "How much is delivery to my area?" }]), false,
  "general delivery questions do not pull unrelated personal rental facts");

assert.equal(renterFacts.length, 2);
assert.match(renterFacts[0], /awaiting verification and not confirmed/);
assert.match(renterFacts[0], /Sony FX3/);
assert.match(renterFacts[0], /2026-11-07 to 2026-11-08/);
assert.match(renterFacts[0], /pickup 10:00; return 18:00/);
assert.match(renterFacts[0], /Verification state: in progress/);
assert.doesNotMatch(renterFacts.join("\n"), /private-internal-id|PRIVATE HOME ADDRESS|£200\.00/,
  "internal IDs, private addresses, and the separately stored security amount stay out of renter-facing Gaffer context");
assert.match(renterFacts[0], /Recorded rental checkout amount after discounts and applied credit: £900\.00/,
  "the token-scoped renter may receive the saved rental checkout amount needed to answer their own price question");
assert.equal(gafferNeedsRenterBookingContext([{ role: "user", content: "Can you check my booking status?" }]), true);
assert.equal(gafferNeedsRenterBookingContext([{ role: "user", content: "About my rental: Sony FX3 camera. Help me choose extra gear." }]), true);
for (const content of [
  "Am I still eligible for a refund?",
  "Would I qualify for account credit?",
  "Can I get a refund for this booking?",
]) {
  assert.equal(gafferNeedsRenterBookingContext([{ role: "user", content }]), true, `personal refund eligibility should load signed-in booking facts for: ${content}`);
}
for (const content of [
  "When do I need to return the kit?",
  "What time is my camera due back?",
  "Can I keep this until Friday?",
  "Can I keep the camera 3 more days?",
  "Can I hold the lens for two more nights?",
  "Can I keep my rental for one week?",
  "Can I extend this?",
  "What did I rent?",
  "When's pickup?",
  "Where do I collect?",
]) {
  assert.equal(gafferNeedsRenterBookingContext([{ role: "user", content }]), true, `booking context should be supplied for: ${content}`);
}
assert.equal(gafferNeedsRenterBookingContext([{ role: "assistant", content: "Your rental is confirmed." }]), false);
for (const content of [
  "What camera should I use for a night shoot?",
  "Do you rent extension cords?",
  "Can I extend my lens mount?",
  "Can you extend my lens mount by 2 days?",
  "What's the best return for this camera?",
  "What is the cancellation and refund policy?",
  "Would a renter qualify for a refund?",
]) {
  assert.equal(gafferNeedsRenterBookingContext([{ role: "user", content }]), false, `catalogue/general questions must not pull personal booking context: ${content}`);
}

const numericDates = buildGafferRenterBookingFacts([{
  status: "confirmed",
  idVerifyStatus: "verified",
  verificationExpiresAt: Date.now() + 86400000,
  paidConfirmedAt: Date.now(),
  pickupTime: "10:00",
  returnTime: "17:00",
  lineItems: [
    { title: "Sony FX3", qty: 1, start: Date.UTC(2026, 10, 21), end: Date.UTC(2026, 10, 22), returnTime: "16:00" },
    { title: "Sony 24-70mm", qty: 1, start: Date.UTC(2026, 10, 21), end: Date.UTC(2026, 10, 22), returnTime: "17:00" },
  ],
}]);
assert.match(numericDates[0], /status confirmed/);
assert.match(numericDates[0], /2026-11-21 to 2026-11-22/, "the account API returns epoch-millisecond rental dates");
assert.match(numericDates[0], /Sony FX3 \(2026-11-21 to 2026-11-22; due back 16:00\)/);
assert.match(numericDates[0], /Sony 24-70mm \(2026-11-21 to 2026-11-22; due back 17:00\)/);
assert.match(numericDates[0], /Verification state: passed and current/);

const expiredVerification = buildGafferRenterBookingFacts([{
  status: "confirmed",
  idVerifyStatus: "verified",
  verificationExpiresAt: Date.now() - 1,
  lineItems: [{ title: "Sony FX3", qty: 1, start: Date.UTC(2026, 10, 21), end: Date.UTC(2026, 10, 22) }],
}]);
assert.match(expiredVerification[0], /not ready for collection/);
assert.match(expiredVerification[0], /previously passed but expired; re-verification is required/);
assert.doesNotMatch(expiredVerification[0], /status confirmed/);

const verificationFollowUp = [
  { role: "user", content: "Can you check the verification for my rental?" },
  { role: "assistant", content: "I'll check the saved result." },
  { role: "user", content: "Which document is still waiting?" },
];
assert.equal(gafferNeedsRenterBookingContext(verificationFollowUp), true,
  "a short verification follow-up retains the account-owned rental context from the earlier turn");
assert.equal(gafferNeedsRenterBookingContext([
  { role: "user", content: "Can you check my booking status?" },
  { role: "assistant", content: "I can help with the rental." },
  { role: "user", content: "What time is pickup?" },
]), true, "a specific pickup-time follow-up retains the earlier booking context");
const delayedBookingFollowUp = [
  { role: "user", content: "Can you check my booking status?" },
  { role: "assistant", content: "Your Sony FX3 rental is confirmed." },
  { role: "user", content: "Thanks, that helps." },
  { role: "assistant", content: "Glad to help." },
  { role: "user", content: "Makes sense." },
  { role: "assistant", content: "Anything else for your shoot?" },
  { role: "user", content: "One more thing." },
  { role: "assistant", content: "Sure." },
  { role: "user", content: "What time was that?" },
  { role: "assistant", content: "I can check that for you." },
  { role: "user", content: "And what time was that again?" },
];
assert.equal(gafferNeedsRenterBookingContext(delayedBookingFollowUp), true,
  "a deictic follow-up within the 12-message Gaffer context window retains the earlier account-owned booking facts");
assert.equal(gafferNeedsRenterBookingContext([
  { role: "assistant", content: "Your Sony FX3 rental is confirmed." },
  { role: "user", content: "What time was that?" },
]), false, "an ambiguous follow-up without an earlier renter booking question does not load personal booking facts");
assert.equal(gafferNeedsRenterBookingContext([
  ...delayedBookingFollowUp.slice(0, -1),
  { role: "user", content: "What camera should I use for a night shoot?" },
]), false, "an unrelated general gear question does not inherit a stale booking context");
const directGearTopicSwitch = [
  { role: "user", content: "Can you check my Sony FX3 booking status?" },
  { role: "assistant", content: "Your Sony FX3 rental is confirmed." },
  { role: "user", content: "What lens works best for a portrait interview?" },
];
assert.equal(gafferNeedsRenterBookingContext(directGearTopicSwitch), false,
  "a direct gear question after booking turns does not inherit personal booking facts");
assert.equal(gafferNeedsRenterBookingContext([
  ...directGearTopicSwitch,
  { role: "assistant", content: "Your booking includes a Sony FX3." },
]), false, "assistant-authored booking text cannot re-enable context after the renter switches topics");
assert.equal(gafferNeedsRenterBookingContext([
  { role: "user", content: "What lens works best for a portrait interview?" },
  { role: "assistant", content: "Your rental is confirmed." },
]), false, "assistant-authored booking claims do not create renter booking intent");
assert.equal(gafferNeedsRenterBookingContext([
  { role: "user", content: "Can you check my booking status?" },
  { role: "assistant", content: "Your booking is confirmed." },
]), true, "assistant replies do not erase the renter's latest booking request");
const partialDiditApproval = {
  status: "confirmed",
  idVerifyStatus: "verified",
  idVerificationSource: "didit",
  verificationExpiresAt: Date.now() + 86400000,
  verificationChecks: { identity: "approved", selfie: "approved", address: "waiting" },
  lineItems: [{ title: "Sony FX3", qty: 1, start: Date.UTC(2026, 10, 21), end: Date.UTC(2026, 10, 22) }],
};
const partialDiditFacts = buildGafferRenterBookingFacts([partialDiditApproval]);
assert.match(partialDiditFacts[0], /not ready for collection/,
  "an aggregate approved flag cannot clear a Didit rental while any required check is pending");
assert.match(partialDiditFacts[0], /Didit document checks: Photo ID: passed; Selfie and face match: passed; Proof of address: waiting for documents/,
  "the multi-turn account answer receives the precise pending document from token-scoped booking facts");
assert.doesNotMatch(partialDiditFacts[0], /Verification state: passed and current/);
assert.match(gafferBookingStatus(partialDiditApproval), /required Didit document checks are not all approved/,
  "rental-chat status matches the same handover check invariant");
assert.equal(gafferBookingStatus({ ...partialDiditApproval, idVerificationSource: "manual" }), "confirmed",
  "a recorded manual approval is not blocked by stale provider-check fields");
const confirmedRentalPastReuseExpiry = {
  status: "confirmed",
  idVerifyStatus: "verified",
  idVerificationSource: "didit",
  idVerifiedAt: Date.now() - 91 * 86400000,
  verificationExpiresAt: Date.now() - 86400000,
  verificationChecks: { identity: "approved", selfie: "approved", address: "approved" },
};
assert.equal(gafferBookingStatus(confirmedRentalPastReuseExpiry), "confirmed",
  "Gaffer must not claim an approved current rental needs renewal when only the account's reuse window has ended");

const currentVerificationFromApprovalDate = buildGafferRenterBookingFacts([{
  status: "confirmed",
  idVerifyStatus: "verified",
  idVerificationSource: "didit",
  verificationProvider: "didit",
  verificationChecks: { identity: "approved", selfie: "approved", address: "approved" },
  idVerifiedAt: Date.now() - 10 * 86400000,
  paidConfirmedAt: Date.now(),
  handoverDetails: { pickupAddress: "Trafalgar Square", returnAddress: "Trafalgar Square", phone: "+44 7000 000000" },
  lineItems: [{ title: "Verified camera", start: "2030-01-01", end: "2030-01-02" }],
}]);
assert.match(currentVerificationFromApprovalDate[0], /Verification state: passed and current/,
  "Gaffer recognizes the same canonical 90-day window used for the verification badge when a stored expiry is absent");
assert.match(currentVerificationFromApprovalDate[0], /Approved handover details/,
  "current approval date can authorize sharing handover details after the normal payment and booking gates");
const expiredVerificationFromApprovalDate = buildGafferRenterBookingFacts([{
  status: "active",
  idVerifyStatus: "verified",
  idVerificationSource: "didit",
  verificationProvider: "didit",
  verificationChecks: { identity: "approved", selfie: "approved", address: "approved" },
  idVerifiedAt: Date.now() - 91 * 86400000,
  verificationExpiresAt: Date.now() + 10 * 86400000,
  paidConfirmedAt: Date.now(),
  handoverDetails: { pickupAddress: "Trafalgar Square", returnAddress: "Trafalgar Square", phone: "+44 7000 000000" },
  lineItems: [{ title: "Renewal camera", start: "2030-01-01", end: "2030-01-02" }],
}]);
assert.match(expiredVerificationFromApprovalDate[0], /passed for this rental; re-verification is required for future rentals/,
  "the expired account reuse badge does not invalidate an already-approved rental");
assert.match(expiredVerificationFromApprovalDate[0], /Approved handover details: pickup Trafalgar Square/,
  "an active rental retains only the handover details already authorized by the shared booking gate");
assert.match(expiredVerificationFromApprovalDate[0], /contact Leo \+44 7000 000000/);
assert.doesNotMatch(expiredVerificationFromApprovalDate[0], /not ready for collection/);
const expiredPassNewRental = buildGafferRenterBookingFacts([{
  status: "pending_verification",
  idVerifyStatus: "verified",
  idVerificationSource: "didit",
  verificationProvider: "didit",
  verificationChecks: { identity: "approved", selfie: "approved", address: "approved" },
  idVerifiedAt: Date.now() - 91 * 86400000,
  verificationExpiresAt: Date.now() - 1,
  paidConfirmedAt: Date.now(),
  lineItems: [{ title: "New rental camera", start: "2030-01-01", end: "2030-01-02" }],
}]);
assert.match(expiredPassNewRental[0], /previously passed but expired; re-verification is required/,
  "an expired reusable pass does not approve a new pending rental");
assert.doesNotMatch(expiredPassNewRental[0], /Approved handover details|contact Leo \+44/,
  "new rentals without a shared-gate handover projection keep exact details hidden");
const missingVerificationExpiry = buildGafferRenterBookingFacts([{
  status: "confirmed",
  idVerifyStatus: "verified",
  documentExpiresAt: Date.now() + 86400000,
  lineItems: [{ title: "Test lens", start: "2030-01-01", end: "2030-01-02" }],
}]);
assert.match(missingVerificationExpiry[0], /previously passed, but current validity could not be confirmed/);
assert.match(missingVerificationExpiry[0], /not ready for collection/);

const unverifiedConfirmation = buildGafferRenterBookingFacts([{
  status: "confirmed",
  idVerifyStatus: "required",
  lineItems: [{ title: "Sony FX3", qty: 1, start: Date.UTC(2026, 10, 21), end: Date.UTC(2026, 10, 22) }],
}]);
assert.match(unverifiedConfirmation[0], /not ready for collection/);
assert.doesNotMatch(unverifiedConfirmation[0], /status confirmed/);

assert.equal(buildGafferRenterBookingFacts(null).length, 0);

const gafferEngineSource = fs.readFileSync(path.join(__dirname, "../src/lib/gaffer.ts"), "utf8");
assert.match(gafferEngineSource, /if \(body\?\.token\)[\s\S]*?const bk: any = await c\.query\(api\.accounts\.myBookings/, "only a verified account token may load personal booking facts");
assert.match(gafferEngineSource, /selectGafferRenterBooking\(ctx\.renterBookings, history\)/, "site Gaffer keeps account-owned rental context on a uniquely selected multi-turn booking");
assert.match(gafferEngineSource, /const cancellationBooking = selectGafferRenterBooking\(ctx\.renterBookings, history\)/,
  "cancellation guidance uses the same safe multi-turn booking selection as ordinary renter answers");
assert.match(gafferEngineSource, /cancellationEligibilityRecovery\(lastUser, cancellationBooking/, "cancellation guidance uses only the selected rental's signed facts");
assert.match(gafferEngineSource, /ctx\.renterBookings = bookingContext/, "the selected booking context comes only from the token-scoped account query");
assert.match(gafferEngineSource, /cancellationEligibilityRecovery\(lastUser, cancellationBooking[\s\S]{0,2600}ctx\.renterBookings\.length\);/, "multi-rental eligibility checks ask which rental instead of selecting one implicitly");
assert.match(gafferEngineSource, /multiple rentals and this question does not identify one uniquely[\s\S]{0,320}ask for its item name or pickup date/, "other multi-rental questions are clarified before Gaffer answers about one rental");
assert.match(gafferEngineSource, /ctx\.membershipContext = buildGafferMembershipContext\(me\)/, "membership facts come from the token-scoped account query");
assert.match(gafferEngineSource, /PERSONAL RENTAL PRICES:[^\n]*never sum them[^\n]*not proof of Stripe settlement/,
  "the live narration path distinguishes saved booking amounts from item totals and payment settlement");
assert.match(gafferEngineSource, /No signed-in membership snapshot is available/, "anonymous Gaffer conversations cannot infer membership entitlements");
assert.match(gafferEngineSource, /ctx\.memberPct > 0 \? ` Apply their \$\{ctx\.memberPct\}% gear discount only where the quote cards show it\./, "membership discounts are mentioned only when a quote card actually computes a positive discount");
assert.doesNotMatch(gafferEngineSource, /Apply their 0% gear discount/, "Gaffer never describes a zero-percent membership discount as an entitlement");
assert.match(gafferEngineSource, /Never call a rental confirmed or ready for collection if its facts say verification is required, in progress, under review, expired, or not ready for collection/);
for (const route of [
  "../src/app/api/bot/route.ts",
  "../src/app/api/email/inbound/route.ts",
  "../src/app/api/voice/route.ts",
]) {
  const routeSource = fs.readFileSync(path.join(__dirname, route), "utf8");
  assert.match(routeSource, /import \{[^}]*\bhandleChat\b[^}]*\} from ["']@\/lib\/gaffer["']/);
}
const botRouteSource = fs.readFileSync(path.join(__dirname, "../src/app/api/bot/route.ts"), "utf8");
assert.match(botRouteSource, /const out = await handleChat\(body\)/, "contact and signed-in site chat use the shared engine");
assert.doesNotMatch(botRouteSource, /handleChat\(body,/, "public site chat cannot supply privileged email rental context");
assert.match(gafferEngineSource, /async function loadContext\(body: any, trustedEmailContext\?/);
assert.match(gafferEngineSource, /body\?\.channel === "email" && trustedEmailContext\?\.booking/);
const accountSource = fs.readFileSync(path.join(__dirname, "../convex/accounts.ts"), "utf8");
assert.match(accountSource, /const cancellation = gafferCancellationFacts\(b, cancellationAssessedAt\)/, "account Gaffer facts use the signed cancellation calculation");
assert.match(accountSource, /deliveryLegs: b\.deliveryLegs \?\? null/, "the account-owned booking projection exposes the selected delivery leg to Gaffer");
const rentalChatSourceFile = fs.readFileSync(path.join(__dirname, "../convex/chat.ts"), "utf8");
assert.match(rentalChatSourceFile, /const cancellationFacts=gafferCancellationFacts\(pick,checkedAt\)/, "rental-chat Gaffer uses the same signed cancellation calculation");
assert.match(rentalChatSourceFile, /cancellation:\{fullRefundDays:cancellationDaysForBooking\(pick\),\.\.\.cancellationFacts/, "rental-chat Gaffer still receives its full cancellation record");
assert.match(rentalChatSourceFile, /membershipIsActive = membershipActiveNow\(acct\)/, "rental-chat membership entitlement uses the canonical account status calculation");
assert.match(rentalChatSourceFile, /tier: membershipIsActive && memberTier \?/, "inactive rental-chat accounts receive no stale tier perks");
assert.match(rentalChatSourceFile, /recordedFee: typeof pick\.deliveryFee === "number"/, "rental-chat delivery facts use the server-recorded fee only");
assert.match(rentalChatSourceFile, /const listedRentalLineAmount = safeMoney\(li\.lineTotal\)/, "rental-chat Gaffer receives each item's saved line amount from the owned booking");
assert.match(rentalChatSourceFile, /checkoutTotalAfterCredit:safeMoney\(pick\.total\)/, "rental-chat Gaffer receives the saved checkout total independently of security fields");
assert.match(rentalChatSourceFile, /deliveryLegs:\s*b\.fulfilment==="delivery"\?\(b\.deliveryLegs==="one_way"\?"one_way":b\.deliveryLegs==="round_trip"\?"round_trip":null\):null/, "unfocused account-rental summaries preserve only explicitly recorded delivery legs");
assert.match(rentalChatSourceFile, /legs: pick\.deliveryLegs === "one_way" \? "one_way" : pick\.deliveryLegs === "round_trip" \? "round_trip" : null/, "focused rental context does not guess an unknown delivery leg");
const gafferContextProjection = rentalChatSourceFile.slice(
  rentalChatSourceFile.indexOf("export const _gafferContext"),
  rentalChatSourceFile.indexOf("export const _gafferVerificationAccess"),
);
assert.doesNotMatch(gafferContextProjection, /address:\s*pick\.address|deliveryAddress|pickupAddress:\s*pick\./,
  "the private delivery address is excluded from Gaffer's context projection");
const convexGafferSource = fs.readFileSync(path.join(__dirname, "../convex/gaffer.ts"), "utf8");
assert.match(convexGafferSource, /delivery leg not recorded/, "Gaffer is told when the saved delivery leg is unknown");
assert.match(convexGafferSource, /ACCOUNT MEMBERSHIP FACTS:.*Only an active tier grants its listed benefits/, "rental-chat Gaffer distinguishes active membership entitlements");
assert.match(convexGafferSource, /PERSONAL RENTAL PRICES:.*never add them to recreate the amount.*not proof of payment settlement/, "rental-chat Gaffer uses the stored booking total rather than reconstructing or inventing a price");
assert.match(convexGafferSource, /items:b\.items,rentalPrice:b\.rentalPrice,payment:b\.payment/, "the actual rental-chat narration receives its authoritative price breakdown");
assert.match(convexGafferSource, /No usage state is provided for a monthly delivery benefit/, "rental-chat Gaffer cannot assume a monthly delivery benefit remains unused");
assert.match(convexGafferSource, /recorded delivery fee £\$\{b\.delivery\.recordedFee\.toFixed\(2\)\}/, "rental-chat Gaffer uses only the fee recorded on that rental");
assert.match(convexGafferSource, /Never imply an unconfirmed delivery quote is priced or paid/, "a recorded fee never becomes an unsupported payment claim");
assert.match(convexGafferSource, /generated offer tile states its exact value, expiry and security treatment[\s\S]*?Do not infer that security funds are included or a card hold is released/, "Gaffer defers credit-offer security treatment to the policy-specific consent tile");
const emailRouteSource = fs.readFileSync(path.join(__dirname, "../src/app/api/email/inbound/route.ts"), "utf8");
assert.match(emailRouteSource, /api\.emailInbox\.resolveReplyKey/);
assert.match(emailRouteSource, /replyCapabilityKey: candidateReplyKey/);
assert.match(emailRouteSource, /replyThreadId && replyCapabilityKey/);
assert.match(emailRouteSource, /claim\.rentalContext \?\? null/);
assert.match(emailRouteSource, /handleChat\([\s\S]{0,160}claim\.rentalContext \?\? null/);
const voiceRouteSource = fs.readFileSync(path.join(__dirname, "../src/app/api/voice/route.ts"), "utf8");
assert.match(voiceRouteSource, /handleChat\(\{[\s\S]{0,600}channel: "email",[\s\S]{0,100}emailSubject: "Follow-up to your phone enquiry"/);
assert.doesNotMatch(voiceRouteSource, /api\.accounts\.myBookings/, "unauthenticated voice sessions never look up or disclose personal rentals");

const contactSource = fs.readFileSync(path.join(__dirname, "../src/components/gaffer/OpenGafferChat.tsx"), "utf8");
const chatSource = fs.readFileSync(path.join(__dirname, "../src/components/BotBubble.tsx"), "utf8");
assert.match(contactSource, /label: "Build a kit"/);
assert.match(contactSource, /label: "Check dates"/);
assert.match(contactSource, /label: "Get a quote"/);
assert.match(contactSource, /label: "My booking"/);
assert.match(contactSource, /openGaffer\(action\.prompt\)/);
assert.match(contactSource, /detail: \{ prompt \}/);
assert.match(chatSource, /detail\?\.prompt/);
assert.match(chatSource, /setText\(\(current\) => current\.trim\(\) \? current : prompt\.trim\(\)\)/);
assert.match(chatSource, /rentalBookingId: rentalBookingId \?\? undefined/);
const rentalChatSource = fs.readFileSync(path.join(__dirname, "../src/components/rentals/RentalConversation.tsx"), "utf8");
assert.match(rentalChatSource, /detail: \{ prompt, bookingId \}/);

console.log("PASS Gaffer booking facts stay account-scoped and exclude payment/address/internal IDs; contact quick starts open editable, wired chat prompts.");
