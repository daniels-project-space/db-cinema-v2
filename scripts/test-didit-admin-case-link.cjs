const assert = require("node:assert/strict");
const { load, put } = require("./lib/rentalTestHarness.cjs");

process.env.ADMIN_TOKEN = "didit-link-admin-fixture";
process.env.DIDIT_API_KEY = "didit-key-fixture";
process.env.DIDIT_WORKFLOW_ID = "workflow-fixture";
process.env.DIDIT_WEBHOOK_SECRET = "webhook-fixture";
process.env.DIDIT_APPLICATION_ID = "application-fixture";
process.env.DIDIT_ENVIRONMENT = "sandbox";
delete process.env.ADMIN_SESSION_DIDIT_REVIEW_V2;

const { adminVerificationLink, refreshProgress } = load("convex/didit.ts");
const booking = put("bookings", {
  _id: "bookings-didit-link-fixture",
  status: "pending_verification",
  idVerifyStatus: "manual_review",
  verificationProvider: "didit",
  diditSessionId: "session-fixture-123",
  guestEmail: "renter@example.invalid",
});
let currentBooking = booking;
let decision = {
  session_id: booking.diditSessionId,
  session_kind: "user",
  vendor_data: `dbc-booking-${booking._id}`,
  workflow_id: process.env.DIDIT_WORKFLOW_ID,
  status: "In Review",
  session_url: "https://verify.didit.me/session/session-fixture-123",
  contact_details: { email: booking.guestEmail },
  warnings: [{ feature: "POA", risk: "ADDRESS_MISMATCH", short_description: "Address differs", long_description: "<strong>Address</strong> does not match the document.", additional_data: { document_number: "private" } }],
  id_verifications: [{ document_number: "private" }],
};
let fetchCount = 0;
let fetchStatus = 200;
global.fetch = async () => {
  fetchCount++;
  return new Response(JSON.stringify(decision), { status: fetchStatus, headers: { "content-type": "application/json" } });
};

const ctx = {
  runMutation: async (reference, args) => {
    if (reference === "adminAuth.assertAdminInternal" || reference === "adminAccountSessionV2.authorizeDiditReview") {
      if (args.token !== process.env.ADMIN_TOKEN) throw new Error("unauthorized");
      return;
    }
    if (reference === "bookings.claimDiditProgressRefresh") return true;
    if (reference === "bookings.flagDiditProcessingFailure") return;
    throw new Error(`Unexpected mutation ${reference}`);
  },
  runQuery: async (reference, args) => {
    assert.equal(reference, "bookings.verificationAccess");
    return currentBooking?._id === args.bookingId ? currentBooking : null;
  },
};

