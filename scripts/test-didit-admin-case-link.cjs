const assert = require("node:assert/strict");
const { load, put } = require("./lib/rentalTestHarness.cjs");

process.env.ADMIN_TOKEN = "didit-link-admin-fixture";
process.env.DIDIT_API_KEY = "didit-key-fixture";
process.env.DIDIT_WORKFLOW_ID = "workflow-fixture";
process.env.DIDIT_WEBHOOK_SECRET = "webhook-fixture";
process.env.DIDIT_APPLICATION_ID = "application-fixture";
process.env.DIDIT_ENVIRONMENT = "sandbox";
delete process.env.ADMIN_SESSION_DIDIT_REVIEW_V2;

const { adminVerificationLink } = load("convex/didit.ts");
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
global.fetch = async () => {
  fetchCount++;
  return new Response(JSON.stringify(decision), { status: 200, headers: { "content-type": "application/json" } });
};

const ctx = {
  runMutation: async (reference, args) => {
    if (reference === "adminAuth.assertAdminInternal" || reference === "adminAccountSessionV2.authorizeDiditReview") {
      if (args.token !== process.env.ADMIN_TOKEN) throw new Error("unauthorized");
      return;
    }
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
  console.log("PASS Didit admin case link: authenticated, bound to the open rental/workflow, allowlisted URL only.");
})().catch((error) => { console.error(error); process.exitCode = 1; });
