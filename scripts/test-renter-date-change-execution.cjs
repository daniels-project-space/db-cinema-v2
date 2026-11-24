const assert = require("node:assert/strict");
const { load, db, put, tables } = require("./lib/rentalTestHarness.cjs");

process.env.ADMIN_TOKEN = "fixture-rental-date-admin";
const operations = load("convex/rentalOperations.ts");
const requests = load("convex/rentalRequests.ts");
const jobs = [];
const ctx = {
  db,
  scheduler: { runAfter: async (...args) => jobs.push(args), runAt: async (...args) => jobs.push(args) },
  runQuery: async (reference, args) => {
    if (reference === "rentalOperations.renterReschedulePreview") return operations.renterReschedulePreview.handler(ctx, args);
    if (reference === "rentalOperations.previewReschedule") return operations.previewReschedule.handler(ctx, args);
    throw Error(`Unexpected query ${reference}`);
  },
};

const account = put("accounts", { email: "date-change-renter@example.invalid" });
const otherAccount = put("accounts", { email: "other-renter@example.invalid" });
put("sessions", { token: "renter-date-session", accountId: account._id, expiresAt: Date.now() + 600000 });
const unit = put("inventory_units", { name: "Sony camera", quantityOwned: 1 });
const listing = put("listings", {
  title: "Sony FX3 camera",
  active: true,
  depositAmount: 3000,
  components: [{ inventoryUnitId: unit._id, qty: 1 }],
  unavailableDates: [],
});
const day = 86400000;
const originalStart = Date.UTC(2030, 0, 3);
const requestedStart = Date.UTC(2030, 0, 7);
const booking = put("bookings", {
  accountId: account._id,
  guestEmail: account.email,
  status: "confirmed",
  total: 75,
  paidConfirmedAt: Date.now() - 1000,
  verificationProvider: "didit",
  idVerifyStatus: "verified",
  idVerificationSource: "didit",
  idVerifiedAt: Date.now() - 1000,
  verificationExpiresAt: Date.now() + 89 * day,
  verificationChecks: { identity: "approved", selfie: "approved", address: "approved" },
  lineItems: [{ listingId: listing._id, title: listing.title, qty: 1, start: originalStart, end: originalStart + day, lineTotal: 75 }],
});
const originalReservation = put("reservations", {
  inventoryUnitId: unit._id,
  listingId: listing._id,
  bookingId: booking._id,
  start: originalStart,
  end: originalStart + day,
  qty: 1,
  source: "site",
  status: "confirmed",
});

