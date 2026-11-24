const assert = require("node:assert/strict");
const harness = require("./lib/rentalTestHarness.cjs");
const { load, db, put, tables } = harness;
const verification = load("shared/verificationProgress.ts");
const bookings = load("convex/bookings.ts");

let now = Date.UTC(2030, 0, 1, 12);
Date.now = () => now;
process.env.ADMIN_TOKEN = "late-verification-admin";

const tasks = [];
const ctx = { db, scheduler: { runAfter: async (delay, ref, args) => tasks.push({ delay, ref, args }) } };
const londonStart = Date.UTC(2030, 0, 2);
const booking = put("bookings", {
  accountAccessRequired: true,
  status: "pending_verification",
  verificationProvider: "didit",
  diditSessionId: "late-session",
  idVerifyStatus: "processing",
  checkoutPaidAt: Date.UTC(2030, 0, 1, 11),
  checkoutPaymentStatus: "paid",
  stripePaymentIntentId: "pi-late-fixture",
  total: 150,
  depositAmount: 100,
  depositRefunded: false,
  refundAmount: 0,
  rentalRefundIds: ["refund-fixture"],
  pickupTime: "10:00",
  lineItems: [{ title: "Synthetic camera", qty: 1, start: londonStart, end: londonStart + 86400000, pickupTime: "10:00" }],
});
const deadline = verification.verificationDeadlineAt(booking);
assert.equal(deadline, Date.UTC(2030, 0, 2, 12), "the cutoff is the scheduled London pickup plus two hours");
now = deadline + 1000;

const financialState = target => ({
  status: target.status,
  checkoutPaidAt: target.checkoutPaidAt,
  checkoutPaymentStatus: target.checkoutPaymentStatus,
  stripePaymentIntentId: target.stripePaymentIntentId,
  total: target.total,
  depositAmount: target.depositAmount,
  depositRefunded: target.depositRefunded,
  refundAmount: target.refundAmount,
  rentalRefundIds: target.rentalRefundIds,
  cancellationDecision: target.cancellationDecision,
  returnDecision: target.returnDecision,
});
const originalFinancialState = financialState(booking);

