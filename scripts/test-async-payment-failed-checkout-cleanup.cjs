const assert = require("node:assert/strict");
const { load, db, put, setMock, tables } = require("./lib/rentalTestHarness.cjs");

const calls = [];
const liveSessions = new Map();
let retrievalError = null;
class StripeFixture {
  webhooks = {
    constructEvent: (body, signature, secret) => {
      calls.push("signature");
      assert.equal(secret, "whsec_fixture");
      if (signature !== "fixture-signature") throw Error("Invalid signature");
      return JSON.parse(body);
    },
  };
  checkout = {
    sessions: {
      retrieve: async (id) => {
        calls.push(`retrieve:${id}`);
        if (retrievalError) throw retrievalError;
        return liveSessions.get(id);
      },
    },
  };
}
setMock("stripe", { default: StripeFixture });
process.env.STRIPE_SECRET_KEY = "sk_test_fixture";
process.env.STRIPE_WEBHOOK_SECRET = "whsec_fixture";
const checkout = load("convex/checkout.ts");
const bookings = load("convex/bookings.ts");
const mutationCtx = { db, scheduler: { runAfter: async () => {} } };
let beforeMutation = null;
const ctx = {
  runMutation: async (ref, args) => {
    calls.push(`mutation:${ref}`);
    if (beforeMutation) await beforeMutation(ref, args);
    if (ref !== "bookings.expireUnpaidPending") throw Error(`Unexpected mutation ${ref}`);
    return bookings.expireUnpaidPending.handler(mutationCtx, args);
  },
  runAction: async (ref) => { throw Error(`Unexpected action ${ref}`); },
};

function bookingFixture({ sessionId = "cs_fixture", status = "pending_payment", didit = false } = {}) {
  const booking = put("bookings", {
    status,
    stripeCheckoutSessionId: sessionId,
    total: 100,
    rentalPaidPence: 10000,
    checkoutExpectedAmountPence: 10000,
    currency: "GBP",
    verificationProvider: didit ? "didit" : undefined,
    idVerifyStatus: didit ? "required" : undefined,
    lineItems: [],
  });
  const hold = put("reservations", {
    bookingId: booking._id,
    status: "hold",
    holdExpiresAt: Date.now() + 30 * 60 * 1000,
  });
  return { booking, hold };
}

function session(id, bookingId, status = "complete", paymentStatus = "unpaid") {
  return { id, status, payment_status: paymentStatus, metadata: { bookingId } };
}

function event(type, snapshot) {
  return {
    body: JSON.stringify({ id: `evt_${snapshot.id}_${type}`, type, data: { object: snapshot } }),
    sig: "fixture-signature",
  };
}

async function deliver(type, snapshot, signature = "fixture-signature") {
  return checkout.stripeWebhook.handler(ctx, { ...event(type, snapshot), sig: signature });
}

function resetCalls() {
  calls.length = 0;
  beforeMutation = null;
  retrievalError = null;
}

