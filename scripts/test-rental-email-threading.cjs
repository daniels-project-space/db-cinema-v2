const assert = require("node:assert/strict");
const h = require("./lib/rentalTestHarness.cjs");

process.env.ADMIN_TOKEN = "fixture-admin";
process.env.INBOUND_EMAIL_SECRET = "fixture-inbound-secret";
process.env.INBOUND_REPLY_ADDRESS = "support@resend-inbox.example.invalid";

let mailResult = false;
const mails = [];
h.setMock("./lib/mailer", {
  sendBusinessMailTracked: async mail => {
    mails.push(mail);
    return { sent: mailResult, ambiguous: false, ...(mailResult ? { resendEmailId: `resend-${mail.deliveryKey}` } : {}) };
  },
  OWNER_EMAIL: () => "owner@example.invalid",
});
h.setMock("./adminAuth", { checkAdminToken: token => token === "fixture-admin", assertAdmin: async () => {} });
h.setMock("./rateLimit", { bump: async () => ({ allowed: true }) });
h.setMock("./lib/adminPush", { queueOwnerNotification: async () => {} });
h.setMock("./lib/rentalChat", {
  postRentalMessage: async (_ctx, message) => h.put("messages", { ...message, at: Date.now() })._id,
  accountForToken: async (_ctx, token) => [...h.docs.values()].find(row => row._id === token) ?? null,
  rentalThread: async () => null,
});

const delivery = h.load("convex/rentalEmailDelivery.ts");
const worker = h.load("convex/rentalEmailMail.ts");
const inbox = h.load("convex/emailInbox.ts");
const { auditMessageText } = h.load("convex/lib/rentalContextEmail.ts");
const plainAudit = auditMessageText({
  subject: "Verification notice",
  text: "Continue here: https://fixture.invalid/verify?token=fixture-secret-token. Your verification code: 123456",
  html: "",
});
assert.doesNotMatch(plainAudit, /fixture-secret-token|123456/, "plain-text audit copies omit URLs and one-time verification codes");
const account = h.put("accounts", {
  email: "renter@example.invalid",
  emailVerifiedAt: Date.now(),
  name: "Verified renter",
});
const booking = h.put("bookings", {
  accountId: account._id,
  guestEmail: account.email,
  status: "cancelled",
});
const stored = new Map([
  ["_storage-rental-notice", new Blob([JSON.stringify({
    deliveryKey: "rental-notice-stable-key",
    to: account.email,
    subject: "Rental update",
    html: '<p>Your rental details have changed.</p><p><a href="https://fixture.invalid/account?rental=fixture-booking&amp;token=fixture-secret-token">View your rental</a></p>',
  })], { type: "application/json" })],
]);
const deliveryRow = h.put("rental_email_deliveries", {
  _id: "rental_email_deliveries-threading-fixture",
  bookingId: booking._id,
  kind: "cancellation",
  key: "rental-notice-stable-key",
  sequence: 1,
  state: "sending",
  attempts: 1,
  generation: 1,
  dueAt: Date.now() + 60_000,
  createdAt: Date.now(),
  updatedAt: Date.now(),
  recipientEmail: account.email,
  payloadStorageId: "_storage-rental-notice",
});
const ctx = {
  db: h.db,
  storage: { get: async id => stored.get(id) ?? null },
  scheduler: { runAfter: async () => {} },
  runQuery: async (ref, args) => {
    assert.equal(ref, "rentalEmailDelivery.ready");
    return delivery.ready.handler(ctx, args);
  },
  runMutation: async (ref, args) => {
    if (ref === "emailInbox.prepareRentalEmailThread") return inbox.prepareRentalEmailThread.handler(ctx, args);
    if (ref === "emailInbox.finishRentalEmailThread") return inbox.finishRentalEmailThread.handler(ctx, args);
    if (ref === "rentalEmailDelivery.finish") return delivery.finish.handler(ctx, args);
    throw new Error(`Unexpected mutation ${ref}`);
  },
};

