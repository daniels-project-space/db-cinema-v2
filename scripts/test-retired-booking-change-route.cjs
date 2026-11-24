const assert = require("node:assert/strict");
const { load, db, put, tables } = require("./lib/rentalTestHarness.cjs");

const changes = load("convex/changes.ts");
const account = put("accounts", { email: "legacy-change@example.invalid" });
const booking = put("bookings", {
  accountId: account._id,
  status: "confirmed",
  lineItems: [{ start: 1_900_000_000_000, end: 1_900_086_400_000, title: "Camera", qty: 1 }],
});
const session = put("sessions", {
  token: "legacy-change-session",
  accountId: account._id,
  expiresAt: Date.now() + 60_000,
});
const oldRequest = put("booking_change_requests", {
  bookingId: booking._id,
  accountId: account._id,
  type: "reschedule",
  status: "pending",
  requestedStart: 1_900_000_000_000,
  requestedEnd: 1_900_086_400_000,
  createdAt: Date.now() - 1_000,
});
const originalLines = structuredClone(booking.lineItems);
const jobs = [];
const ctx = { db, scheduler: { runAfter: async (...args) => jobs.push(args) } };
const args = {
  token: session.token,
  bookingId: booking._id,
  type: "reschedule",
  requestedStart: 1_900_086_400_000,
  requestedEnd: 1_900_172_800_000,
};
const expectedError = /older change-request route is retired.*rental conversation/i;

(async () => {
  for (const enabled of ["true", "false"]) {
    process.env.CUSTOMER_BOOKING_ACTIONS = enabled;
    await assert.rejects(changes.requestBookingChange.handler(ctx, args), expectedError);
    assert.deepEqual(booking.lineItems, originalLines, "the retired route never changes booking dates");
    assert.equal(oldRequest.status, "pending", "legacy requests remain available for manual resolution");
    assert.equal((tables.get("booking_change_requests") ?? []).length, 1, "the retired route creates no request");
    assert.equal((tables.get("messages") ?? []).length, 0, "the retired route sends no chat message");
    assert.equal(jobs.length, 0, "the retired route schedules no approval alert");
  }
  console.log("retired booking change route: no writes with flag on/off; legacy pending row preserved");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
