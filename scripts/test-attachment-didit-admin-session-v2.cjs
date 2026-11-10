const assert = require("node:assert/strict");
const { webcrypto, createHash } = require("node:crypto");
const harness = require("./lib/rentalTestHarness.cjs");
global.crypto ??= webcrypto;
const access = harness.load("convex/adminAccountSessionV2.ts");
harness.setMock("./adminAccountSessionV2", { ...access, adminSessionMigrationReady: () => true });
const attachments = harness.load("convex/chatAttachments.ts");
const didit = harness.load("convex/didit.ts");
const reviewClaims = harness.load("convex/diditReviewClaims.ts");
const sessions = harness.load("convex/adminSessionsV2.ts");
const hash = value => createHash("sha256").update(value).digest("hex");
const identity = "https://identity.example|attachment-fixture";
const readToken = "a".repeat(64), writeToken = "b".repeat(64);
const account = harness.put("accounts", { email: "attachment@example.invalid" });
const booking = harness.put("bookings", { accountId: account._id, guestEmail: account.email, verificationProvider: "didit", diditSessionId: "fixture-session", idVerifyStatus: "manual_review", status: "confirmed" });
const ctx = { db: harness.db, auth: { getUserIdentity: async () => ({ tokenIdentifier: identity }) } };
process.env.ADMIN_SESSION_ATTACHMENTS_V2 = "enabled";
process.env.ADMIN_SESSION_SCOPES_V2 = JSON.stringify({ [identity]: ["customers:read", "customers:write", "verification:write"] });
process.env.ADMIN_TOKEN = "legacy-attachment-fixture";

(async () => {
  for (const [token, scope] of [[readToken, "customers:read"], [writeToken, "customers:write"]])
    await sessions.createSession.handler(ctx, { tokenDigest: hash(token), principalId: `admin:${hash(identity)}`, scopes: [scope], expiresAt: Date.now() + 60_000 });
  const upload = { token: writeToken, admin: true, accountId: account._id, marker: `application/vnd.dbcinema.chat-${"1".repeat(32)}`, requestKey: "2".repeat(32) };
  await assert.rejects(attachments.reserve.handler(ctx, { ...upload, token: readToken }), /unauthorized/);
  await assert.rejects(attachments.reserve.handler(ctx, { ...upload, token: process.env.ADMIN_TOKEN }), /unauthorized/);
  assert.equal((await attachments.reserve.handler(ctx, upload)).status, "ready");
  await assert.rejects(attachments.download.handler(ctx, { ...upload, id: "missing" }), /unauthorized/);
  await assert.rejects(attachments.download.handler(ctx, { ...upload, token: readToken, id: "missing" }), /Attachment unavailable/);
  assert(harness.tables.get("admin_audit_log").some(row => row.fn === "chatAttachments.reserve"));
  const racingToken = "d".repeat(64), reviewToken = "c".repeat(64);
  process.env.ADMIN_SESSION_DIDIT_REVIEW_V2 = "enabled";
  process.env.DIDIT_API_KEY = "fixture"; process.env.DIDIT_WORKFLOW_ID = "fixture-workflow";
  process.env.DIDIT_WEBHOOK_SECRET = "fixture"; process.env.DIDIT_APPLICATION_ID = "fixture"; process.env.DIDIT_ENVIRONMENT = "sandbox";
  await sessions.createSession.handler(ctx, { tokenDigest: hash(reviewToken), principalId: `admin:${hash(identity)}`, scopes: ["verification:write"], expiresAt: Date.now() + 60_000 });
  const originalFetch = global.fetch;
  try {
    let providerCalls = 0, websiteDecision;
    let providerStatus = "In Review";
    global.fetch = async (_url, options = {}) => {
      providerCalls++;
      if (options.method === "PATCH") { providerStatus = JSON.parse(options.body).new_status; return new Response(JSON.stringify({ session_id: "fixture-session" }), { status: 200 }); }
      return new Response(JSON.stringify({ session_id: "fixture-session", session_kind: "user", workflow_id: "fixture-workflow", vendor_data: `dbc-booking-${booking._id}`, contact_details: { email: account.email }, status: providerStatus }), { status: 200 });
    };
    const actionCtx = { ...ctx,
      runQuery: async ref => { if (String(ref).replaceAll(":", ".") === "bookings.verificationAccess") return booking; throw Error(`unexpected query ${ref}`); },
      runMutation: async (ref, args) => {
        const name = String(ref).replaceAll(":", ".");
        if (name === "adminAccountSessionV2.authorizeDiditReview") return access.authorizeDiditReview.handler(ctx, args);
        if (name === "diditReviewClaims.claim") return reviewClaims.claim.handler(ctx, args);
        if (name === "diditReviewClaims.release") return reviewClaims.release.handler(ctx, args);
        if (name === "bookings.setDiditResult") { websiteDecision = args; return true; }
        throw Error(`unexpected mutation ${ref}`);
      },
    };
    await assert.rejects(didit.adminReview.handler(actionCtx, { token: readToken, bookingId: booking._id, decision: "approve", note: "Reviewed provider decision", requestId: "verification-review-read-0001" }), /unauthorized/);
    assert.equal(providerCalls, 0, "read-only sessions cannot make provider decisions");
    assert.equal(booking.idVerifyStatus, "manual_review", "unauthorized decisions leave the rental unchanged");
    const result = await didit.adminReview.handler(actionCtx, { token: reviewToken, bookingId: booking._id, decision: "approve", note: "Reviewed provider decision", requestId: "verification-review-write-0001" });
    assert.deepEqual(result, { status: "verified", providerStatus: "Approved" });
    assert.equal(providerCalls, 3, "authorized review reads, updates and confirms the Didit session");
    assert.equal(websiteDecision?.providerStatus, "Approved", "the confirmed Didit result uses the normal website verification mutation");
  } finally { global.fetch = originalFetch; }
  console.log("PASS scoped attachment access and Didit manual review: read-only sessions denied, verification-write session updates Didit and syncs the rental.");
})().catch(error => { console.error(error); process.exitCode = 1; });