(async () => {
  const args = { deliveryId: deliveryRow._id, generation: 1 };
  await worker.deliver.handler(ctx, args);
  assert.equal(deliveryRow.state, "pending", "a definite provider rejection stays retryable");
  assert.equal(mails.length, 1);
  const providerId = `rental-email:${deliveryRow._id}`;
  const outbound = h.tables.get("email_messages").find(message => message.providerId === providerId);
  const thread = h.docs.get(outbound.threadId);
  assert.equal(outbound.state, "failed");
  assert.match(outbound.text, /Your rental details have changed/);
  assert.match(outbound.text, /View your rental/);
  assert.doesNotMatch(outbound.text, /fixture-secret-token|https:\/\//, "the admin audit shows readable body text without exposing link tokens");
  assert.equal(mails[0].text, undefined, "the audit copy does not alter the customer-facing email payload");
  assert.equal(thread.accountId, account._id);
  assert.equal(thread.bookingId, booking._id);
  assert.equal(mails[0].replyTo, `gaffer+${thread.replyKey}@resend-inbox.example.invalid`);

  const configuredReplyAddress = process.env.INBOUND_REPLY_ADDRESS;
  deliveryRow.state = "sending";
  deliveryRow.attempts += 1;
  deliveryRow.generation += 1;
  deliveryRow.dueAt = Date.now() + 60_000;
  delete process.env.INBOUND_REPLY_ADDRESS;
  await worker.deliver.handler(ctx, { deliveryId: deliveryRow._id, generation: deliveryRow.generation });
  assert.equal(deliveryRow.state, "pending", "missing inbound routing keeps the rental notice retryable");
  assert.equal(mails.length, 1, "a retry cannot send a rental notice without its tracked reply route");
  assert.equal(outbound.state, "failed", "the central outbox remains available for a later configured retry");

  process.env.INBOUND_REPLY_ADDRESS = configuredReplyAddress;
  deliveryRow.state = "sending";
  deliveryRow.attempts += 1;
  deliveryRow.generation += 1;
  deliveryRow.dueAt = Date.now() + 60_000;
  mailResult = true;
  await worker.deliver.handler(ctx, { deliveryId: deliveryRow._id, generation: deliveryRow.generation });
  assert.equal(deliveryRow.state, "sent");
  assert.equal(mails.length, 2);
  assert.equal(mails[1].replyTo, mails[0].replyTo, "retries preserve the same renter reply address");
  assert.equal(mails[1].subject, mails[0].subject);
  assert.equal(mails[1].text, mails[0].text);
  assert.equal(mails[1].html, mails[0].html, "centralization does not alter customer email content");
  assert.equal(h.tables.get("email_messages").filter(message => message.providerId === providerId).length, 1);
  assert.equal(outbound.state, "sent");
  assert.equal(outbound.resendEmailId, `resend-${deliveryRow.key}`);

  const reply = await inbox.ingest.handler({ db: h.db }, {
    secret: process.env.INBOUND_EMAIL_SECRET,
    providerId: "provider-reply-to-rental-notice",
    references: [],
    replyThreadId: thread._id,
    replyCapabilityKey: thread.replyKey,
    from: account.email,
    to: mails[1].replyTo,
    subject: "Re: Rental update",
    text: "Please confirm the revised pickup time.",
  });
  assert.equal(reply.threadId, thread._id, "a renter reply resolves to the queued rental email thread");
  assert.equal(reply.accountId, account._id);
  assert.equal(reply.bookingId, booking._id);
  const adminInbox = await inbox.adminInbox.handler({ db: h.db }, { token: "fixture-admin", limit: 20 });
  const renderedThread = adminInbox.items.find(item => item._id === thread._id);
  assert.deepEqual(renderedThread.rentalConversation, { accountId: account._id, bookingId: booking._id });

  const guestEmail = "guest-renter@example.invalid";
  const guestBooking = h.put("bookings", {
    _id: "bookings-guest-threading",
    guestEmail,
    status: "confirmed",
    lineItems: [{ listingId: "listings-camera", start: 10, end: 20, qty: 1 }],
  });
  const guestDelivery = h.put("rental_email_deliveries", {
    _id: "rental_email_deliveries-guest-threading",
    bookingId: guestBooking._id,
    kind: "verification",
    key: "guest-rental-notice-key",
    sequence: 1,
    state: "sending",
    attempts: 1,
    generation: 1,
    dueAt: Date.now() + 60_000,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    recipientEmail: guestEmail,
  });
  const guestPrepared = await inbox.prepareRentalEmailThread.handler({ db: h.db }, {
    deliveryId: guestDelivery._id,
    generation: 1,
    recipientEmail: guestEmail,
    subject: "Rental verification update",
    text: "Please reply if you need help with your rental verification.",
  });
  assert.equal(guestPrepared.tracked, true);
  const guestThread = h.docs.get(h.tables.get("email_messages").find(message => message.providerId === `rental-email:${guestDelivery._id}`).threadId);
  await inbox.finishRentalEmailThread.handler({ db: h.db }, {
    deliveryId: guestDelivery._id,
    generation: 1,
    result: "sent",
    resendEmailId: "guest-rental-notice-sent",
  });
  const guestReply = await inbox.ingest.handler({ db: h.db }, {
    secret: process.env.INBOUND_EMAIL_SECRET,
    providerId: "provider-reply-to-guest-rental-notice",
    references: [],
    replyThreadId: guestThread._id,
    replyCapabilityKey: guestThread.replyKey,
    from: guestEmail,
    to: guestPrepared.replyTo,
    subject: "Re: Rental verification update",
    text: "I need help with my upcoming rental.",
  });
  assert.equal(guestReply.threadId, guestThread._id);
  assert.equal(guestReply.accountId, null, "a guest booking reply stays unlinked until verified account ownership exists");
  assert.equal(guestReply.bookingId, null, "a reply alias alone does not attach a guest booking to an unverified account");
  const guestAccount = h.put("accounts", { email: guestEmail, emailVerifiedAt: Date.now(), name: "Guest renter" });
  const guestMergeJobs = [];
  const guestMergeScheduler = { runAfter: async (_delay, refName, args) => guestMergeJobs.push({ refName: String(refName), args }) };
  assert.deepEqual(await inbox.claimForAccount.handler({ db: h.db, scheduler: guestMergeScheduler }, { token: guestAccount._id }), { ok: true });
  while (guestMergeJobs.length) {
    const job = guestMergeJobs.shift();
    if (job.refName.endsWith("linkVerifiedHistory")) {
      await inbox.linkVerifiedHistory.handler({ db: h.db, scheduler: guestMergeScheduler }, job.args);
    } else if (job.refName.endsWith("copyVerifiedHistory")) {
      await inbox.copyVerifiedHistory.handler({ db: h.db, scheduler: guestMergeScheduler }, job.args);
    }
  }
  const guestReplyMessage = h.docs.get(guestReply.inboundId);
  const guestMirroredReply = h.docs.get(guestReplyMessage.profileMessageId);
  assert.equal(guestReplyMessage.bookingId, guestBooking._id, "history backfill inherits the delivery's exact guest booking association");
  assert.equal(guestMirroredReply.bookingId, guestBooking._id, "the guest reply is mirrored into the correct booking chat after account verification");
  const guestChatThread = h.tables.get("chat_threads").find(row => row.accountId === guestAccount._id && row.bookingId === guestBooking._id);
  assert.ok(guestChatThread, "history backfill creates the matching renter rental thread");
  const mergedInbox = await inbox.adminInbox.handler({ db: h.db }, { token: "fixture-admin", limit: 20 });
  const mergedEmailThread = mergedInbox.items.find(item => item._id === guestThread._id);
  assert.deepEqual(mergedEmailThread.rentalConversation, { accountId: guestAccount._id, bookingId: guestBooking._id }, "unified inbox links a verified guest reply to its rental");

  const miniEmail = "paid-mini-renter@example.invalid";
  const miniAccount = h.put("accounts", { email: miniEmail, emailVerificationRequired: true, name: "Paid renter" });
  const miniBooking = h.put("bookings", { _id: "bookings-paid-mini-threading", accountId: miniAccount._id, guestEmail: miniEmail, status: "confirmed" });
  const miniDelivery = h.put("rental_email_deliveries", {
    _id: "rental_email_deliveries-paid-mini-threading",
    bookingId: miniBooking._id,
    kind: "verification",
    key: "paid-mini-rental-notice",
    sequence: 1,
    state: "sending",
    attempts: 1,
    generation: 1,
    dueAt: Date.now() + 60_000,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    recipientEmail: miniEmail,
  });
  const miniPrepared = await inbox.prepareRentalEmailThread.handler({ db: h.db }, {
    deliveryId: miniDelivery._id,
    generation: 1,
    recipientEmail: miniEmail,
    subject: "Paid rental verification update",
    text: "Reply to this email if you need help with the paid rental.",
  });
  assert.equal(miniPrepared.tracked, true);
  const miniOutbound = h.tables.get("email_messages").find(message => message.providerId === `rental-email:${miniDelivery._id}`);
  const miniThread = h.docs.get(miniOutbound.threadId);
  assert.equal(miniThread.accountId, undefined, "payment-created mini accounts do not receive renter message ownership before email proof");
  assert.equal(miniThread.bookingId, miniBooking._id, "the tracked outbound email retains the exact paid rental while account ownership is pending");
  await inbox.finishRentalEmailThread.handler({ db: h.db }, {
    deliveryId: miniDelivery._id,
    generation: 1,
    result: "sent",
    resendEmailId: "paid-mini-rental-notice-sent",
  });
  const miniReply = await inbox.ingest.handler({ db: h.db }, {
    secret: process.env.INBOUND_EMAIL_SECRET,
    providerId: "provider-reply-to-paid-mini-rental",
    references: [],
    replyThreadId: miniThread._id,
    replyCapabilityKey: miniThread.replyKey,
    from: miniEmail,
    to: miniPrepared.replyTo,
    subject: "Re: Paid rental verification update",
    text: "Please help me verify the paid rental.",
  });
  assert.equal(miniReply.threadId, miniThread._id, "an unverified mini-account reply stays in the tracked rental email thread");
  assert.equal(miniReply.accountId, null, "replying from a mini-account email does not claim renter account ownership before proof");
  assert.equal([...h.docs.values()].some(message => message.accountId === miniAccount._id && message.meta?.channel === "email"), false);

  h.put("account_access_links", { accountId: miniAccount._id, secretHash: "paid-mini-owner-proof", createdAt: Date.now(), expiresAt: Date.now() + 60_000 });
  const accountClaims = h.load("convex/accountClaims.ts");
  const mergeJobs = [];
  await accountClaims.exchange.handler({ db: h.db, scheduler: { runAfter: async (...args) => mergeJobs.push(args) } }, {
    secretHash: "paid-mini-owner-proof",
    sessionToken: "paid-mini-owner-session",
  });
  const historyJobs = [];
  const historyScheduler = { runAfter: async (_delay, ref, args) => historyJobs.push({ ref: String(ref), args }) };
  for (const [_delay, ref, args] of mergeJobs) {
    if (String(ref).endsWith("linkVerifiedHistory")) await inbox.linkVerifiedHistory.handler({ db: h.db, scheduler: historyScheduler }, args);
  }
  while (historyJobs.length) {
    const job = historyJobs.shift();
    if (job.ref.endsWith("linkVerifiedHistory")) await inbox.linkVerifiedHistory.handler({ db: h.db, scheduler: historyScheduler }, job.args);
    else if (job.ref.endsWith("copyVerifiedHistory")) await inbox.copyVerifiedHistory.handler({ db: h.db, scheduler: historyScheduler }, job.args);
  }
  assert.equal(miniThread.accountId, miniAccount._id, "verifying the mini account attaches the tracked rental history");
  const mergedMiniReply = h.docs.get(h.docs.get(miniReply.inboundId).profileMessageId);
  assert.equal(mergedMiniReply.bookingId, miniBooking._id, "history merge places the pre-verification reply in the exact paid rental conversation");
  const miniInbox = await inbox.adminInbox.handler({ db: h.db }, { token: "fixture-admin", limit: 30 });
  const miniInboxThread = miniInbox.items.find(item => item._id === miniThread._id);
  assert.deepEqual(miniInboxThread.rentalConversation, { accountId: miniAccount._id, bookingId: miniBooking._id });

  const untrackedDelivery = h.put("rental_email_deliveries", {
    _id: "rental_email_deliveries-no-reply-route",
    bookingId: booking._id,
    kind: "cancellation",
    key: "rental-notice-no-reply-route",
    sequence: 1,
    state: "sending",
    attempts: 1,
    generation: 1,
    dueAt: Date.now() + 60_000,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    recipientEmail: account.email,
    payloadStorageId: "_storage-rental-no-reply-route",
  });
  stored.set("_storage-rental-no-reply-route", new Blob([JSON.stringify({
    deliveryKey: "rental-notice-no-reply-route",
    to: account.email,
    subject: "Another rental update",
    text: "This notice must wait for its reply route.",
    html: "<p>This notice must wait for its reply route.</p>",
  })], { type: "application/json" }));
  delete process.env.INBOUND_REPLY_ADDRESS;
  await worker.deliver.handler(ctx, { deliveryId: untrackedDelivery._id, generation: 1 });
  assert.equal(untrackedDelivery.state, "pending", "a new rental notice retries until centralized reply routing is available");
  assert.equal(mails.length, 2, "new rental notices are not sent as untracked email when routing is unconfigured");
  assert.equal(h.tables.get("email_messages").some(message => message.providerId === `rental-email:${untrackedDelivery._id}`), false);
  process.env.INBOUND_REPLY_ADDRESS = configuredReplyAddress;

  console.log("PASS queued rental email threading: stable reply alias, retry dedupe, renter/rental linking, and unified admin inbox. Mock transport only; no email sent.");
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
