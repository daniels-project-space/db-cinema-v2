const assert = require("node:assert/strict");
const { load, db, put, setMock } = require("./lib/rentalTestHarness.cjs");
const { STOCK_DAY, londonRentalInstant } = load("shared/rentalWindow.ts");

const account = put("accounts", { email: "extension-time@qa.invalid", sessionToken: "extension-time-renter" });
const start = Date.UTC(2031, 0, 1);
const end = start + STOCK_DAY;
const unit = put("inventory_units", { name: "Single camera", quantityOwned: 1 });
const listing = put("listings", {
  active: true,
  title: "Single camera",
  pricing: { daily: 25 },
  components: [{ inventoryUnitId: unit._id, qty: 1 }],
});
const booking = put("bookings", {
  accountId: account._id,
  guestEmail: account.email,
  status: "active",
  paidConfirmedAt: Date.now(),
  verificationProvider: "didit",
  idVerifyStatus: "verified",
  idVerificationSource: "didit",
  idVerifiedAt: Date.now(),
  verificationChecks: { identity: "approved", selfie: "approved", address: "approved" },
  pickupTime: "10:00",
  returnTime: "17:00",
  lineItems: [{ listingId: listing._id, title: listing.title, qty: 1, start, end, pickupTime: "10:00", returnTime: "17:00", lineTotal: 50 }],
});
put("reservations", {
  bookingId: booking._id,
  listingId: listing._id,
  inventoryUnitId: unit._id,
  qty: 1,
  start: londonRentalInstant(start, "10:00"),
  end: londonRentalInstant(end, "17:00"),
  endExclusive: true,
  turnaroundBufferMinutes: 60,
  status: "active",
  source: "site",
});
const extraReturnDay = end + STOCK_DAY;
put("reservations", {
  bookingId: "another-confirmed-rental",
  listingId: listing._id,
  inventoryUnitId: unit._id,
  qty: 1,
  start: londonRentalInstant(extraReturnDay, "18:00"),
  end: londonRentalInstant(extraReturnDay + STOCK_DAY, "10:00"),
  endExclusive: true,
  turnaroundBufferMinutes: 60,
  status: "confirmed",
  source: "site",
});
put("rmv2_sync_state", {
  key: "shared-stock-v1",
  status: "ok",
  lastSyncedAt: Date.now(),
  cursor: JSON.stringify({ version: 2, turnaroundBufferMinutes: 60, checkedAt: Date.now() }),
});

setMock("./lib/rentalChat", {
  accountForToken: async (_ctx, token) => token === account.sessionToken ? account : null,
  ownedBooking: async (_ctx, owner, bookingId) => {
    if (!owner || bookingId !== booking._id) throw Error("not available");
    return booking;
  },
  postRentalMessage: async () => "message-fixture",
  rentalThread: async () => null,
  scheduleGafferAutoResume: async () => {},
});
setMock("./lib/swapStockFence", { assertSwapStockReconciled: async () => {} });
setMock("./lib/rentalAllocation", { assertRentalAllocation: async () => "precise" });
setMock("./lib/rentalExposure", { assertRenterExposure: async () => {} });
setMock("./lib/lateFee", { lateFeeQuote: () => ({ breakdown: [] }) });
setMock("./lib/catalogImages", { listingRentalImages: () => [] });
setMock("./lib/rentalBenefitAccount", { rentalBenefitAccount: async owner => owner });
setMock("./lib/rentalCreditFunding", { availableRentalCreditPence: async () => 0 });
setMock("./lib/marketingInventory", { rentalUnavailable: () => false });

const extensions = load("convex/rentalExtensions.ts");
const context = { db, scheduler: { runAfter: async () => {} } };

(async () => {
  const early = await extensions.quote.handler(context, {
    token: account.sessionToken,
    bookingId: booking._id,
    extraDays: 1,
    lineItemIndexes: [0],
    requestedReturnTime: "17:00",
  });
  assert.equal(early.available, true, "returning before the next confirmed pickup remains available");

  const late = await extensions.quote.handler(context, {
    token: account.sessionToken,
    bookingId: booking._id,
    extraDays: 1,
    lineItemIndexes: [0],
    requestedReturnTime: "19:00",
  });
  assert.equal(late.available, false, "the selected 19:00 return overlaps the next confirmed pickup after the one-hour turnaround buffer");
  assert.match(late.reason, /reserved|unavailable|inventory capacity/i);

  await assert.rejects(extensions.request.handler(context, {
    token: account.sessionToken,
    bookingId: booking._id,
    requestKey: "extension-time-conflict-001",
    extraDays: 1,
    lineItemIndexes: [0],
    expectedAmount: late.priceDelta,
    expectedBase: late.baseLines,
    requestedReturnTime: "19:00",
  }), /reserved|unavailable|inventory capacity/i, "the authoritative renter request boundary rechecks the selected return time");
  assert.equal((await db.query("booking_change_requests").collect()).length, 0, "an unavailable selected time creates no pending request");
  console.log("PASS extension availability uses selected return time at quote and request boundaries.");
})().catch(error => { console.error(error); process.exitCode = 1; });
