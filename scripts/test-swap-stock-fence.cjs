const assert = require("node:assert/strict");
const { load, db, put } = require("./lib/rentalTestHarness.cjs");

process.env.ADMIN_TOKEN = "fixture-admin";
const { assertSwapStockReconciled } = load("convex/lib/swapStockFence.ts");
const operations = load("convex/rentalOperations.ts");
const bookings = load("convex/bookings.ts");
const additions = load("convex/rentalAdditionState.ts");
const extensions = load("convex/rentalExtensions.ts");
const ctx = { db, scheduler: { runAfter: async () => {} } };
const booking = put("bookings", { status: "confirmed", lineItems: [], stripePaymentIntentId: "pi_fixture", total: 100, depositAmount: 0 });
const unrelated = put("bookings", { status: "confirmed", lineItems: [] });
const receipt = put("swap_stock_applied_receipts", { bookingId: booking._id, deliveryState: "pending", stockRisk: false });
const priorRefund = put("rental_refunds", { bookingId: booking._id, requestId: "fixture-refund-prior", amountPence: 100, reason: "Fixture refund", status: "pending" });
const addition = put("rental_additions", { bookingId: booking._id, status: "paid" });
const extension = put("booking_change_requests", { bookingId: booking._id, type: "extend", status: "awaiting_payment", stripePaymentLinkId: "cs_extension", priceDelta: 10 });

(async () => {
  const check = () => assertSwapStockReconciled(ctx, booking._id);
  await assertSwapStockReconciled(ctx, unrelated._id);
  for (const [deliveryState, stockRisk] of [["pending", false], [undefined, false], ["acknowledged", true]]) {
    receipt.deliveryState = deliveryState;
    receipt.stockRisk = stockRisk;
    await assert.rejects(check(), /stock reconciliation/);
    const preview = await operations.previewReschedule.handler(ctx, { token: process.env.ADMIN_TOKEN, bookingId: booking._id, start: Date.now(), reason: "Fixture" });
    assert.equal(preview.ok, false);
    assert.match(preview.reason, /stock reconciliation/);
    await assert.rejects(bookings.markReturnedStatus.handler(ctx, { bookingId: booking._id }), /stock reconciliation/);
    await assert.rejects(bookings._finalizeCancellation.handler(ctx, { bookingId: booking._id, mode: "none", refundAmount: 0, creditAmount: 0, currency: "GBP" }), /stock reconciliation/);
    await assert.rejects(operations.prepareRefund.handler(ctx, { token: process.env.ADMIN_TOKEN, bookingId: booking._id, requestId: "fixture-refund-0001", amountPence: 100, reason: "Fixture refund" }), /stock reconciliation/);
    assert.equal((await operations.prepareRefund.handler(ctx, { token: process.env.ADMIN_TOKEN, bookingId: booking._id, requestId: priorRefund.requestId, amountPence: 100, reason: priorRefund.reason }))._id, priorRefund._id, "a pre-existing refund remains available for recovery");
    await assert.rejects(bookings.attachAddon.handler(ctx, { bookingId: booking._id, listingId: "missing-listing", title: "Fixture", start: 0, end: 86400000, total: 10, sessionId: "cs_fixture", paymentIntentId: "pi_fixture" }), /stock reconciliation/);
    booking.activeItemSwapId = "swap_fixture";
    await assert.rejects(bookings.attachAddon.handler(ctx, { bookingId: booking._id, listingId: "missing-listing", title: "Fixture", start: 0, end: 86400000, total: 10, sessionId: "cs_fixture", paymentIntentId: "pi_fixture" }), /stock reconciliation/);
    booking.activeItemSwapId = undefined;
    await assert.rejects(additions.apply.handler(ctx, { id: addition._id }), /stock reconciliation/);
    await assert.rejects(extensions.applyPaid.handler(ctx, { requestId: extension._id, sessionId: "cs_extension", paymentIntentId: "pi_extension", amountPence: 1000 }), /stock reconciliation/);
    assert.equal(booking.status, "confirmed");
  }
  receipt.stockRisk = false;
  await check();
  booking.activeItemSwapId = "swap_fixture";
  await assert.rejects(bookings._finalizeCancellation.handler(ctx, { bookingId: booking._id, mode: "none", refundAmount: 0, creditAmount: 0, currency: "GBP" }), /equipment change and stock reconciliation/);
  booking.activeItemSwapId = undefined;
  booking.status = "cancelled";
  receipt.deliveryState = "pending";
  assert.deepEqual(await bookings._finalizeCancellation.handler(ctx, { bookingId: booking._id, mode: "none", refundAmount: 0, creditAmount: 0, currency: "GBP" }), { ok: true, already: true });
  booking.status = "confirmed";
  receipt.deliveryState = "acknowledged";
  assert.deepEqual(await bookings.attachAddon.handler(ctx, { bookingId: booking._id, listingId: "missing-listing", title: "Fixture", start: 0, end: 86400000, total: 10, sessionId: "cs_fixture", paymentIntentId: "pi_fixture" }), { closed: true });
  console.log("PASS unresolved swap stock fences rescheduling and return without blocking unrelated rentals.");
})().catch(error => { console.error(error); process.exitCode = 1; });
