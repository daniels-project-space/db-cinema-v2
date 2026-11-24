const assert = require("node:assert/strict");
const h = require("./lib/rentalTestHarness.cjs");

process.env.ADMIN_TOKEN = "fixture-admin";
process.env.INBOUND_EMAIL_SECRET = "fixture-inbound-secret";
process.env.INBOUND_REPLY_ADDRESS = "support@resend-inbox.example.invalid";

let outcome = "sent";
const sends = [];
h.setMock("./mailer", {
  sendBusinessMailTracked: async mail => {
    sends.push(mail);
    if (outcome === "uncertain") return { sent: false, ambiguous: true };
    if (outcome === "failed") return { sent: false, ambiguous: false };
    return { sent: true, ambiguous: false, resendEmailId: `resend-${mail.deliveryKey}` };
  },
});
h.setMock("./adminAuth", { checkAdminToken: token => token === "fixture-admin", assertAdmin: async () => {} });
h.setMock("./rateLimit", { bump: async () => ({ allowed: true }) });
h.setMock("./lib/adminPush", { queueOwnerNotification: async () => {} });
h.setMock("./lib/rentalChat", {
  postRentalMessage: async (_ctx, message) => h.put("messages", { ...message, at: Date.now() })._id,
  accountForToken: async (_ctx, token) => [...h.docs.values()].find(row => row._id === token) ?? null,
  rentalThread: async () => null,
});

const inbox = h.load("convex/emailInbox.ts");
const mailer = h.load("convex/lib/rentalContextEmail.ts");
const account = h.put("accounts", {
  email: "renter@example.invalid",
  emailVerifiedAt: Date.now(),
  name: "Verified renter",
});
const booking = h.put("bookings", {
  accountId: account._id,
  guestEmail: account.email,
  status: "returned",
});
const otherAccount = h.put("accounts", {
  email: "another-renter@example.invalid",
  emailVerifiedAt: Date.now(),
  name: "Another renter",
});
const otherBooking = h.put("bookings", {
  accountId: otherAccount._id,
  guestEmail: otherAccount.email,
  status: "returned",
});
const unverifiedAccount = h.put("accounts", {
  email: "unverified@example.invalid",
  name: "Unverified renter",
});
const unverifiedBooking = h.put("bookings", {
  accountId: unverifiedAccount._id,
  guestEmail: unverifiedAccount.email,
  status: "returned",
});
const guestOnlyBooking = h.put("bookings", {
  guestEmail: "guest-only@example.invalid",
  status: "returned",
});

const ctx = {
  db: h.db,
  runMutation: async (ref, args) => {
    if (String(ref) === "emailInbox.prepareRentalContextEmail") return inbox.prepareRentalContextEmail.handler(ctx, args);
    if (String(ref) === "emailInbox.finishRentalContextEmail") return inbox.finishRentalContextEmail.handler(ctx, args);
    throw new Error(`Unexpected mutation ${ref}`);
  },
};

const message = {
  to: account.email,
  subject: "Your itemised rental assessment",
  html: "<h2>Rental assessment</h2><p>Review the itemised charge in your rental.</p>",
};