(async () => {
  const preview = await operations.renterReschedulePreview.handler(ctx, {
    token: "renter-date-session",
    bookingId: booking._id,
    start: requestedStart,
    reason: "Please move the booking dates.",
  });
  assert.equal(preview.ok, true, "renter preview confirms current shared stock before request submission");

  const request = put("rental_change_requests", {
    requestId: "renter-date-change-0001",
    accountId: account._id,
    bookingId: booking._id,
    kind: "dates",
    detail: "Please move the booking dates.",
    messageId: "message-date-change",
    createdAt: Date.now(),
    requestedStart,
    requestedEnd: requestedStart + day,
    requestedSnapshot: preview.controlsSnapshot,
    status: "pending",
  });

  await assert.rejects(operations.reschedule.handler(ctx, {
    token: "wrong-token",
    bookingId: booking._id,
    changeRequestId: request._id,
    start: requestedStart,
    reason: "Approved date change",
    expectedSnapshot: request.requestedSnapshot,
  }), /unauthorized/, "date application keeps the existing admin authorization boundary");
  await assert.rejects(operations.reschedule.handler(ctx, {
    token: process.env.ADMIN_TOKEN,
    bookingId: booking._id,
    changeRequestId: request._id,
    start: requestedStart,
    reason: "Approved date change",
    expectedSnapshot: request.requestedSnapshot,
  }), /approved request/, "a pending renter request cannot be applied directly by the admin operation");

  const wrongBooking = put("bookings", { accountId: otherAccount._id, guestEmail: otherAccount.email, status: "confirmed", lineItems: [] });
  const foreignRequest = put("rental_change_requests", {
    requestId: "foreign-date-change-0001",
    accountId: otherAccount._id,
    bookingId: wrongBooking._id,
    kind: "dates",
    detail: "A different rental request.",
    messageId: "message-foreign-date-change",
    createdAt: Date.now(),
    requestedStart,
    requestedEnd: requestedStart + day,
    requestedSnapshot: request.requestedSnapshot,
    status: "approved",
  });
  await assert.rejects(operations.reschedule.handler(ctx, {
    token: process.env.ADMIN_TOKEN,
    bookingId: booking._id,
    changeRequestId: foreignRequest._id,
    start: requestedStart,
    reason: "Approved date change",
    expectedSnapshot: request.requestedSnapshot,
  }), /approved request/, "an approved request belonging to another booking cannot be applied");

  await requests.review.handler(ctx, {
    token: process.env.ADMIN_TOKEN,
    bookingId: booking._id,
    id: request._id,
    decision: "approved",
    note: "Approved date change.",
  });
  assert.equal(request.status, "approved", "admin review records approval only after rechecking the stored proposal");
  assert.deepEqual(booking.lineItems.map(line => [line.start, line.end]), [[originalStart, originalStart + day]],
    "approval alone does not change the booked dates");

  const conflictingBooking = put("bookings", {
    accountId: otherAccount._id,
    guestEmail: otherAccount.email,
    status: "confirmed",
    lineItems: [{ listingId: listing._id, title: listing.title, qty: 1, start: requestedStart, end: requestedStart + day }],
  });
  const conflict = put("reservations", {
    inventoryUnitId: unit._id,
    listingId: listing._id,
    bookingId: conflictingBooking._id,
    start: requestedStart,
    end: requestedStart + day,
    qty: 1,
    source: "site",
    status: "confirmed",
  });
  await assert.rejects(operations.reschedule.handler(ctx, {
    token: process.env.ADMIN_TOKEN,
    bookingId: booking._id,
    changeRequestId: request._id,
    start: requestedStart,
    reason: "Approved date change.",
    expectedSnapshot: request.requestedSnapshot,
  }), /already reserved/, "the apply operation rechecks shared stock after approval and rejects a newly occupied date");
  assert.deepEqual(booking.lineItems.map(line => [line.start, line.end]), [[originalStart, originalStart + day]],
    "a stock race leaves the original booking dates unchanged");
  assert.equal(originalReservation.status, "confirmed", "a failed stock recheck preserves the existing allocation");
  assert.equal(request.execution, undefined, "a failed application remains recoverable, not falsely marked complete");

  await db.delete(conflict._id);
  await db.delete(conflictingBooking._id);
  const applied = await operations.reschedule.handler(ctx, {
    token: process.env.ADMIN_TOKEN,
    bookingId: booking._id,
    changeRequestId: request._id,
    start: requestedStart,
    reason: "Approved date change.",
    expectedSnapshot: request.requestedSnapshot,
  });
  assert.deepEqual(applied, { ok: true }, "the exact approved request applies after fresh shared stock confirms availability");
  assert.deepEqual(booking.lineItems.map(line => [line.start, line.end]), [[requestedStart, requestedStart + day]],
    "the booking receives the approved date window");
  assert.equal(originalReservation.status, "cancelled", "the old allocation is released only after new availability passes");
  const newReservation = tables.get("reservations").find(row => row.bookingId === booking._id && row.status === "confirmed");
  assert.deepEqual([newReservation.start, newReservation.end], [requestedStart, requestedStart + day],
    "the shared reservation ledger moves with the booking");
  assert.equal(request.execution.status, "applied", "the request stores an idempotent applied receipt");
  assert.equal(booking.rmv2SyncStatus, "pending", "the rental-manager calendar sync is queued after the date change");
  assert.equal(booking.rmv2Revision, 1, "the rental-manager calendar revision advances once");
  const messageCount = tables.get("messages").filter(row => row.bookingId === booking._id).length;
  await operations.reschedule.handler(ctx, {
    token: process.env.ADMIN_TOKEN,
    bookingId: booking._id,
    changeRequestId: request._id,
    start: requestedStart,
    reason: "Approved date change.",
    expectedSnapshot: request.requestedSnapshot,
  });
  assert.equal(tables.get("reservations").filter(row => row.bookingId === booking._id && row.status === "confirmed").length, 1,
    "a successful replay does not duplicate the active stock allocation");
  assert.equal(booking.rmv2Revision, 1, "an applied replay does not queue another calendar revision");
  assert.equal(tables.get("messages").filter(row => row.bookingId === booking._id).length, messageCount,
    "an applied replay does not duplicate renter chat messages");

  console.log("PASS renter date-change execution: admin-only apply, matching approval, fresh shared-stock recheck, booking/reservation/calendar update, safe retry; fixture database only, no provider or live booking mutation.");
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
