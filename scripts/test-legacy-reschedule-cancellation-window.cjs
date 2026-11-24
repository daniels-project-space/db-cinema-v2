const assert = require("node:assert/strict");
const { load, db, put, setMock } = require("./lib/rentalTestHarness.cjs");

setMock("./lib/swapStockFence", { assertSwapStockReconciled: async () => {} });
setMock("./lib/rentalInventory", { assertRentalInventory: async () => {} });
setMock("./lib/rentalAllocation", { assertRentalAllocation: async () => "legacy" });
setMock("./pickupSecurity", { schedulePickupHold: async () => {} });
setMock("./lib/rentalExposure", { assertRenterExposure: async () => {} });
setMock("./lib/rentalChat", { postRentalMessage: async () => {} });
setMock("./lib/rmv2SyncQueue", { queueRmv2Sync: async () => {} });

const changes = load("convex/changes.ts");
const { bookingCancelKind } = load("src/lib/cancellationPolicy.ts");
const day = 86400000;
const originalStart = Date.UTC(2030, 0, 4);
const originalEnd = originalStart + day;
const requestedStart = Date.UTC(2030, 0, 20);
const requestedEnd = requestedStart + day;
const account = put("accounts", { email: "legacy-reschedule@example.invalid" });
const unit = put("inventory_units", { name: "Camera unit", quantityOwned: 1 });
const listing = put("listings", { title: "Camera", depositAmount: 100, components: [{ inventoryUnitId: unit._id, qty: 1 }] });
const booking = put("bookings", {
  accountId: account._id,
  guestEmail: account.email,
  status: "confirmed",
  pickupTime: "10:00",
  cancellationPolicyStart: originalStart,
  agreementDocs: [{ kind: "cancellation", version: "2026-11-v26" }],
  lineItems: [{ listingId: listing._id, title: listing.title, start: originalStart, end: originalEnd, qty: 1, lineTotal: 100 }],
});
const request = put("booking_change_requests", {
  bookingId: booking._id,
  accountId: account._id,
  type: "reschedule",
  status: "pending",
  requestedStart,
  requestedEnd,
});
const ctx = { db, scheduler: { runAfter: async () => {} } };

(async () => {
  const policyCheckAt = Date.UTC(2030, 0, 1);
  assert.equal(bookingCancelKind(booking, policyCheckAt), "store_credit", "Before approval, cancellation timing follows the originally agreed rental date");

  const result = await changes._applyReschedule.handler(ctx, { requestId: request._id });

  assert.deepEqual(result, { ok: true });
  assert.equal(booking.lineItems[0].start, requestedStart, "The manually approved legacy request moves the rental dates");
  assert.equal(booking.cancellationPolicyStart, requestedStart, "The legacy apply path moves the cancellation-policy anchor with the approved rental");
  assert.equal(bookingCancelKind(booking, policyCheckAt), "full_refund", "Cancellation eligibility now follows the renter's approved rescheduled start");
  assert.equal(request.status, "applied");
  console.log("PASS legacy Telegram reschedule: approved date changes also move the cancellation window anchor.");
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
