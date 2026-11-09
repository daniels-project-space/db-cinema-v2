const assert = require("node:assert/strict");
const { load, db, put } = require("./lib/rentalTestHarness.cjs");

const env = ["ADMIN_TOKEN", "INBOUND_EMAIL_DOMAIN", "INBOUND_REPLY_ADDRESS", "RESEND_FROM", "RESEND_API_KEY"];
const saved = Object.fromEntries(env.map(key => [key, process.env[key]]));
process.env.ADMIN_TOKEN = "email-inbox-fixture";
process.env.INBOUND_EMAIL_DOMAIN = "inbound.example.invalid";
process.env.RESEND_API_KEY = "resend-test-only";
process.env.RESEND_FROM = "DB Cinema Rentals <bookings@dbcinemarentals.com>";
process.env.INBOUND_REPLY_ADDRESS = "support@resend-inbox.example.invalid";

const inbox = load("convex/emailInbox.ts");
const thread = put("email_threads", {
  email: "renter@example.invalid",
  subject: "Rental question",
  replyKey: "a".repeat(24),
  updatedAt: Date.now(),
});

(async () => {
  const args = { token: process.env.ADMIN_TOKEN, threadId: thread._id };
  const ctx = { db: Object.create(db) };
  ctx.db.get = db.get.bind(db);
  ctx.db.query = (table) => table === "email_threads"
    ? { withIndex: () => ({ order: () => ({ take: async () => [] }) }) }
    : db.query(table);

  const disconnected = await inbox.adminThread.handler(ctx, args);
  assert.equal(disconnected.replyConfigured, true, "A configured Resend business sender enables website replies without borrowing ChatGPT Gmail authorization");
  assert.equal(disconnected.replySetupStatus, "ready");
  assert.equal(disconnected.outboundSenderAddress, "bookings@dbcinemarentals.com");
  assert.equal(disconnected.inboundForwardingAddress, "support@resend-inbox.example.invalid", "only the admin email thread receives the configured Gmail-forwarding address");

  const denied = await inbox.adminThread.handler(ctx, { ...args, token: "wrong-token" });
  assert.equal(denied.authorized, false);
  assert.equal(denied.inboundForwardingAddress, undefined, "forwarding configuration is never returned to an unauthorized client");

  process.env.RESEND_FROM = "DB Cinema Rentals <support@unverified.example.invalid>";
  const wrongSender = await inbox.adminThread.handler(ctx, args);
  assert.equal(wrongSender.replyConfigured, false, "A sender outside the verified business domain cannot appear ready");
  assert.equal(wrongSender.replySetupStatus, "missing_business_sender");

  const inboxResult = await inbox.adminInbox.handler(ctx, { token: process.env.ADMIN_TOKEN, limit: 10 });
  assert.equal(inboxResult.outboundSenderAddress, null, "Admin list never presents an invalid sender as configured");
  const deniedInbox = await inbox.adminInbox.handler(ctx, { token: "wrong-token", limit: 10 });
  assert.equal(deniedInbox.inboundForwardingAddress, undefined, "forwarding configuration is never returned to an unauthorized client");

  console.log("PASS email inbox readiness: admin-only routing details and domain-validated Resend business replies");
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
}).finally(() => {
  for (const key of env) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
});
