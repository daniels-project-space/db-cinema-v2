const assert = require("node:assert/strict");
const { webcrypto, createHash } = require("node:crypto");
const harness = require("./lib/rentalTestHarness.cjs");

global.crypto ??= webcrypto;
const hash = value => createHash("sha256").update(value).digest("hex");
const sessionsAccess = harness.load("convex/adminAccountSessionV2.ts");
let migrationReady = true;
harness.setMock("./adminAccountSessionV2", {
  ...sessionsAccess,
  adminSessionMigrationReady: () => migrationReady,
});
const bookingsApi = harness.load("convex/bookings.ts");
const state = harness.load("convex/securityChargeState.ts");
const charges = harness.load("convex/securityCharges.ts");
const checkout = harness.load("convex/checkout.ts");
const sessions = harness.load("convex/adminSessionsV2.ts");
const identity = "https://identity.example|saved-card-scope-fixture";
const readToken = "a".repeat(64);
const writeToken = "b".repeat(64);
const renterToken = "renter-token-fixture";
const account = harness.put("accounts", { email: "renter@example.invalid" });
const booking = harness.put("bookings", {
  accountId: account._id,
  guestEmail: account.email,
  guestName: "Scope Fixture",
  status: "returned",
  total: 100,
  lineItems: [],
  securityPolicyVersion: "2026-11-setup-intent-v1",
  savedCardLimit: 50,
  savedCardStatus: "saved",
  savedCardChargePaidPence: 0,
  savedCardChargeReservedPence: 0,
});
const charge = harness.put("rental_security_charges", {
  bookingId: booking._id,
  accountId: account._id,
  requestId: "scope-fixture-request-0001",
  kind: "damage",
  amountPence: 500,
  reason: "Scope fixture evidence",
  customerId: "cus_fixture",
  paymentMethodId: "pm_fixture",
  consentSnapshot: "{}",
  state: "notice_pending",
  createdAt: Date.now(),
  updatedAt: Date.now(),
});
harness.put("sessions", { token: renterToken, accountId: account._id, expiresAt: Date.now() + 60_000 });

const ctx = {
  db: harness.db,
  auth: { getUserIdentity: async () => ({ tokenIdentifier: identity }) },
};
const reads = [];
const actionCtx = {
  runMutation: async (reference, args) => {
    reads.push(reference);
    if (reference === "securityChargeState.authorizeAdminPayment") return state.authorizeAdminPayment.handler(ctx, args);
    throw Error(`Unexpected mutation ${reference}`);
  },
  runQuery: async (reference, args) => {
    reads.push(reference);
    throw Error(`Query should not run before authorization: ${reference}`);
  },
  runAction: async (reference, args) => {
    reads.push(reference);
    throw Error(`Provider action should not run in this test: ${reference}`);
  },
};

process.env.ADMIN_SESSION_BILLING_PORTAL_V2 = "enabled";
process.env.ADMIN_SESSION_SCOPES_V2 = JSON.stringify({ [identity]: ["payments:read", "payments:write"] });
process.env.ADMIN_TOKEN = "legacy-token-must-not-authorize";

