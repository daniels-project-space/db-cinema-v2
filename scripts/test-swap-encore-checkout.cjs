const assert = require("node:assert/strict");
const { load, db, put } = require("./lib/rentalTestHarness.cjs");
const bookings = load("convex/bookings.ts");
const { loyaltyProgress } = load("convex/lib/loyalty.ts");
const ctx = { db, scheduler: { runAfter: async () => {} } };
const account = put("accounts", { email: "encore-fixture@example.invalid", adminEncoreLevel: 3 });
const listing = put("listings", { title: "Camera", active: true, depositAmount: 100, components: [] });
for (let index = 0; index < 3; index++) {
  const returnedAt = Date.now() - (index + 1) * 86400000;
  const line = { listingId: `prior-${index}`, title: "Camera", qty: 1, start: Date.UTC(2025, 0, 1 + index * 5), end: Date.UTC(2025, 0, 2 + index * 5), lineTotal: 100 };
  const inspection = [{ key: "legacy:0:0", title: "Camera", condition: "good", details: "", openCase: false }];
  put("bookings", { accountId: account._id, guestEmail: account.email, status: "returned", idVerifyStatus: "verified", pickedUpAt: line.start + 9 * 60 * 60 * 1000, lineItems: [line], currency: "GBP",
    total: 100, subtotal: 100, rentalPaidPence: 10000, depositAmount: 0, depositHoldAmount: 0,
    stripeCheckoutSessionId: `cs-prior-${index}`, stripePaymentIntentId: `pi-prior-${index}`,
    paidConfirmedAt: returnedAt - 86400000, checkoutPaidAt: returnedAt - 86400000,
    checkoutPaymentAmountPence: 10000, checkoutExpectedAmountPence: 10000,
    checkoutPaymentCurrency: "GBP", checkoutPaymentStatus: "paid", actualReturnedAt: returnedAt,
    returnDecision: { actualReturnedAt: returnedAt, chargeLate: false, damageKept: 0, depositKept: 0, inspection },
    returnStatement: { actualReturnedAt: returnedAt, inspection, rentalRefunded: 0, securityPaid: 0, securityRefunded: 0,
      holdStatus: "not_applicable", damageTotal: 0, damageFromHold: 0, lateAssessed: 0, lateWaived: 0 } });
}
const start = Date.UTC(2030, 1, 1);
const args = {
  pricingVersion: "single-benefit-v1", benefitKind: "loyalty", customerEmail: account.email, accountId: account._id, creditAccountId: account._id,
  fulfilment: "pickup", deliveryFee: 0, lineItems: [{ listingId: listing._id, title: listing.title, start, end: start, qty: 1, lineTotal: 100 }],
  subtotal: 100, discount: 10, loyaltySaving: 10, total: 90, expectedTotalDue: 90, depositAmount: 0, currency: "GBP",
};

(async () => {
  assert.equal((await loyaltyProgress(ctx, account)).completed, 3, "the fixture has three distinct paid clean returns");
  const created = await bookings.createPending.handler(ctx, args);
  const booking = await db.get(created.bookingId);
  assert.deepEqual(booking.swapBenefitRule, { version: "encore-percent-v1", percent: 10 });
  assert.equal(booking.checkoutLineFunding[0].discount, 10);
  account.adminEncoreLevel = 1;
  assert.deepEqual(booking.swapBenefitRule, { version: "encore-percent-v1", percent: 10 }, "Later tier changes do not rewrite the checkout rule");
  await assert.rejects(bookings.createPending.handler(ctx, { ...args, customerEmail: account.email, loyaltySaving: 9, discount: 9, total: 91, expectedTotalDue: 91 }), /Encore rental saving changed/);
  console.log("PASS swap Encore checkout: validated percentage frozen on the booking and unaffected by later tier changes");
})().catch(error => { console.error(error); process.exitCode = 1; });