(async () => {
  let result = await mailer.sendRentalContextEmail(ctx, booking._id, "rental-security:charge-fixture-1", message);
  assert.deepEqual(result, { sent: true, state: "sent" });
  assert.equal(sends.length, 1);
  const firstMail = sends[0];
  assert.match(firstMail.replyTo, /^gaffer\+[a-f0-9]{24}@resend-inbox\.example\.invalid$/);
  assert.equal(firstMail.deliveryKey, "rental-context:rental-security:charge-fixture-1");

  const outbound = h.tables.get("email_messages").find(row => row.providerId === firstMail.deliveryKey);
  const thread = h.docs.get(outbound.threadId);
  assert.equal(outbound.bookingId, booking._id);
  assert.equal(thread.bookingId, booking._id);
  assert.equal(thread.accountId, account._id);
  assert.equal(thread.verifiedRenterEmail, account.email);
  assert.equal(outbound.resendEmailId, `resend-${firstMail.deliveryKey}`);

  const inbound = await inbox.ingest.handler({ db: h.db }, {
    secret: process.env.INBOUND_EMAIL_SECRET,
    providerId: "provider-reply-to-rental-context-email",
    references: [],
    replyThreadId: thread._id,
    replyCapabilityKey: thread.replyKey,
    from: account.email,
    to: firstMail.replyTo,
    subject: `Re: ${message.subject}`,
    text: "I have a question about this rental assessment.",
  });
  assert.equal(inbound.threadId, thread._id, "reply alias resolves to its exact transactional email thread");
  assert.equal(inbound.bookingId, booking._id, "inbound reply keeps the exact booking association");
  assert.equal(inbound.accountId, account._id);
  const mirroredReply = h.docs.get(h.docs.get(inbound.inboundId).profileMessageId);
  assert.equal(mirroredReply.bookingId, booking._id, "reply is mirrored into the matching renter conversation");

  result = await mailer.sendRentalContextEmail(ctx, booking._id, "rental-security:charge-fixture-1", message);
  assert.deepEqual(result, { sent: true, state: "sent" }, "a sent delivery is idempotent");
  assert.equal(sends.length, 1, "a sent delivery is not resent on retry");

  const wrongRecipient = await mailer.sendRentalContextEmail(ctx, booking._id, "rental-security:charge-wrong-recipient", {
    ...message,
    to: otherAccount.email,
  });
  assert.deepEqual(wrongRecipient, { sent: false, state: "untracked" }, "a renter address not owned by this booking is never sent");
  assert.equal(sends.length, 1);

  const unverified = await mailer.sendRentalContextEmail(ctx, unverifiedBooking._id, "rental-security:charge-unverified", {
    ...message,
    to: unverifiedAccount.email,
  });
  assert.deepEqual(unverified, { sent: false, state: "untracked" }, "unverified account emails cannot create a renter-linked thread");
  const guestOnly = await mailer.sendRentalContextEmail(ctx, guestOnlyBooking._id, "rental-security:charge-guest-only", {
    ...message,
    to: "guest-only@example.invalid",
  });
  assert.deepEqual(guestOnly, { sent: false, state: "untracked" }, "guest-only address is not treated as a verified renter identity");
  assert.equal(sends.length, 1, "unsafe associations never reach the mail transport");

  await assert.rejects(() => inbox.prepareRentalContextEmail.handler({ db: h.db }, {
    bookingId: otherBooking._id,
    deliveryKey: "rental-security:charge-fixture-1",
    recipientEmail: otherAccount.email,
    subject: message.subject,
    text: "Review the itemised charge in your rental.",
  }), /does not match its original booking message/, "an idempotency key cannot be reassigned to another customer's booking");

  await assert.rejects(() => inbox.ingest.handler({ db: h.db }, {
    secret: process.env.INBOUND_EMAIL_SECRET,
    providerId: "provider-wrong-sender-rental-context",
    references: [],
    replyThreadId: thread._id,
    replyCapabilityKey: thread.replyKey,
    from: otherAccount.email,
    to: firstMail.replyTo,
    subject: "Re: stolen alias",
    text: "Do not associate this sender with the renter.",
  }), /does not match the sender/, "a sender cannot claim another renter's thread from a reply alias");

  outcome = "failed";
  const failed = await mailer.sendRentalContextEmail(ctx, booking._id, "rental-late:result-fixture-2", {
    ...message,
    subject: "Late rental payment result",
  });
  assert.deepEqual(failed, { sent: false, state: "failed" });
  const failedOutbound = h.tables.get("email_messages").find(row => row.providerId === "rental-context:rental-late:result-fixture-2");
  assert.equal(failedOutbound.state, "failed");
  const failedReplyTo = sends.at(-1).replyTo;
  outcome = "sent";
  const retried = await mailer.sendRentalContextEmail(ctx, booking._id, "rental-late:result-fixture-2", {
    ...message,
    subject: "Late rental payment result",
  });
  assert.deepEqual(retried, { sent: true, state: "sent" }, "a definite provider rejection can retry with the same durable key");
  assert.equal(sends.at(-1).deliveryKey, "rental-context:rental-late:result-fixture-2");
  assert.equal(sends.at(-1).replyTo, failedReplyTo, "retries retain the same per-message renter reply route");

  outcome = "uncertain";
  const uncertain = await mailer.sendRentalContextEmail(ctx, booking._id, "rental-hold:renewal-fixture-3", {
    ...message,
    subject: "Your rental security hold needs attention",
  });
  assert.deepEqual(uncertain, { sent: false, state: "uncertain" });
  const uncertainOutbound = h.tables.get("email_messages").find(row => row.providerId === "rental-context:rental-hold:renewal-fixture-3");
  assert.equal(uncertainOutbound.state, "uncertain");
  const sentCount = sends.length;
  const uncertainRetry = await mailer.sendRentalContextEmail(ctx, booking._id, "rental-hold:renewal-fixture-3", {
    ...message,
    subject: "Your rental security hold needs attention",
  });
  assert.deepEqual(uncertainRetry, { sent: false, state: "uncertain" }, "an uncertain provider outcome is not sent again automatically");
  assert.equal(sends.length, sentCount);

  console.log("PASS rental-context transactional email: exact booking/address binding, inbound reply routing, retry idempotency, and uncertain-send protection. Mock transport only; no email sent.");
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