(async () => {
  for (const [token, scope] of [[readToken, "payments:read"], [writeToken, "payments:write"]]) {
    await sessions.createSession.handler(ctx, {
      tokenDigest: hash(token),
      principalId: `admin:${hash(identity)}`,
      scopes: [scope],
      expiresAt: Date.now() + 60_000,
    });
  }

  const paginationOpts = { numItems: 10, cursor: null };
  migrationReady = false;
  await assert.rejects(
    bookingsApi.adminInvoicePage.handler(ctx, { token: "legacy-admin-token", accountId: account._id, paginationOpts }),
    /migration is not ready/,
    "enabled V2 flag fails closed while migration readiness is false",
  );
  migrationReady = true;
  const invoicePage = await bookingsApi.adminInvoicePage.handler(ctx, {
    token: readToken,
    accountId: account._id,
    paginationOpts,
  });
  assert.deepEqual(invoicePage.page.map(row => row._id), [booking._id]);
  await assert.rejects(
    bookingsApi.adminInvoicePage.handler(ctx, { token: writeToken, accountId: account._id, paginationOpts }),
    /unauthorized/,
    "payments:write does not silently imply invoice-read access",
  );
  await assert.rejects(
    bookingsApi.adminInvoicePage.handler(ctx, { token: "c".repeat(64), accountId: account._id, paginationOpts }),
    /unauthorized/,
    "legacy admin token cannot bypass the V2 invoice scope gate",
  );

  const adminRows = await state.list.handler(ctx, { token: readToken, bookingId: booking._id, admin: true });
  assert.equal(adminRows.rows.length, 1);
  assert.equal((await state.evidence.handler(ctx, { token: readToken, id: charge._id })).assessmentId, charge._id);
  assert.equal(
    await state.list.handler(ctx, { token: readToken, bookingId: booking._id, admin: false }),
    null,
    "an admin session cannot use the renter path without an account session",
  );
  const renterRows = await state.list.handler(ctx, { token: renterToken, bookingId: booking._id, admin: false });
  assert.equal(renterRows.rows.length, 1, "the renter's own rental view remains available");
  await assert.rejects(
    state.list.handler({ ...ctx, auth: { getUserIdentity: async () => ({ tokenIdentifier: "renter|identity" }) } }, {
      token: renterToken,
      bookingId: booking._id,
      admin: true,
    }),
    /unauthorized/,
    "a renter cannot request the admin charge view",
  );
  await assert.rejects(
    state.evidence.handler({ ...ctx, auth: { getUserIdentity: async () => ({ tokenIdentifier: "renter|identity" }) } }, { token: renterToken, id: charge._id }),
    /unauthorized/,
    "a renter cannot download the admin evidence package",
  );

  await assert.rejects(
    state.closePrepared.handler(ctx, { token: readToken, id: charge._id, reason: "withdraw fixture" }),
    /unauthorized/,
    "read-only session cannot withdraw a charge",
  );
  await assert.rejects(
    state.proposeResolution.handler(ctx, { token: readToken, id: charge._id, explanation: "Reviewed fixture evidence" }),
    /unauthorized/,
    "read-only session cannot write a dispute resolution",
  );

  const beforeAudit = (await harness.db.query("admin_audit_log").collect()).length;
  await assert.rejects(
    state.closePrepared.handler(ctx, { token: writeToken, id: "missing-charge", reason: "withdraw fixture" }),
    /Charge missing/,
    "write session passes scope authorization before target validation",
  );
  assert.equal((await harness.db.query("admin_audit_log").collect()).length, beforeAudit + 1, "V2 writes create an audit record");

  for (const invoke of [
    () => charges.submitClaim.handler(actionCtx, { token: readToken, bookingId: booking._id, requestId: "claim-fixture-00001", kind: "damage", amount: 1, reason: "test evidence" }),
    () => charges.prepareClaim.handler(actionCtx, { token: readToken, ownerClaimToken: "a".repeat(64), confirmed: true, bookingId: booking._id, requestId: "prepare-claim-fixture-00001", kind: "damage", amount: 1, reason: "test evidence" }),
    () => charges.collect.handler(actionCtx, { token: readToken, id: charge._id }),
    () => charges.refresh.handler(actionCtx, { token: readToken, id: charge._id, admin: true }),
    () => charges.reconcileReference.handler(actionCtx, { token: readToken, id: charge._id, paymentIntentId: "pi_fixture" }),
    () => charges.refundPayment.handler(actionCtx, { token: readToken, id: charge._id, reason: "refund fixture" }),
    () => charges.resendNotice.handler(actionCtx, { token: readToken, id: charge._id }),
    () => charges.resendReceipt.handler(actionCtx, { token: readToken, id: charge._id }),
    () => checkout.retrySavedCard.handler(actionCtx, { token: readToken, bookingId: booking._id, admin: true }),
  ]) {
    reads.length = 0;
    await assert.rejects(invoke(), /unauthorized/, "read-only session cannot invoke an admin Stripe/payment action");
    assert.deepEqual(reads, ["securityChargeState.authorizeAdminPayment"], "authorization blocks provider and data work first");
  }

  reads.length = 0;
  await assert.rejects(
    charges.collect.handler(actionCtx, { token: writeToken, id: charge._id }),
    /Unexpected mutation securityChargeState\.claim/,
    "write session passes scope authorization before the saved-card claim mutation",
  );
  assert.deepEqual(reads, ["securityChargeState.authorizeAdminPayment", "securityChargeState.claim"]);
  reads.length = 0;
  await assert.rejects(
    checkout.retrySavedCard.handler(actionCtx, { token: writeToken, bookingId: booking._id, admin: true }),
    /Query should not run before authorization: savedCardState\.context/,
    "write session passes scope authorization before saved-card recovery reads the rental",
  );
  assert.deepEqual(reads, ["securityChargeState.authorizeAdminPayment", "savedCardState.context"]);

  delete process.env.ADMIN_SESSION_BILLING_PORTAL_V2;
  process.env.ADMIN_TOKEN = "legacy-admin-token";
  const legacyPage = await bookingsApi.adminInvoicePage.handler(ctx, {
    token: "legacy-admin-token",
    accountId: account._id,
    paginationOpts,
  });
  assert.equal(legacyPage.page.length, 1, "existing legacy fallback remains active until migration is enabled");
  assert.equal((await state.list.handler(ctx, { token: "legacy-admin-token", bookingId: booking._id, admin: true })).rows.length, 1);
  assert.equal(await state.list.handler(ctx, { token: "invalid-legacy-token", bookingId: booking._id, admin: true }), null, "legacy invalid-token list behavior remains a null result");
  await assert.rejects(
    state.prepare.handler(ctx, {
      token: "legacy-admin-token",
      bookingId: booking._id,
      requestId: "scope-fixture-request-0004",
      kind: "damage",
      amount: 0,
      reason: "scope test evidence",
      immediate: false,
    }),
    /positive penny-accurate amount/,
    "legacy admin fallback still authorizes the old mutation route before business validation",
  );
  await state.authorizeAdminPayment.handler(ctx, { token: "legacy-admin-token", operation: "legacy.fixture" });
  await assert.rejects(
    state.authorizeAdminPayment.handler(ctx, { token: "not-admin", operation: "legacy.fixture" }),
    /unauthorized/,
    "the legacy action fallback still rejects an invalid admin token",
  );

  console.log("PASS saved-card and invoice V2 boundaries: scoped reads, write-only mutations/actions, renter denial, audit, and legacy fallback");
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
