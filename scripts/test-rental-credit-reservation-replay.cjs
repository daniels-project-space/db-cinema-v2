const assert = require("node:assert/strict");
const { load, db, put, tables } = require("./lib/rentalTestHarness.cjs");
const funding = load("convex/lib/rentalCreditFunding.ts");
const checkoutCredit = load("convex/lib/checkoutCredit.ts");

const account = put("accounts", { email: "credit-replay@example.invalid" });
const booking = put("bookings", { accountId: account._id, status: "confirmed" });
const credit = put("credits", {
  accountId: account._id,
  amount: 30,
  remaining: 30,
  currency: "GBP",
  kind: "refund",
  reason: "rental_refund:fixture",
  status: "active",
  createdAt: Date.now(),
  expiresAt: Date.now() + 86400000,
});
const ctx = { db };

(async () => {
  const reservation = await funding.reserveRentalCredit(ctx, {
    accountId: account._id,
    bookingId: booking._id,
    operationType: "addition",
    operationId: "addition-replay-fixture",
    requestedPence: 8000,
  });
  assert.equal(reservation.requestedPence, 8000);
  assert.equal(reservation.amountPence, 3000, "a request can reserve only the available portion of a discounted amount");
  assert.equal(credit.remaining, 30, "a reservation does not spend credit");
  assert.equal((await checkoutCredit.availableCreditRows(ctx, account._id))[0].availablePence, 0);

  const replay = await funding.reserveRentalCredit(ctx, {
    accountId: account._id,
    bookingId: booking._id,
    operationType: "addition",
    operationId: "addition-replay-fixture",
    requestedPence: 8000,
  });
  assert.equal(replay._id, reservation._id, "the same operation retry reuses its single reservation");
  await assert.rejects(
    funding.reserveRentalCredit(ctx, {
      accountId: account._id,
      bookingId: booking._id,
      operationType: "addition",
      operationId: "addition-replay-fixture",
      requestedPence: 5000,
    }),
    /request changed/,
    "an idempotency key cannot be replayed with a different discounted amount",
  );
  assert.equal((tables.get("rental_credit_reservations") ?? []).length, 1);

  const consumed = await funding.consumeRentalCredit(ctx, "addition", "addition-replay-fixture");
  assert.equal(consumed.amountPence, 3000);
  assert.equal(credit.remaining, 0);
  await funding.consumeRentalCredit(ctx, "addition", "addition-replay-fixture");
  assert.equal(credit.remaining, 0, "payment reconciliation replay cannot debit wallet credit twice");

  const restored = await funding.restoreRentalCredit(ctx, "addition", "addition-replay-fixture");
  assert.equal(restored.issuedPence, 3000);
  assert.equal((tables.get("credits") ?? []).reduce((sum, row) => sum + row.remaining, 0), 30);
  const restoredAgain = await funding.restoreRentalCredit(ctx, "addition", "addition-replay-fixture");
  assert.equal(restoredAgain.amountPence, 0);
  assert.equal((tables.get("credits") ?? []).length, 2, "refund reconciliation does not issue duplicate credit");

  const splitAccount = put("accounts", { email: "credit-partial-restore@example.invalid" });
  const splitBooking = put("bookings", { accountId: splitAccount._id, status: "confirmed" });
  const earlierCredit = put("credits", {
    accountId: splitAccount._id, amount: 30, remaining: 30, currency: "GBP", kind: "refund",
    reason: "rental_refund:partial-fixture", status: "active", createdAt: Date.now(), expiresAt: Date.now() + 86400000,
  });
  const laterCredit = put("credits", {
    accountId: splitAccount._id, amount: 20, remaining: 20, currency: "GBP", kind: "earned",
    reason: "earned_credit", status: "active", createdAt: Date.now() + 1, expiresAt: Date.now() + 2 * 86400000,
  });
  const splitReservation = await funding.reserveRentalCredit(ctx, {
    accountId: splitAccount._id, bookingId: splitBooking._id, operationType: "extension",
    operationId: "partial-restore-fixture", requestedPence: 5000,
  });
  assert.deepEqual(splitReservation.allocations.map(row => row.amountPence), [3000, 2000]);
  await funding.consumeRentalCredit(ctx, "extension", "partial-restore-fixture");
  const partial = await funding.restoreRentalCredit(ctx, "extension", "partial-restore-fixture", 2000);
  assert.equal(partial.issuedPence, 2000, "a partial cancellation restores only the requested tender portion");
  const samePartial = await funding.restoreRentalCredit(ctx, "extension", "partial-restore-fixture", 2000);
  assert.equal(samePartial.issuedPence, 0, "replaying a partial restoration does not duplicate the credit issue");
  const increasedPartial = await funding.restoreRentalCredit(ctx, "extension", "partial-restore-fixture", 4000);
  assert.equal(increasedPartial.amountPence, 2000, "increasing the refund restores only the new increment");
  assert.equal(increasedPartial.issuedPence, 2000);
  assert.equal((await db.get(splitReservation._id)).restoredPence, 4000);
  assert.equal((await db.get(earlierCredit._id)).remaining, 0, "restores preserve the original source allocation order");
  assert.equal((await db.get(laterCredit._id)).remaining, 0);
  const fullSplitRestore = await funding.restoreRentalCredit(ctx, "extension", "partial-restore-fixture");
  assert.equal(fullSplitRestore.issuedPence, 1000, "the final refund restores the remaining tender only");
  assert.equal((await db.get(splitReservation._id)).state, "restored");
  assert.equal((await db.get(splitReservation._id)).restoredPence, 5000);

  const legacyId = await db.insert("rental_credit_reservations", {
    accountId: account._id,
    bookingId: booking._id,
    operationType: "delivery",
    operationId: "legacy-reservation-fixture",
    state: "reserved",
    amountPence: 100,
    allocations: [{ creditId: credit._id, amountPence: 100, kind: "refund" }],
    createdAt: Date.now(),
    updatedAt: Date.now(),
  });
  const legacyReplay = await funding.reserveRentalCredit(ctx, {
    accountId: account._id,
    bookingId: booking._id,
    operationType: "delivery",
    operationId: "legacy-reservation-fixture",
    requestedPence: 200,
  });
  assert.equal(legacyReplay._id, legacyId, "legacy reservations without an amount snapshot remain retryable");
  console.log("PASS account-credit reservation amount replay, use, refund restoration, and legacy-row compatibility; synthetic data only.");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