async function run() {
  assert.equal(verification.verificationWindowClosed(booking, now), true, "the rental closes at the shared cutoff");
  assert.equal(await bookings.setDiditSession.handler(ctx, { bookingId: booking._id, sessionId: "late-new-session" }), false,
    "a new provider session cannot be bound after this rental's deadline");
  assert.deepEqual(await bookings.claimDiditSessionSlot.handler(ctx, { bookingId: booking._id, claimId: "late-claim" }), { kind: "unavailable" },
    "the atomic session claim enforces the same cutoff");

  const lateApprovalAt = deadline + 1;
  assert.equal(await bookings.setDiditResult.handler(ctx, {
    bookingId: booking._id,
    sessionId: booking.diditSessionId,
    eventId: "late-approval-before-override",
    status: "verified",
    providerStatus: "Approved",
    decisionAt: lateApprovalAt,
    eventAt: lateApprovalAt,
    poaPostcodes: [],
  }), true);
  assert.equal(booking.idVerifyStatus, "processing", "a late provider approval is recorded as blocked, not as a pass");
  assert.equal(booking.status, "pending_verification", "late approval never confirms the rental");
  assert.equal(booking.verificationLateBlockedProviderStatus, "Approved");
  assert(tables.get("admin_notifications").some(row => row.bookingId === booking._id && row.title === "Didit approved after cutoff"),
    "the late result raises an admin review alert");
  assert.deepEqual(financialState(booking), originalFinancialState, "a blocked callback does not alter payment, refund, cancellation, or rental state");

  await assert.rejects(bookings.adminAllowLateVerification.handler(ctx, {
    token: "late-verification-admin", bookingId: booking._id, reason: "  ",
  }), /short reason/i, "the admin override requires a reason");
  assert.equal((tables.get("admin_audit_log") ?? []).length, 0, "a rejected empty-reason request leaves no successful audit row");
  await assert.rejects(bookings.adminAllowLateVerification.handler(ctx, {
    token: "wrong-token", bookingId: booking._id, reason: "Renter has a live provider case.",
  }), /unauthorized/, "only an authenticated administrator can reopen this rental");

  const reason = "Renter has a live provider case and contacted the team.";
  const override = await bookings.adminAllowLateVerification.handler(ctx, { token: "late-verification-admin", bookingId: booking._id, reason });
  assert.deepEqual(override, { allowed: true, alreadyAllowed: false });
  assert.equal(booking.verificationLateOverrideAt, now);
  assert.equal(booking.verificationLateOverrideReason, reason, "the rationale stays on this rental's admin record");
  assert.equal(verification.verificationWindowClosed(booking, now), false, "the override reopens only this rental's verification window");
  const audit = tables.get("admin_audit_log")[0];
  assert.deepEqual({ fn: audit.fn, entityId: audit.entityId, reason: audit.reason }, {
    fn: "bookings.adminAllowLateVerification", entityId: booking._id, reason,
  }, "the admin audit row links the reason to the exact booking");
  assert.equal(tasks.some(task => task.ref === "didit.reconcileLateVerificationOverride" && task.args.bookingId === booking._id), true,
    "the override triggers a provider reconciliation, not an approval");
  assert.deepEqual(financialState(booking), originalFinancialState, "the override does not change the rental, payment, refund, or cancellation");

  assert.equal(await bookings.setDiditResult.handler(ctx, {
    bookingId: booking._id,
    sessionId: booking.diditSessionId,
    eventId: "late-approval-after-override",
    status: "verified",
    providerStatus: "Approved",
    decisionAt: deadline + 2,
    eventAt: deadline + 2,
    poaPostcodes: [],
  }), true, "the explicit override allows a subsequent Didit approval");
  assert.equal(booking.idVerifyStatus, "verified", "Didit still supplies the actual pass");
  assert.equal(booking.status, "pending_verification", "the override and provider pass do not bypass paid booking confirmation");
  assert.equal(booking.verificationLateOverrideReason, reason, "the recorded rationale survives reconciliation");
  assert.deepEqual(financialState(booking), originalFinancialState, "a late Didit pass does not execute payment, refund, or cancellation changes");

  const futureStart = Date.UTC(2030, 0, 3);
  const future = put("bookings", {
    accountAccessRequired: true,
    status: "pending_verification",
    verificationProvider: "didit",
    idVerifyStatus: "required",
    checkoutPaidAt: now,
    pickupTime: "10:00",
    lineItems: [{ title: "Future synthetic camera", qty: 1, start: futureStart, end: futureStart + 86400000, pickupTime: "10:00" }],
  });
  assert.equal(verification.verificationWindowClosed(future, now), false, "an old rental's override does not close future bookings");
  assert.deepEqual(await bookings.claimDiditSessionSlot.handler(ctx, { bookingId: future._id, claimId: "future-claim" }), { kind: "owner" },
    "a new booking remains eligible for verification after the previous rental's cutoff");
  assert.equal(await bookings.setDiditSession.handler(ctx, { bookingId: future._id, sessionId: "future-session" }), true,
    "a future rental can still bind a fresh Didit session");
  assert.equal(verification.verificationWindowClosed(future, now), false);

  const cancelled = put("bookings", { ...booking, _id: "cancelled-late-rental", status: "cancelled", verificationLateOverrideAt: undefined, verificationLateOverrideReason: undefined });
  const cancelledState = financialState(cancelled);
  await assert.rejects(bookings.adminAllowLateVerification.handler(ctx, {
    token: "late-verification-admin", bookingId: cancelled._id, reason: "The renter contacted the team.",
  }), /Only this paid Didit rental/i, "a cancelled rental cannot be reopened by this override");
  assert.deepEqual(financialState(cancelled), cancelledState, "a rejected override leaves cancellation and money records unchanged");
}

run().then(() => console.log("PASS late verification cutoff: shared two-hour fence, reasoned admin override, payment/status isolation and future-rental parity"))
  .catch(error => { console.error(error); process.exitCode = 1; });
