const assert = require("node:assert/strict");
const { load, db, put } = require("./lib/rentalTestHarness.cjs");
const { rentalPaymentSources } = load("convex/lib/rentalPaymentSources.ts");

(async () => {
  const booking = put("bookings", { stripePaymentIntentId: "pi_original", depositAmount: 0 });
  put("rental_item_swaps", { bookingId: booking._id, status: "applied", quote: { deltaPence: 1200 }, paymentIntentId: "pi_swap" });
  put("rental_item_swaps", { bookingId: booking._id, status: "refunded", quote: { deltaPence: 900 }, paymentIntentId: "pi_returned" });
  put("rental_item_swaps", { bookingId: booking._id, status: "awaiting_payment", quote: { deltaPence: 500 }, paymentIntentId: "pi_pending" });
  put("rental_item_swaps", { bookingId: booking._id, status: "applied", quote: { deltaPence: -300 } });
  const sources = await rentalPaymentSources({ db }, booking);
  assert.deepEqual(sources.map(source => source.paymentIntentId), ["pi_original", "pi_swap"]);
  assert.equal(sources[1].maxPaidPence, 1200);
  const missing = put("rental_item_swaps", { bookingId: booking._id, status: "applied", quote: { deltaPence: 100 } });
  await assert.rejects(rentalPaymentSources({ db }, booking), /payment needs manual review/);
  missing.paymentIntentId = "pi_original";
  await assert.rejects(rentalPaymentSources({ db }, booking), /Duplicate rental payment source/);
  console.log("PASS rental payment sources: applied swap receipts included; pending, refunded, missing and duplicate receipts handled safely.");
})().catch(error => { console.error(error); process.exitCode = 1; });
