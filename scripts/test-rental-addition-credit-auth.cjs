const assert = require("node:assert/strict");
const { load, db, put, tables, setMock } = require("./lib/rentalTestHarness.cjs");

let providerSession;
setMock("stripe", { __esModule: true, default: class StripeFixture { checkout = { sessions: { retrieve: async () => providerSession } }; } });
const state = load("convex/rentalAdditionState.ts");
const actions = load("convex/rentalAdditions.ts");
const owner = put("accounts", { email: "owner@rental-test.invalid" });
const other = put("accounts", { email: "other@rental-test.invalid" });
put("sessions", { accountId: owner._id, token: "owner-token", expiresAt: Date.now() + 60000 });
put("sessions", { accountId: other._id, token: "other-token", expiresAt: Date.now() + 60000 });
const listing = put("listings", { title: "Rental item", active: true, reviewedImageUrls: [] });
const booking = put("bookings", { accountId: owner._id, status: "confirmed" });
const addition = put("rental_additions", {
  bookingId: booking._id,
  listingId: listing._id,
  status: "prepared",
  title: listing.title,
  qty: 1,
  lineTotal: 20,
  securityCharge: 0,
  checkoutProtocolVersion: 2,
  createdAt: Date.now(),
});
booking.activeAdditionId = addition._id;

const queryCtx = { db };
let writes = 0;
const actionCtx = {
  runQuery: async (reference, args) => {
    assert.equal(reference, "rentalAdditionState.customerState");
    return state.customerState.handler(queryCtx, args);
  },
  runMutation: async () => {
    writes += 1;
    throw new Error("An unauthorized credit request reached a write.");
  },
};

(async () => {
  await assert.rejects(
    actions.useAccountCredit.handler(actionCtx, { token: "invalid", bookingId: booking._id }),
    /not eligible/,
  );
  await assert.rejects(
    actions.useAccountCredit.handler(actionCtx, { token: "other-token", bookingId: booking._id }),
    /not available to your account/,
  );
  assert.equal(writes, 0, "invalid and foreign-account requests must fail before any mutation");
  assert.equal((tables.get("rental_credit_reservations") ?? []).length, 0);

  const wallet = put("credits", {
    accountId: owner._id,
    amount: 20,
    remaining: 20,
    currency: "GBP",
    kind: "refund",
    reason: "rental_refund:fixture",
    status: "active",
    createdAt: Date.now(),
    expiresAt: Date.now() + 86400000,
  });
  addition.status = "awaiting_payment";
  addition.lineTotal = 16;
  addition.undiscountedLineTotal = 20;
  addition.benefitSaving = 4;
  addition.securityCharge = 5;
  await state.markSessionCreation.handler(queryCtx, { id: addition._id, creditOptIn: false, creditAppliedPence: 0 });
  await state.markSessionCreation.handler(queryCtx, { id: addition._id, creditOptIn: false, creditAppliedPence: 0 });
  await assert.rejects(state.selectAccountCredit.handler(queryCtx, { token: "owner-token", bookingId: booking._id, additionId: addition._id, expectedSessionId: undefined }), /existing card payment is being checked/, "an in-flight or lost-response checkout cannot switch funding");
  assert.equal((tables.get("rental_credit_reservations") ?? []).length, 0);
  addition.sessionCreationPending = false;
  const selected = await state.selectAccountCredit.handler(queryCtx, {
    token: "owner-token",
    bookingId: booking._id,
    additionId: addition._id,
    expectedSessionId: undefined,
  });
  assert.equal(selected.creditAppliedPence, 1600, "account credit applies to the saved discounted rental charge");
  assert.equal(selected.cardDuePence, 500, "separate security stays payable by card");
  assert.equal(wallet.remaining, 20, "choosing account credit reserves it without spending it");
  const selectedAgain = await state.selectAccountCredit.handler(queryCtx, {
    token: "owner-token",
    bookingId: booking._id,
    additionId: addition._id,
    expectedSessionId: undefined,
  });
  assert.equal(selectedAgain.creditReservationId, selected.creditReservationId, "reselecting credit reuses the same reservation");
  assert.equal((tables.get("rental_credit_reservations") ?? []).length, 1);
  await assert.rejects(state.markSessionCreation.handler(queryCtx, { id: addition._id, creditOptIn: false, creditAppliedPence: 0 }), /payment changed/, "a stale card-only creator cannot run after credit selection");
  const legacy = put("rental_additions", { bookingId: booking._id, listingId: listing._id, status: "prepared", title: listing.title, qty: 1, lineTotal: 5, securityCharge: 0, createdAt: Date.now() });
  booking.activeAdditionId = legacy._id;
  await assert.rejects(state.selectAccountCredit.handler(queryCtx, { token: "owner-token", bookingId: booking._id, additionId: legacy._id, expectedSessionId: undefined }), /existing card payment is being checked/, "an unbound legacy checkout is treated as an unknown provider outcome");
  legacy.sessionId = "cs_ambiguous"; providerSession = { id: "cs_ambiguous", status: "expired", payment_status: "paid" }; process.env.STRIPE_SECRET_KEY = "sk_test_fixture";
  await assert.rejects(actions.useAccountCredit.handler(actionCtx, { token: "owner-token", bookingId: booking._id }), /still processing/, "conflicting provider status cannot release an old payment link for tender switching");
  assert.equal(writes, 0, "ambiguous provider status must not initiate a credit reservation");
  console.log("PASS rental-addition account-credit ownership, discounted charge allocation, separate security balance, and idempotent reservation; synthetic data only.");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
