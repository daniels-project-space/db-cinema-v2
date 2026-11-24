const assert = require("node:assert/strict");
const { db, load, put, setMock } = require("./lib/rentalTestHarness.cjs");

const account = put("accounts", { email: "recovery-pricing@example.test" });
setMock("./lib/kitPlanning", {
  requireAccount: async () => account,
  kitDetails: async () => [],
});
setMock("./lib/checkoutRecovery", {
  basketKey: () => "fixture",
  recoveryBookingState: () => "recoverable",
  recoveryBookingsForAccount: async () => [],
});
setMock("./lib/catalogImages", { listingImages: () => [] });

const listing = put("listings", {
  active: true,
  title: "Sony FX3 camera",
  slug: "sony-fx3-camera",
  pricing: { daily: 100 },
  depositAmount: 50,
});
const start = Date.parse("2027-06-10T00:00:00.000Z");
const end = start + 86400000;
const lines = [
  { listingId: listing._id, qty: 1, start, end, pickupTime: "09:00", returnTime: "08:59" },
  { listingId: listing._id, qty: 1, start, end, pickupTime: "09:00", returnTime: "09:01" },
  { listingId: listing._id, qty: 1, start, end },
];
const recovery = put("checkout_recoveries", {
  accountId: account._id,
  lines,
  state: "waiting",
  expiresAt: Date.now() + 86400000,
  emailFollowupConsentAt: Date.now(),
  followupStage: "day_one",
});

const { resume } = load("convex/checkoutRecovery.ts");
const ctx = { db };

(async () => {
  const result = await resume.handler(ctx, { token: "account-token", id: recovery._id });
  assert.deepEqual(result.cartLines.map(line => line.days), [1, 2, 2],
    "restored timed checkout uses elapsed 24-hour rental days; date-only legacy lines keep inclusive days");
  assert.deepEqual(result.cartLines.map(line => line.total), [100, 200, 200],
    "saved checkout price matches the authoritative duration tier for its exact times");
  assert.equal(result.cartLines[0].pickupTime, "09:00");
  assert.equal(result.cartLines[0].returnTime, "08:59");
  console.log("Checkout recovery pricing: exact timed duration matches authoritative checkout; date-only legacy pricing is preserved.");
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
