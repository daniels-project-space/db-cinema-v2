const assert = require("node:assert/strict");
const { webcrypto, createHash } = require("node:crypto");
const harness = require("./lib/rentalTestHarness.cjs");
global.crypto ??= webcrypto;
const access = harness.load("convex/adminAccountSessionV2.ts");
harness.setMock("./adminAccountSessionV2", { ...access, adminSessionMigrationReady: () => true });
const attachments = harness.load("convex/chatAttachments.ts");
const bookings = harness.load("convex/bookings.ts");
const didit = harness.load("convex/didit.ts");
const sessions = harness.load("convex/adminSessionsV2.ts");
const hash = value => createHash("sha256").update(value).digest("hex");
const identity = "https://identity.example|attachment-fixture";
const readToken = "a".repeat(64), writeToken = "b".repeat(64), verificationToken = "c".repeat(64);
const account = harness.put("accounts", { email: "attachment@example.invalid" });
const booking = harness.put("bookings", { accountId: account._id, guestEmail: account.email, verificationProvider: "didit", diditSessionId: "fixture-session", idVerifyStatus: "manual_review", status: "confirmed" });
const ctx = { db: harness.db, auth: { getUserIdentity: async () => ({ tokenIdentifier: identity }) } };
process.env.ADMIN_SESSION_ATTACHMENTS_V2 = "enabled";
process.env.ADMIN_SESSION_SCOPES_V2 = JSON.stringify({ [identity]: ["customers:read", "customers:write", "verification:write"] });
process.env.ADMIN_TOKEN = "legacy-attachment-fixture";

(async () => {
  for (const [token, scope] of [[readToken, "customers:read"], [writeToken, "customers:write"], [verificationToken, "verification:write"]])
    await sessions.createSession.handler(ctx, { tokenDigest: hash(token), principalId: `admin:${hash(identity)}`, scopes: [scope], expiresAt: Date.now() + 60_000 });
  const upload = { token: writeToken, admin: true, accountId: account._id, marker: `application/vnd.dbcinema.chat-${"1".repeat(32)}`, requestKey: "2".repeat(32) };
  await assert.rejects(attachments.reserve.handler(ctx, { ...upload, token: readToken }), /unauthorized/);
  await assert.rejects(attachments.reserve.handler(ctx, { ...upload, token: process.env.ADMIN_TOKEN }), /unauthorized/);
  assert.equal((await attachments.reserve.handler(ctx, upload)).status, "ready");
  await assert.rejects(attachments.download.handler(ctx, { ...upload, id: "missing" }), /unauthorized/);
  await assert.rejects(attachments.download.handler(ctx, { ...upload, token: readToken, id: "missing" }), /Attachment unavailable/);
  assert(harness.tables.get("admin_audit_log").some(row => row.fn === "chatAttachments.reserve"));
  const result = { bookingId: booking._id, sessionId: booking.diditSessionId, eventId: "fixture", eventAt: Date.now(), status: "rejected", poaPostcodes: [], adminReviewSessionToken: verificationToken };
  await assert.rejects(bookings.setDiditResult.handler({ ...ctx, auth: { getUserIdentity: async () => ({ tokenIdentifier: "other" }) } }, result), /unauthorized/);
  await sessions.revoke.handler(ctx, { tokenDigest: hash(verificationToken) });
  await assert.rejects(bookings.setDiditResult.handler(ctx, result), /unauthorized/);
  assert.equal(booking.idVerifyStatus, "manual_review", "a revoked reviewer must not commit after provider read");
  await assert.rejects(access.authorizeDiditReview.handler(ctx, { token: verificationToken }), /not ready/);
  const racingToken = "d".repeat(64);
  await sessions.createSession.handler(ctx, { tokenDigest: hash(racingToken), principalId: `admin:${hash(identity)}`, scopes: ["verification:write"], expiresAt: Date.now() + 60_000 });
  process.env.ADMIN_SESSION_DIDIT_REVIEW_V2 = "enabled";
  process.env.DIDIT_API_KEY = "fixture"; process.env.DIDIT_WORKFLOW_ID = "fixture-workflow";
  process.env.DIDIT_WEBHOOK_SECRET = "fixture"; process.env.DIDIT_APPLICATION_ID = "fixture"; process.env.DIDIT_ENVIRONMENT = "sandbox";
  const originalFetch = global.fetch;
  try {
    global.fetch = async () => {
      await sessions.revoke.handler(ctx, { tokenDigest: hash(racingToken) });
      return new Response(JSON.stringify({ session_id: booking.diditSessionId, session_kind: "user", workflow_id: "fixture-workflow", vendor_data: `dbc-booking-${booking._id}`, contact_details: { email: account.email }, status: "Declined" }), { status: 200 });
    };
    const actionCtx = { ...ctx, runQuery: async () => booking, runMutation: async (ref, args) => {
      if (ref === "adminAccountSessionV2.authorizeDiditReview") return access.assertAdminScopeSession(ctx, args.token, "verification:write");
      if (ref === "bookings.setDiditResult") return bookings.setDiditResult.handler(ctx, args);
      throw Error(`Unexpected mutation ${ref}`);
    } };
    await assert.rejects(didit.adminReview.handler(actionCtx, { token: racingToken, bookingId: booking._id, decision: "decline", note: "Reviewed provider decision" }), /unauthorized/);
    assert.equal(booking.idVerifyStatus, "manual_review", "revocation during provider read prevents reconciliation");
  } finally { global.fetch = originalFetch; }
  console.log("PASS scoped attachment access and revocation-before-Didit-commit fixtures; readiness mocked only for transaction tests.");
})().catch(error => { console.error(error); process.exitCode = 1; });
