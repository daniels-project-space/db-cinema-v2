const assert = require("node:assert/strict");
const { load, db, put, tables } = require("./lib/rentalTestHarness.cjs");

process.env.ADMIN_TOKEN = "fixture-credit-request-admin";
const requests = load("convex/rentalRequests.ts");
const { creditOfferFingerprint } = load("convex/lib/rentalCreditPolicy.ts");
const scheduled = [];
const ctx = {
  db,
  scheduler: { runAfter: async (...args) => scheduled.push(args) },
  runQuery: async (_query, args) => ({ ok: true, start: args.start, end: args.start + 86400000, controlsSnapshot: "fixture-snapshot" }),
};
const owner = put("accounts", { email: "credit-request-owner@example.invalid" });
const other = put("accounts", { email: "credit-request-other@example.invalid" });
put("sessions", { token: "credit-request-owner", accountId: owner._id, expiresAt: Date.now() + 600000 });
put("sessions", { token: "credit-request-other", accountId: other._id, expiresAt: Date.now() + 600000 });
const makeBooking = (suffix, account = owner) => put("bookings", {
  guestEmail: account.email, accountId: account._id, status: "confirmed", total: 120,
  paidConfirmedAt: Date.now(), stripePaymentIntentId: `pi-credit-${suffix}`,
  verificationProvider: "didit", idVerifyStatus: "verified", idVerificationSource: "didit", idVerifiedAt: Date.now(),
  verificationChecks: { identity: "approved", selfie: "approved", address: "approved" },
  agreementDocs: [{ kind: "cancellation", version: "2026-11-v26" }],
  lineItems: [{ listingId: "fixture-listing", title: "Camera", qty: 1, lineTotal: 120, start: Date.now() + 20 * 86400000, end: Date.now() + 21 * 86400000 }],
});
const makeOffer = (booking, overrides = {}) => put("rental_credit_offers", {
  accountId: booking.accountId, bookingId: booking._id, amountPence: 12000,
  fingerprint: creditOfferFingerprint(booking), expiresAt: Date.now() + 600000, status: "offered", ...overrides,
});
const requestArgs = (booking, requestId, creditOfferId, token = "credit-request-owner") => ({
  token, bookingId: booking._id, requestId, kind: "cancel",
  detail: "Please review the proposed account-credit option shown in this chat.",
  cancellationChoice: "credit", creditOfferId,
});

(async () => {
  const booking = makeBooking("primary"), offer = makeOffer(booking);
  const before = JSON.stringify({ status: booking.status, total: booking.total, lineItems: booking.lineItems });
  const result = await requests.submit.handler(ctx, requestArgs(booking, "credit-review-request-0001", offer._id));
  assert.equal(result.ok, true);
  const request = tables.get("rental_change_requests").find(row => row.requestId === "credit-review-request-0001");
  assert.equal(request.status, "pending", "A credit-offer CTA creates a pending request");
  assert.equal(request.bookingId, booking._id, "The request remains bound to the exact rental");
  assert.equal(request.accountId, owner._id, "The request remains bound to the authenticated renter");
  assert.equal(request.creditOfferId, offer._id, "The exact offer id persists on the request");
  assert.equal(booking.status, "confirmed");
  assert.equal(booking.cancellationDecision, undefined);
  assert.equal(booking.total, 120);
  assert.equal((tables.get("credits") ?? []).length, 0, "No account credit is issued before review");
  assert.equal((tables.get("rental_refunds") ?? []).length, 0, "No refund is created before review");
  assert.equal(JSON.stringify({ status: booking.status, total: booking.total, lineItems: booking.lineItems }), before, "No rental state changes before review");
  const adminPage = await requests.list.handler(ctx, { token: process.env.ADMIN_TOKEN, bookingId: booking._id, admin: true, paginationOpts: { numItems: 30, cursor: null } });
  assert.equal(adminPage.page[0].creditOfferId, offer._id, "Admin review sees the exact linked offer id");
  const renterPage = await requests.list.handler(ctx, { token: "credit-request-owner", bookingId: booking._id, paginationOpts: { numItems: 30, cursor: null } });
  assert.equal("creditOfferId" in renterPage.page[0], false, "The internal offer identity is not exposed in renter request history");

  await assert.rejects(requests.submit.handler(ctx, { ...requestArgs(booking, "credit-review-request-0001", "rental_credit_offers-other") }), /different change/, "Idempotency cannot be reused with another offer id");
  const wrongRental = makeBooking("wrong-rental");
  await assert.rejects(requests.submit.handler(ctx, requestArgs(wrongRental, "wrong-rental-credit-request-0001", offer._id)), /unavailable for this rental/, "An offer cannot be attached to another rental owned by the same account");
  const foreignBooking = makeBooking("foreign", other), foreignOffer = makeOffer(foreignBooking);
  await assert.rejects(requests.submit.handler(ctx, requestArgs(foreignBooking, "foreign-credit-request-0001", foreignOffer._id, "credit-request-owner")), /not available/, "A different account cannot submit against the offer or booking");

  const expiredBooking = makeBooking("expired"), expiredOffer = makeOffer(expiredBooking, { expiresAt: Date.now() - 1 });
  await assert.rejects(requests.submit.handler(ctx, requestArgs(expiredBooking, "expired-credit-request-0001", expiredOffer._id)), /no longer available/, "Expired offers are rechecked at submission, not trusted from a stale card render");
  const staleBooking = makeBooking("stale"), staleOffer = makeOffer(staleBooking);
  await db.patch(staleBooking._id, { total: staleBooking.total + 1 });
  await assert.rejects(requests.submit.handler(ctx, requestArgs(staleBooking, "stale-credit-request-0001", staleOffer._id)), /no longer available/, "Offer fingerprints are rechecked against current booking data");
  await assert.rejects(requests.submit.handler(ctx, { ...requestArgs(staleBooking, "wrong-kind-credit-request-0001", staleOffer._id), kind: "items" }), /only be linked to a cancellation/, "Credit offers cannot be attached to another request type");
  assert.equal(tables.get("rental_change_requests").length, 1, "Wrong, foreign, expired and stale selections create no requests");
  assert.equal(booking.status, "confirmed");
  assert.equal((tables.get("credits") ?? []).length, 0);
  assert.equal((tables.get("rental_refunds") ?? []).length, 0);
  assert.ok(scheduled.length > 0, "The request is routed through the normal team notification path");
  console.log("PASS credit-offer request identity: owner and booking binding, exact offer persistence/admin visibility, wrong-rental, foreign-owner, expired and stale-offer rejection, idempotency, and no pre-review financial or rental mutation.");
})().catch(error => { console.error(error); process.exitCode = 1; });
