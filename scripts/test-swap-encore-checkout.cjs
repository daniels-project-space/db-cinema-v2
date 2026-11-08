const assert = require("node:assert/strict");
const { load, db, put } = require("./lib/rentalTestHarness.cjs");
const bookings = load("convex/bookings.ts");
const ctx = { db, scheduler: { runAfter: async () => {} } };
const account = put("accounts", { email: "encore-fixture@example.invalid", adminEncoreLevel: 3 });
const listing = put("listings", { title: "Camera", active: true, depositAmount: 100, components: [] });
const start = Date.UTC(2030, 1, 1);
const args = {
  pricingVersion: "single-benefit-v1", benefitKind: "loyalty", customerEmail: account.email, accountId: account._id, creditAccountId: account._id,
  fulfilment: "pickup", deliveryFee: 0, lineItems: [{ listingId: listing._id, title: listing.title, start, end: start, qty: 1, lineTotal: 100 }],
  subtotal: 100, discount: 10, loyaltySaving: 10, total: 90, expectedTotalDue: 90, depositAmount: 0, currency: "GBP",
};

(async () => {
  const created = await bookings.createPending.handler(ctx, args);
  const booking = await db.get(created.bookingId);
  assert.deepEqual(booking.swapBenefitRule, { version: "encore-percent-v1", percent: 10 });
  assert.equal(booking.checkoutLineFunding[0].discount, 10);
  account.adminEncoreLevel = 1;
  assert.deepEqual(booking.swapBenefitRule, { version: "encore-percent-v1", percent: 10 }, "Later tier changes do not rewrite the checkout rule");
  await assert.rejects(bookings.createPending.handler(ctx, { ...args, customerEmail: account.email, loyaltySaving: 9, discount: 9, total: 91, expectedTotalDue: 91 }), /Encore rental saving changed/);
  console.log("PASS swap Encore checkout: validated percentage frozen on the booking and unaffected by later tier changes");
})().catch(error => { console.error(error); process.exitCode = 1; });
