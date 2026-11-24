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
    let providerCalls = 0, resubmissionDetailsReads = 0, websiteDecision, providerBookingId = booking._id;
    let providerStatus = "In Review", conflictNextPatch = false;
    global.fetch = async (_url, options = {}) => {
      providerCalls++;
      if (String(_url).endsWith("/decision/?include=resubmissions")) resubmissionDetailsReads++;
      if (String(_url).endsWith("/decision-email-preview/")) return new Response(JSON.stringify({ recipient: account.email, language: "en", will_be_sent: true, preview_token: "fixture-preview-token" }), { status: 200 });
      if (String(_url).endsWith("/resubmission-preview/")) return new Response(JSON.stringify({ recipient: account.email, requires_user_action: true, language: "en", will_be_sent: true, preview_token: "fixture-resubmit-token", nodes_to_resubmit: [{ node_id: "feature_poa_1", feature: "POA" }] }), { status: 200 });
      if (options.method === "PATCH") {
        const body = JSON.parse(options.body);
        if (body.new_status === "Resubmitted") {
          assert.deepEqual(body.nodes_to_resubmit, [{ node_id: "feature_poa_1", feature: "POA" }]);
        }
        assert.equal(body.send_email, false, "the website owns post-decision renter email to avoid a duplicate Didit email");
        assert.equal(body.email_address, undefined);
        assert.equal(body.email_preview_token, undefined);
        if (conflictNextPatch) { conflictNextPatch = false; return new Response("stale preview", { status: 409 }); }
        providerStatus = body.new_status;
        return new Response(JSON.stringify({ session_id: String(_url).includes("fixture-resubmit-session") ? "fixture-resubmit-session" : "fixture-session" }), { status: 200 });
      }
      const approved = providerStatus === "Approved";
      return new Response(JSON.stringify({ session_id: String(_url).includes("fixture-resubmit-session") ? "fixture-resubmit-session" : "fixture-session", session_kind: "user", workflow_id: "fixture-workflow", vendor_data: `dbc-booking-${providerBookingId}`, contact_details: { email: account.email }, status: providerStatus, ...(approved ? { id_verifications: [{ status: "Approved" }], liveness_checks: [{ status: "Approved" }], face_matches: [{ status: "Approved" }] } : {}), poa_verifications: [{ node_id: "feature_poa_1", status: approved ? "Approved" : "Declined" }] }), { status: 200 });
    };
    const actionCtx = { ...ctx,
      runQuery: async ref => { if (String(ref).replaceAll(":", ".") === "bookings.verificationAccess") return booking; throw Error(`unexpected query ${ref}`); },
      runMutation: async (ref, args) => {
        const name = String(ref).replaceAll(":", ".");
        if (name === "adminAccountSessionV2.authorizeDiditReview") return access.authorizeDiditReview.handler(ctx, args);
        if (name === "diditReviewClaims.claim") return reviewClaims.claim.handler(ctx, args);
        if (name === "diditReviewClaims.release") return reviewClaims.release.handler(ctx, args);
        if (name === "diditReviewClaims.markUnknown") return reviewClaims.markUnknown.handler(ctx, args);
        if (name === "diditReviewClaims.reconcileConfirmed") return reviewClaims.reconcileConfirmed.handler(ctx, args);
        if (name === "bookings.claimDiditProgressRefresh") return true;
        if (name === "bookings.setDiditResult") { websiteDecision = args; await ctx.db.patch(args.bookingId, { idVerifyStatus: args.status }); return true; }
        throw Error(`unexpected mutation ${ref}`);
      },
    };
    await assert.rejects(didit.adminReview.handler(actionCtx, { token: readToken, bookingId: booking._id, decision: "approve", note: "Reviewed provider decision", requestId: "verification-review-read-0001" }), /unauthorized/);
    assert.equal(providerCalls, 0, "read-only sessions cannot make provider decisions");
    assert.equal(booking.idVerifyStatus, "manual_review", "unauthorized decisions leave the rental unchanged");
    const conflictBooking = harness.put("bookings", { accountId: account._id, guestEmail: account.email, verificationProvider: "didit", diditSessionId: "fixture-session", idVerifyStatus: "manual_review", status: "confirmed" });
    providerBookingId = conflictBooking._id;
    const conflictCtx = { ...actionCtx, runQuery: async ref => { if (String(ref).replaceAll(":", ".") === "bookings.verificationAccess") return conflictBooking; throw Error(`unexpected query ${ref}`); } };
    conflictNextPatch = true;
    await assert.rejects(didit.adminReview.handler(conflictCtx, { token: reviewToken, bookingId: conflictBooking._id, decision: "decline", note: "Provider status changed elsewhere", requestId: "verification-review-race-0001" }), /case changed/);
    assert.equal(conflictBooking.idVerifyStatus, "manual_review", "a stale preview cannot change the website decision");
    assert.equal(conflictBooking.diditReviewClaim?.outcomeUnknown, true, "an uncertain provider decision stays locked for reconciliation");
    assert.equal(websiteDecision, undefined, "a stale preview cannot issue rental confirmation/rejection effects");
    providerBookingId = booking._id;
    const result = await didit.adminReview.handler(actionCtx, { token: reviewToken, bookingId: booking._id, decision: "approve", note: "Reviewed provider decision", requestId: "verification-review-write-0001" });
    assert.deepEqual(result, { status: "verified", providerStatus: "Approved" });
    assert.equal(providerCalls, 6, "stale 409 decisions are re-read, and approval updates Didit once then verifies its final decision without duplicate provider email");
    assert.equal(websiteDecision?.providerStatus, "Approved", "the confirmed Didit result uses the normal website verification mutation");
    const resubmitBooking = harness.put("bookings", { accountId: account._id, guestEmail: account.email, verificationProvider: "didit", diditSessionId: "fixture-resubmit-session", idVerifyStatus: "manual_review", status: "confirmed" });
    providerBookingId = resubmitBooking._id;
    providerStatus = "In Review";
    websiteDecision = undefined;
    const resubmitCtx = { ...actionCtx, runQuery: async ref => { if (String(ref).replaceAll(":", ".") === "bookings.verificationAccess") return resubmitBooking; throw Error(`unexpected query ${ref}`); } };
    const resubmitted = await didit.adminReview.handler(resubmitCtx, { token: reviewToken, bookingId: resubmitBooking._id, decision: "resubmit", note: "Please send a clearer proof of address", requestId: "verification-resubmit-0001" });
    assert.deepEqual(resubmitted, { status: "requires_input", providerStatus: "Resubmitted" });
    assert.equal(providerCalls, 11, "resubmission previews exact failed steps, conditionally updates Didit and verifies the final decision");
    assert.equal(resubmissionDetailsReads, 1, "a Resubmitted decision without details is re-read with Didit's resubmission data enabled");
    assert.equal(websiteDecision?.status, "requires_input", "resubmission returns the rental to the renter's verification step");
    providerBookingId = booking._id;
    providerStatus = "In Review";
    websiteDecision = undefined;
    const callsBeforeRefresh = providerCalls;
    await assert.rejects(didit.refreshProgress.handler(actionCtx, { bookingId: booking._id, accountToken: readToken, admin: true }), /unauthorized/);
    assert.equal(providerCalls, callsBeforeRefresh, "read-only sessions cannot refresh a provider decision");
    const refresh = await didit.refreshProgress.handler(actionCtx, { bookingId: booking._id, accountToken: reviewToken, admin: true });
    assert.deepEqual(refresh, { status: "updated" }, "verification-write sessions can refresh Didit status through the V2 authorization contract");
    assert.equal(websiteDecision?.providerStatus, "In Review", "authorized refresh syncs the current Didit state to the rental");
  } finally { global.fetch = originalFetch; }
  console.log("PASS scoped attachment access and Didit review/refresh: read-only sessions denied, verification-write session updates Didit and syncs the rental.");
})().catch(error => { console.error(error); process.exitCode = 1; });