(async () => {
  const args = { token: process.env.ADMIN_TOKEN, bookingId: booking._id };
  const result = await adminVerificationLink.handler(ctx, args);
  assert.deepEqual(result, {
    url: decision.session_url,
    issues: [{ feature: "POA", risk: "ADDRESS_MISMATCH", summary: "Address differs", detail: "Address does not match the document." }],
  }, "only the provider URL and sanitized warnings are returned to the admin");
  assert.equal(JSON.stringify(result).includes("private"), false, "document data never enters the browser response");
  assert.equal(fetchCount, 1);
  const originalDecision = decision;
  decision = { ...decision, warnings: [], decision_trace: { status_warnings: [{ feature: 'POA', risk: 'DOCUMENT_BLURRED', short_description: '<b>Blurry bill</b>', long_description: 'Upload a clearer bill.', additional_data: { document_number: 'private' } }] },
    id_verifications: [{ document_number: 'private', warnings: [{ risk: 'IMAGE_TOO_BLURRY' }] }],
    poa_verifications: [{ address: 'PRIVATE ADDRESS', warnings: [{ risk: 'ADDRESS_MISMATCH', short_description: '<i>Address mismatch</i>', long_description: 'Please inspect the address.' }] }],
    face_matches: [{ source_image: 'https://private.invalid/portrait', warnings: [{ risk: 'FACE_MISMATCH', short_description: 'Face match needs review' }] }] };
  const nested = await adminVerificationLink.handler(ctx, args);
  assert.deepEqual(nested.issues, [
    { feature: 'POA', risk: 'DOCUMENT_BLURRED', summary: 'Blurry bill', detail: 'Upload a clearer bill.' },
    { feature: 'Photo ID', risk: 'IMAGE_TOO_BLURRY', summary: 'IMAGE TOO BLURRY', detail: '' },
    { feature: 'Face match', risk: 'FACE_MISMATCH', summary: 'Face match needs review', detail: '' },
    { feature: 'Proof of address', risk: 'ADDRESS_MISMATCH', summary: 'Address mismatch', detail: 'Please inspect the address.' },
  ], 'decision-trace and individual check warnings appear without raw documents or identity data');
  assert.doesNotMatch(JSON.stringify(nested), /PRIVATE ADDRESS|private\.invalid|document_number/);
  decision = originalDecision;

  const beforeUnauthorized = fetchCount;
  await assert.rejects(adminVerificationLink.handler(ctx, { ...args, token: "wrong" }), /unauthorized/);
  assert.equal(fetchCount, beforeUnauthorized, "unauthorized callers never contact Didit");

  currentBooking = { ...booking, idVerifyStatus: "verified" };
  await assert.rejects(adminVerificationLink.handler(ctx, args), /open Didit review/);
  currentBooking = booking;

  decision = { ...decision, vendor_data: "dbc-booking-another-rental" };
  await assert.rejects(adminVerificationLink.handler(ctx, args), /does not match this rental/);
  decision = { ...decision, vendor_data: `dbc-booking-${booking._id}` };

  decision = { ...decision, workflow_id: "another-workflow" };
  await assert.rejects(adminVerificationLink.handler(ctx, args), /workflow does not match/);
  decision = { ...decision, workflow_id: process.env.DIDIT_WORKFLOW_ID };

  decision = { ...decision, session_url: "https://attacker.example/session/session-fixture-123" };
  await assert.rejects(adminVerificationLink.handler(ctx, args), /valid verification link/);
  decision = { ...decision, session_url: "https://verify.didit.me/session/session-fixture-123" };

  process.env.ADMIN_SESSION_DIDIT_REVIEW_V2 = "enabled";
  const modernAuth = await adminVerificationLink.handler(ctx, args);
  assert.deepEqual(modernAuth, result, "the scoped admin-session permission also works");
  const appId = process.env.DIDIT_APPLICATION_ID;
  delete process.env.DIDIT_APPLICATION_ID;
  await assert.rejects(adminVerificationLink.handler(ctx, args), /Didit is not configured.*API key, workflow, application ID, webhook secret and environment/,
    "admin errors identify missing provider configuration instead of displaying a customer checkout prompt");
  process.env.DIDIT_APPLICATION_ID = appId;
  fetchStatus = 403;
  await assert.rejects(adminVerificationLink.handler(ctx, args), /Didit denied the session read.*session-read permission.*no decision was changed/,
    "provider permission errors point admins to the server key scope instead of asking them to retry blindly");
  await assert.rejects(refreshProgress.handler(ctx, { bookingId: booking._id, accountToken: process.env.ADMIN_TOKEN, admin: true }),
    /Didit denied the session read.*session-read permission.*no decision was changed/,
    "admin refresh surfaces the same actionable provider permission error without changing verification state");
  fetchStatus = 404;
  await assert.rejects(adminVerificationLink.handler(ctx, args), /Didit returned 404.*Check the session ID in Didit Business Console.*not approved or reset/,
    "a stale session is identified distinctly and never treated as an approval or reset");
  fetchStatus = 422;
  await assert.rejects(adminVerificationLink.handler(ctx, args), /Didit rejected the session read \(HTTP 422\).*Check the session and workflow.*no decision was changed/,
    "other provider read failures tell admins to inspect the bound session without mutating the rental");
  console.log("PASS Didit admin case link: authenticated, bound to the open rental/workflow, allowlisted URL only.");
})().catch((error) => { console.error(error); process.exitCode = 1; });