(async () => {
  const { booking, hold } = bookingFixture();
  const failed = session("cs_fixture", booking._id);
  liveSessions.set(failed.id, failed);
  assert.equal(await deliver("checkout.session.async_payment_failed", failed, "bad-signature"), false);
  assert.deepEqual(calls, ["signature"], "An invalid signature cannot retrieve provider state or dispatch cleanup");

  resetCalls();
  assert.equal(await deliver("checkout.session.async_payment_failed", failed), true);
  assert.deepEqual(calls, [
    "signature",
    "retrieve:cs_fixture",
    "mutation:bookings.expireUnpaidPending",
  ], "Signature validation precedes the current Stripe read and the atomic cleanup mutation");
  assert.equal(booking.status, "cancelled");
  assert.equal(await db.get(hold._id), null, "The failed unpaid booking releases its stock hold");
  const firstCancelledAt = booking.cancelledAt;
  const firstRevision = tables.get("verification_retention_revisions")[0].revision;

  resetCalls();
  await deliver("checkout.session.async_payment_failed", failed);
  assert.equal(booking.cancelledAt, firstCancelledAt, "Webhook replay does not rewrite the terminal booking state");
  assert.equal(tables.get("verification_retention_revisions")[0].revision, firstRevision, "Replay does not duplicate cleanup side effects");
  assert.equal((tables.get("reservations") ?? []).filter((row) => row.bookingId === booking._id && row.status === "hold").length, 0);

  const paidBooking = bookingFixture();
  const paidSnapshot = session("cs_paid", paidBooking.booking._id);
  liveSessions.set(paidSnapshot.id, session("cs_paid", paidBooking.booking._id, "complete", "paid"));
  resetCalls();
  await deliver("checkout.session.async_payment_failed", paidSnapshot);
  assert.equal(paidBooking.booking.status, "pending_payment", "A stale failure event cannot close a session Stripe now reports paid");
  assert.equal(await db.get(paidBooking.hold._id) !== null, true, "A paid provider session keeps its reservation until receipt reconciliation");
  assert.deepEqual(calls, ["signature", "retrieve:cs_paid"]);

  const mismatchedSessionBooking = bookingFixture({ sessionId: "cs_saved" });
  const mismatchedSessionSnapshot = session("cs_event", mismatchedSessionBooking.booking._id);
  liveSessions.set(mismatchedSessionSnapshot.id, session("cs_other", mismatchedSessionBooking.booking._id));
  resetCalls();
  await deliver("checkout.session.async_payment_failed", mismatchedSessionSnapshot);
  assert.equal(mismatchedSessionBooking.booking.status, "pending_payment", "A wrong live Stripe session cannot close a booking");
  assert.equal(await db.get(mismatchedSessionBooking.hold._id) !== null, true);
  assert.deepEqual(calls, ["signature", "retrieve:cs_event"]);

  const wrongBooking = bookingFixture();
  const otherBooking = bookingFixture();
  const wrongBookingSnapshot = session("cs_wrong_booking", wrongBooking.booking._id);
  liveSessions.set(wrongBookingSnapshot.id, session("cs_wrong_booking", otherBooking.booking._id));
  resetCalls();
  await deliver("checkout.session.async_payment_failed", wrongBookingSnapshot);
  assert.equal(wrongBooking.booking.status, "pending_payment", "Mismatched provider metadata cannot close the event's booking");
  assert.equal(otherBooking.booking.status, "pending_payment");
  assert.deepEqual(calls, ["signature", "retrieve:cs_wrong_booking"]);

  const bookingSessionMismatch = bookingFixture({ sessionId: "cs_stored_elsewhere" });
  const mismatchedStoredSnapshot = session("cs_claimed", bookingSessionMismatch.booking._id);
  liveSessions.set(mismatchedStoredSnapshot.id, mismatchedStoredSnapshot);
  resetCalls();
  await deliver("checkout.session.async_payment_failed", mismatchedStoredSnapshot);
  assert.equal(bookingSessionMismatch.booking.status, "pending_payment", "Atomic booking/session matching rejects stale or substituted bindings");
  assert.equal(await db.get(bookingSessionMismatch.hold._id) !== null, true);
  assert.deepEqual(calls, ["signature", "retrieve:cs_claimed", "mutation:bookings.expireUnpaidPending"]);

  const latePayment = bookingFixture({ didit: true, sessionId: "cs_late_payment" });
  const latePaymentSnapshot = session("cs_late_payment", latePayment.booking._id);
  liveSessions.set(latePaymentSnapshot.id, latePaymentSnapshot);
  resetCalls();
  beforeMutation = async (ref) => {
    if (ref === "bookings.expireUnpaidPending") {
      await bookings.recordPaidCheckoutReceipt.handler(mutationCtx, {
        bookingId: latePayment.booking._id,
        sessionId: latePaymentSnapshot.id,
        paymentIntentId: "pi_late_payment",
        amountTotalPence: 10000,
        currency: "gbp",
        paymentStatus: "paid",
      });
    }
  };
  await deliver("checkout.session.async_payment_failed", latePaymentSnapshot);
  assert.equal(latePayment.booking.status, "pending_verification", "A receipt that wins the transition race preserves paid-pending verification");
  assert.equal(latePayment.booking.checkoutPaymentStatus, "paid");
  assert.equal(await db.get(latePayment.hold._id) !== null, true, "The atomic recheck keeps the paid reservation");

  const expiredBooking = bookingFixture({ sessionId: "cs_expired" });
  const expired = session("cs_expired", expiredBooking.booking._id, "expired", "unpaid");
  liveSessions.set(expired.id, expired);
  resetCalls();
  await deliver("checkout.session.expired", expired);
  assert.equal(expiredBooking.booking.status, "cancelled", "A live expired/unpaid session uses the same cleanup transition");
  assert.equal(await db.get(expiredBooking.hold._id), null);

  const retryBooking = bookingFixture({ sessionId: "cs_retry" });
  const retrySnapshot = session("cs_retry", retryBooking.booking._id);
  liveSessions.set(retrySnapshot.id, retrySnapshot);
  resetCalls();
  retrievalError = Error("temporary Stripe read failure");
  await assert.rejects(() => deliver("checkout.session.async_payment_failed", retrySnapshot), /temporary Stripe read failure/);
  assert.equal(retryBooking.booking.status, "pending_payment", "A provider read error leaves the rental and hold untouched");
  assert.equal(await db.get(retryBooking.hold._id) !== null, true);
  assert.deepEqual(calls, ["signature", "retrieve:cs_retry"]);
  retrievalError = null;
  resetCalls();
  await deliver("checkout.session.async_payment_failed", retrySnapshot);
  assert.equal(retryBooking.booking.status, "cancelled", "Retry after provider recovery completes the safe cleanup");
  assert.equal(await db.get(retryBooking.hold._id), null);

  console.log("PASS async payment failure cleanup: signature-first dispatch, current-session checks, exact booking binding, paid-race protection, replay safety, expiry parity, and retry preservation.");
})().catch((error) => { console.error(error); process.exitCode = 1; });
