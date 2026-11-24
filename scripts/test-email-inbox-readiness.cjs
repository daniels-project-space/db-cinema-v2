const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { load, db, put } = require("./lib/rentalTestHarness.cjs");
const { buildGafferRenterBookingFacts } = load("shared/gafferBookingContext.ts");
const { TRAFALGAR_PICKUP_ADDRESS, TRAFALGAR_PICKUP_INSTRUCTIONS, LEO_SUPPORT_PHONE } = load("shared/pickupLocation.ts");

const adminInboxUi = fs.readFileSync(path.join(__dirname, "../src/components/admin/RentalInbox.tsx"), "utf8");
assert.match(adminInboxUi, /replyConfigured\s*\?\s*"Configured"\s*:\s*"Needs setup"/, "admin status describes configuration, not verified delivery");
assert.match(adminInboxUi, /live delivery still needs a test/i, "admin status does not imply provider or forwarding delivery was tested");
assert.doesNotMatch(adminInboxUi, /"Sending ready"/, "configured credentials are not presented as proof of live sending readiness");

const env = ["ADMIN_TOKEN", "INBOUND_EMAIL_DOMAIN", "INBOUND_REPLY_ADDRESS", "INBOUND_EMAIL_SECRET", "RESEND_FROM", "RESEND_API_KEY"];
const saved = Object.fromEntries(env.map(key => [key, process.env[key]]));
process.env.ADMIN_TOKEN = "email-inbox-fixture";
process.env.INBOUND_EMAIL_DOMAIN = "inbound.example.invalid";
process.env.RESEND_API_KEY = "resend-test-only";
process.env.RESEND_FROM = "DB Cinema Rentals <bookings@dbcinemarentals.com>";
process.env.INBOUND_REPLY_ADDRESS = "support@resend-inbox.example.invalid";
process.env.INBOUND_EMAIL_SECRET = "email-inbox-secret-fixture";

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
  assert.equal(disconnected.replyToAddress, "support@resend-inbox.example.invalid", "generic outbound replies use the central inbox route when configured");
  assert.equal(disconnected.inboundForwardingAddress, "support@resend-inbox.example.invalid", "the admin sees the same route customers reply to");

  delete process.env.INBOUND_REPLY_ADDRESS;
  const staleDomainOnly = await inbox.adminThread.handler(ctx, args);
  assert.equal(staleDomainOnly.replyConfigured, false, "the retired INBOUND_EMAIL_DOMAIN fallback cannot mark mail ready");
  assert.equal(staleDomainOnly.replySetupStatus, "missing_reply_route");
  assert.equal(staleDomainOnly.inboundForwardingAddress, null);
  let staleRouteCalls = 0;
  await assert.rejects(inbox.sendGafferFollowUp.handler({
    runMutation: async () => { staleRouteCalls++; return { state: "claimed" }; },
    runAction: async () => { staleRouteCalls++; return { sent: true }; },
  }, { email: "renter@example.invalid", name: "Renter", subject: "Call follow-up", text: "Details", replyKey: "abcdef0123456789abcdef01" }), /reply route is not configured/);
  assert.equal(staleRouteCalls, 0, "a new follow-up is not prepared or sent through the unverified legacy domain");
  process.env.INBOUND_REPLY_ADDRESS = "support@resend-inbox.example.invalid";

  let sentReply, finalizedReply;
  const replyCtx = {
    runMutation: async (ref, payload) => {
      if (ref.endsWith("claimAutomaticReply")) return { state: "claimed", outboundId: "email_messages:out", deliveryKey: "fixture-key", text: payload.text, humanRequested: payload.humanRequested, thread: { email: "renter@example.invalid", subject: "Rental question", replyKey: "a".repeat(24) }, inbound: { messageId: "<inbound@example.invalid>", references: [] } };
      if (ref.endsWith("finishAutomaticReply")) finalizedReply = payload;
      return { ok: true };
    },
    runAction: async (_ref, payload) => { sentReply = payload; return { sent: true, messageId: "<outbound@example.invalid>", resendEmailId: "resend-email-fixture" }; },
  };
  const sent = await inbox.sendAssistantReply.handler(replyCtx, {
    secret: process.env.INBOUND_EMAIL_SECRET,
    threadId: "email_threads:fixture",
    inboundId: "email_messages:in",
    text: "I checked the information available and can answer your question here. If you still need the team, use this form:\n\n[Open contact form](https://dbcinemarentals.com/contact)",
    humanRequested: false,
  });
  assert.equal(sent.ok, true);
  assert.match(sentReply.html, /href="https:\/\/dbcinemarentals\.com\/contact" style="display:inline-block/,
    "an explicit Gaffer contact handoff in email renders as a clear, clickable button rather than pasted URL text");
  assert.match(sentReply.html, />Open contact form<\/a>/);
  assert.match(sentReply.html, /I checked the information available and can answer your question here\./,
    "the helpful answer remains before the optional contact CTA in the sent email");
  assert.equal(sentReply.replyTo, `gaffer+${thread.replyKey}@resend-inbox.example.invalid`, "Gaffer replies return through the same private Resend thread alias");
  assert.equal(sentReply.to, "renter@example.invalid");
  assert.equal(sentReply.deliveryKey, "fixture-key");
  assert.equal(finalizedReply.resendEmailId, "resend-email-fixture", "the Resend message ID reaches the durable central thread finalizer");

  const legacyThread = put("email_threads", {
    email: "legacy-renter@example.invalid",
    subject: "Older email conversation",
    status: "open",
    updatedAt: Date.now(),
    lastAt: Date.now(),
  });
  let legacyReplyPayload;
  const legacyReplyContext = {
    runQuery: async (_ref, queryArgs) => inbox.replyContext.handler({ db }, queryArgs),
    runMutation: async (ref, mutationArgs) => {
      const name = String(ref).split(".").at(-1);
      if (name === "reserveOwnerReply") return inbox.reserveOwnerReply.handler({ db }, mutationArgs);
      if (name === "finishOwnerReply") return inbox.finishOwnerReply.handler({ db, scheduler: { runAfter: async () => {} } }, mutationArgs);
      if (name === "markSendFailed") return inbox.markSendFailed.handler({ db }, mutationArgs);
      throw new Error(`Unexpected mutation: ${String(ref)}`);
    },
    runAction: async (_ref, payload) => {
      legacyReplyPayload = payload;
      return { sent: true, messageId: "<legacy-reply@example.invalid>" };
    },
  };
  const legacyReply = await inbox.sendOwnerReply.handler(legacyReplyContext, {
    token: process.env.ADMIN_TOKEN,
    threadId: legacyThread._id,
    replyId: "legacy-thread-reply-123456",
    text: "We are checking this for you.",
  });
  assert.equal(legacyReply.ok, true);
  const updatedLegacyThread = await db.get(legacyThread._id);
  assert.match(updatedLegacyThread.replyKey, /^[a-f0-9]{24}$/i, "legacy threads receive a private capability before a team reply is sent");
  assert.equal(legacyReplyPayload.replyTo, `gaffer+${updatedLegacyThread.replyKey}@resend-inbox.example.invalid`, "manual inbox replies preserve the same capability-based thread routing");

  const denied = await inbox.adminThread.handler(ctx, { ...args, token: "wrong-token" });
  assert.equal(denied.authorized, false);
  assert.equal(denied.inboundForwardingAddress, undefined, "forwarding configuration is never returned to an unauthorized client");

  process.env.RESEND_FROM = "DB Cinema Rentals <support@unverified.example.invalid>";
  const wrongSender = await inbox.adminThread.handler(ctx, args);
  assert.equal(wrongSender.replyConfigured, false, "A sender outside the verified business domain cannot appear ready");
  assert.equal(wrongSender.replySetupStatus, "missing_business_sender");

  const inboxResult = await inbox.adminInbox.handler(ctx, { token: process.env.ADMIN_TOKEN, limit: 10 });
  assert.equal(inboxResult.outboundSenderAddress, null, "Admin list never presents an invalid sender as configured");
  assert.equal(inboxResult.replyToAddress, "support@resend-inbox.example.invalid");
  const deniedInbox = await inbox.adminInbox.handler(ctx, { token: "wrong-token", limit: 10 });
  assert.equal(deniedInbox.inboundForwardingAddress, undefined, "forwarding configuration is never returned to an unauthorized client");
  assert.equal(deniedInbox.replyToAddress, undefined, "reply routing details are never returned to an unauthorized client");

  const renterEmail = "verified.renter@example.invalid";
  const renter = put("accounts", { email: renterEmail, emailVerifiedAt: Date.now(), blockedAt: null, emailVerificationRequired: false, name: "Verified Renter" });
  const rental = put("bookings", {
    accountId: renter._id,
    guestEmail: renterEmail,
    status: "active",
    paidConfirmedAt: Date.now() - 91 * 86400000,
    verificationProvider: "didit",
    idVerificationSource: "didit",
    idVerifyStatus: "verified",
    idVerifiedAt: Date.now() - 91 * 86400000,
    verificationExpiresAt: Date.now() - 1,
    verificationChecks: { identity: "approved", selfie: "approved", address: "approved" },
    fulfilment: "pickup",
    lineItems: [{ title: "Verified camera", start: Date.UTC(2030, 0, 1), end: Date.UTC(2030, 0, 2), qty: 1 }],
  });
  const rentalThread = put("email_threads", {
    email: renterEmail,
    subject: "Pickup details",
    replyKey: "b".repeat(24),
    accountId: renter._id,
    verifiedRenterEmail: renterEmail,
    bookingId: rental._id,
    updatedAt: Date.now(),
  });
  const oldPickupMessage = `Pickup address: ${TRAFALGAR_PICKUP_ADDRESS}\n${TRAFALGAR_PICKUP_INSTRUCTIONS}\nLeo: ${LEO_SUPPORT_PHONE}`;
  put("email_messages", { threadId: rentalThread._id, bookingId: rental._id, direction: "out", state: "sent", chatSender: "owner", text: oldPickupMessage, at: Date.now() - 1000 });
  const inbound = put("email_messages", {
    threadId: rentalThread._id,
    bookingId: rental._id,
    direction: "in",
    state: "received",
    replyCapabilityVerified: true,
    sender: renterEmail,
    text: "Where do I collect?",
    at: Date.now(),
  });
  const claimedRental = await inbox.claimInbound.handler({ db }, { secret: process.env.INBOUND_EMAIL_SECRET, inboundId: inbound._id, humanRequested: false });
  assert.equal(claimedRental.state, "claimed");
  assert.deepEqual(claimedRental.rentalContext.booking.handoverDetails, {
    phone: LEO_SUPPORT_PHONE,
    pickupAddress: TRAFALGAR_PICKUP_ADDRESS,
    returnAddress: TRAFALGAR_PICKUP_ADDRESS,
    pickupInstructions: TRAFALGAR_PICKUP_INSTRUCTIONS,
    fulfilment: "pickup",
  }, "an approved active rental keeps its booking-authorized handover details after the reusable badge expires");
  assert.equal(claimedRental.history[0].content, oldPickupMessage, "verified email history retains handover instructions for the same authorized active rental");
  const expiredRentalFacts = buildGafferRenterBookingFacts([claimedRental.rentalContext.booking])[0];
  assert.match(expiredRentalFacts, /passed for this rental; re-verification is required for future rentals/);
  assert.match(expiredRentalFacts, /Approved handover details: pickup/);

  const nextRental = put("bookings", {
    accountId: renter._id,
    guestEmail: renterEmail,
    status: "pending_verification",
    paidConfirmedAt: Date.now(),
    verificationProvider: "didit",
    idVerificationSource: "didit",
    idVerifyStatus: "verified",
    idVerifiedAt: Date.now() - 91 * 86400000,
    verificationExpiresAt: Date.now() - 1,
    verificationChecks: { identity: "approved", selfie: "approved", address: "approved" },
    fulfilment: "pickup",
    lineItems: [{ title: "New camera", start: Date.UTC(2030, 1, 1), end: Date.UTC(2030, 1, 2), qty: 1 }],
  });
  const nextThread = put("email_threads", {
    email: renterEmail,
    subject: "New rental verification",
    replyKey: "c".repeat(24),
    accountId: renter._id,
    verifiedRenterEmail: renterEmail,
    bookingId: nextRental._id,
    updatedAt: Date.now(),
  });
  put("email_messages", { threadId: nextThread._id, bookingId: nextRental._id, direction: "out", state: "sent", chatSender: "owner", text: oldPickupMessage, at: Date.now() - 1000 });
  const nextInbound = put("email_messages", {
    threadId: nextThread._id,
    bookingId: nextRental._id,
    direction: "in",
    state: "received",
    replyCapabilityVerified: true,
    sender: renterEmail,
    text: "Where do I collect?",
    at: Date.now(),
  });
  const claimedNextRental = await inbox.claimInbound.handler({ db }, { secret: process.env.INBOUND_EMAIL_SECRET, inboundId: nextInbound._id, humanRequested: false });
  assert.equal(claimedNextRental.rentalContext.booking.handoverDetails, undefined, "an expired reusable pass does not approve handover for a new pending rental");
  assert.match(claimedNextRental.history[0].content, /handover details hidden until rental is ready/);
  assert.doesNotMatch(JSON.stringify(claimedNextRental.rentalContext.booking), /Trafalgar Square|Waterstones|\+44/);
  const nextRentalFacts = buildGafferRenterBookingFacts([claimedNextRental.rentalContext.booking])[0];
  assert.match(nextRentalFacts, /previously passed but expired; re-verification is required/);
  assert.doesNotMatch(nextRentalFacts, /Approved handover details|contact Leo/);

  console.log("PASS email inbox readiness: configured central reply routing, admin-only forwarding details, and domain-validated Resend business replies");
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
}).finally(() => {
  for (const key of env) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
});
