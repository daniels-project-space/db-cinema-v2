const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { db, docs, load, put, setMock } = require("./lib/rentalTestHarness.cjs");

const chatMessages = [];
let adminAllowed = true;
setMock("./adminAuth", {
  assertAdmin: async () => {},
  checkAdminToken: () => adminAllowed,
});
setMock("./lib/rentalChat", {
  postRentalMessage: async (_ctx, message) => {
    const inserted = put("messages", { ...message, at: Date.now(), threadCounted: true });
    chatMessages.push(inserted);
    return inserted._id;
  },
  rentalThread: async () => null,
});
process.env.RESEND_API_KEY = "fixture-resend-key";
process.env.RESEND_FROM = "DB Cinema Rentals <bookings@dbcinemarentals.com>";
process.env.INBOUND_REPLY_ADDRESS = "support@resend-inbox.example.invalid";
process.env.INBOUND_EMAIL_SECRET = "fixture-email-webhook-secret";

const inbox = load("convex/emailInbox.ts");

(async () => {
  const email = "tom@example.com";
  const account = put("accounts", {
    email,
    emailVerifiedAt: Date.now(),
    name: "Tom Wheeler",
  });
  const thread = put("email_threads", {
    email,
    subject: "Rental question",
    replyKey: "abcdef0123456789abcdef01",
    accountId: account._id,
    verifiedRenterEmail: email,
    status: "open",
    createdAt: Date.now(),
    updatedAt: Date.now(),
    lastAt: Date.now(),
    lastDirection: "in",
    lastText: "Can you confirm the rental?",
    unreadOwner: 1,
  });
  const inbound = put("email_messages", {
    threadId: thread._id,
    direction: "in",
    sender: email,
    recipient: "bookings@dbcinemarentals.com",
    subject: thread.subject,
    text: "Can you confirm the rental?",
    at: Date.now(),
    messageId: "<tom-inbound@example.invalid>",
    references: [],
    state: "received",
    humanRequested: false,
  });
  thread.latestInboundMessageId = inbound._id;
  const sourceChatMessage = put("messages", {
    accountId: account._id,
    sender: "renter",
    text: inbound.text,
    at: inbound.at,
    meta: { channel: "email", emailThreadId: String(thread._id), emailMessageId: String(inbound._id) },
  });
  inbound.profileMessageId = sourceChatMessage._id;

  const sentPayloads = [];
  const providerResponses = [];
  let failFinishOnce = false;
  const call = async (token, args = {}) => inbox.sendChatOwnerReply.handler({
    runMutation: async (ref, mutationArgs) => {
      const name = String(ref).split(".").at(-1);
      if (name === "reserveChatOwnerReply") return inbox.reserveChatOwnerReply.handler({ db }, mutationArgs);
      if (name === "finishOwnerReply") {
        if (failFinishOnce) {
          failFinishOnce = false;
          throw new Error("synthetic persistence failure after provider acceptance");
        }
        return inbox.finishOwnerReply.handler({ db, scheduler: { runAfter: async () => {} } }, mutationArgs);
      }
      if (name === "markChatOwnerReplyUncertain") return inbox.markChatOwnerReplyUncertain.handler({ db }, mutationArgs);
      if (name === "markEmailReplyRetryable") return inbox.markEmailReplyRetryable.handler({ db }, mutationArgs);
      if (name === "markSendFailed") return inbox.markSendFailed.handler({ db }, mutationArgs);
      throw new Error(`Unexpected mutation: ${String(ref)}`);
    },
    runAction: async (ref, actionArgs) => {
      assert.match(String(ref), /emailMailer\.sendBusinessReply$/);
      sentPayloads.push(actionArgs);
      return providerResponses.shift() ?? { sent: true, messageId: `<${actionArgs.deliveryKey}@example.invalid>`, resendEmailId: `resend-${sentPayloads.length}` };
    },
  }, {
    token,
    threadId: args.threadId ?? thread._id,
    emailMessageId: args.emailMessageId ?? inbound._id,
    chatMessageId: args.chatMessageId ?? sourceChatMessage._id,
    replyId: args.replyId ?? "12345678-1234-1234-1234-123456789abc",
    text: args.text ?? "Yes, your rental is confirmed.",
  });

  const result = await call("admin-token", {});
  assert.deepEqual(result, { ok: true });
  assert.equal(sentPayloads.length, 1, "the combined-chat reply reaches the email provider once");
  assert.equal(sentPayloads[0].to, email);
  assert.equal(sentPayloads[0].subject, "Re: Rental question");
  assert.equal(sentPayloads[0].inReplyTo, inbound.messageId);
  assert.deepEqual(sentPayloads[0].references, [inbound.messageId], "email replies retain the inbound References chain");
  assert.equal(sentPayloads[0].replyTo, `gaffer+${thread.replyKey}@resend-inbox.example.invalid`, "chat-originated email replies preserve the same private inbox thread");
  assert.match(sentPayloads[0].deliveryKey, /^email-chat:/, "email retries use a stable provider idempotency key");

  const outbound = [...docs.values()].find(row => row.direction === "out" && row.threadId === thread._id);
  assert.equal(outbound.state, "sent");
  assert.equal(outbound.resendEmailId, "resend-1", "provider receipt IDs are retained for delivery-event reconciliation");
  assert.equal(outbound.chatSender, "owner", "team-originated email outbox rows preserve the correct chat author");
  assert.equal(outbound.bookingId, undefined, "a general-support email reply never acquires a rental association");
  assert.equal(outbound.profileMessageId, chatMessages[0]._id, "the sent reply stores its single mirrored chat message ID");
  assert.equal(chatMessages.length, 1);
  assert.equal(chatMessages[0].sender, "owner");
  assert.equal(chatMessages[0].bookingId, undefined, "the general-support copy remains in general support");
  assert.equal(chatMessages[0].meta.channel, "email");
  assert.equal(chatMessages[0].meta.emailMessageId, String(outbound._id));

  const webhookResult = await inbox.recordResendDeliveryEvent.handler({ db, scheduler: { runAfter: async () => {} } }, {
    secret: process.env.INBOUND_EMAIL_SECRET,
    webhookEventId: "email-chat-reply-delivered-event",
    resendEmailId: outbound.resendEmailId,
    eventType: "delivered",
    recipients: [email],
    from: "bookings@dbcinemarentals.com",
    occurredAt: Date.now(),
  });
  assert.equal(webhookResult.matched, true, "a provider delivery webhook reconciles against the stored receipt ID");
  assert.equal(outbound.recipientDeliveryStatuses[0].status, "delivered");

  const beforeBackfill = [...docs.values()].filter(row => row.accountId === account._id && row.sender).length;
  await inbox.copyVerifiedHistory.handler({ db, scheduler: { runAfter: async () => {} } }, { accountId: account._id, threadId: thread._id, cursor: null });
  const afterBackfill = [...docs.values()].filter(row => row.accountId === account._id && row.sender).length;
  assert.equal(afterBackfill, beforeBackfill, "history backfill does not duplicate the owner reply");

  const duplicate = await call("admin-token", {});
  assert.deepEqual(duplicate, { ok: true, duplicate: true });
  assert.equal(sentPayloads.length, 1, "retries reuse the provider idempotency key");

  const rentalEmail = "rental-owner@example.com";
  const rentalAccount = put("accounts", { email: rentalEmail, emailVerifiedAt: Date.now(), name: "Rental owner" });
  const booking = put("bookings", { _id: "bookings-EMAIL001", accountId: rentalAccount._id, guestEmail: rentalEmail, at: Date.now() });
  const rentalThread = put("email_threads", {
    email: rentalEmail,
    subject: "Rental booking question",
    replyKey: "bcdef0123456789abcdef012",
    accountId: rentalAccount._id,
    bookingId: booking._id,
    verifiedRenterEmail: rentalEmail,
    status: "open",
    createdAt: Date.now(),
    updatedAt: Date.now(),
    lastAt: Date.now(),
    lastDirection: "in",
    lastText: "Can I collect the camera at 9?",
    unreadOwner: 1,
  });
  const rentalInbound = put("email_messages", {
    threadId: rentalThread._id,
    bookingId: booking._id,
    direction: "in",
    sender: rentalEmail,
    recipient: "bookings@dbcinemarentals.com",
    subject: rentalThread.subject,
    text: "Can I collect the camera at 9?",
    at: Date.now(),
    messageId: "<rental-owner-inbound@example.invalid>",
    references: [],
    state: "received",
    humanRequested: false,
  });
  rentalThread.latestInboundMessageId = rentalInbound._id;
  const rentalChatMessage = put("messages", {
    accountId: rentalAccount._id,
    bookingId: booking._id,
    sender: "renter",
    text: rentalInbound.text,
    at: Date.now() + 10_000,
    meta: { channel: "email", emailThreadId: String(rentalThread._id), emailMessageId: String(rentalInbound._id) },
  });
  rentalInbound.profileMessageId = rentalChatMessage._id;
  const rentalReply = await call("admin-token", {
    threadId: rentalThread._id,
    emailMessageId: rentalInbound._id,
    chatMessageId: rentalChatMessage._id,
    replyId: "32345678-1234-1234-1234-123456789abc",
    text: "Yes, collection at 9 is arranged for this rental.",
  });
  assert.deepEqual(rentalReply, { ok: true });
  assert.equal(sentPayloads.length, 2, "a reply typed in a rental email conversation reaches the provider");
  assert.equal(sentPayloads[1].to, rentalEmail);
  assert.equal(sentPayloads[1].inReplyTo, rentalInbound.messageId);
  const rentalOutbound = [...docs.values()].find(row => row.threadId === rentalThread._id && row.direction === "out");
  assert.equal(rentalOutbound.state, "sent");
  assert.equal(rentalOutbound.bookingId, booking._id, "the sent email retains its validated rental association");
  assert.equal(rentalOutbound.chatSender, "owner");
  assert.equal(rentalOutbound.profileMessageId, chatMessages[1]._id, "the renter chat receives exactly one mirror of the sent email");
  assert.equal(chatMessages[1].bookingId, booking._id, "the mirrored owner reply remains in that rental chat");
  assert.equal(chatMessages[1].sender, "owner");

  const archivedEmail = "case-backfill@example.com";
  const archivedAccount = put("accounts", { email: archivedEmail, emailVerifiedAt: Date.now(), name: "Case archive renter" });
  const archivedBooking = put("bookings", { _id: "bookings-CASE001", accountId: archivedAccount._id, guestEmail: archivedEmail, at: Date.now() });
  const firstCase = put("rental_damage_cases", { bookingId: archivedBooking._id, accountId: archivedAccount._id, itemKey: "camera-1", title: "Case one", details: "Evidence one", status: "closed", openedAt: Date.now() - 5_000, closedAt: Date.now() - 1_000 });
  const secondCase = put("rental_damage_cases", { bookingId: archivedBooking._id, accountId: archivedAccount._id, itemKey: "lens-1", title: "Case two", details: "Evidence two", status: "open", openedAt: Date.now() - 3_000 });
  const archivedEmailThread = put("email_threads", {
    email: archivedEmail,
    subject: "Rental case follow-up",
    replyKey: "cdef0123456789abcdef0123",
    accountId: archivedAccount._id,
    bookingId: archivedBooking._id,
    verifiedRenterEmail: archivedEmail,
    status: "open",
    createdAt: Date.now(),
    updatedAt: Date.now(),
    lastAt: Date.now(),
    lastDirection: "in",
    lastText: "Here is the case follow-up.",
    unreadOwner: 1,
  });
  const archivedInbound = put("email_messages", {
    threadId: archivedEmailThread._id,
    bookingId: archivedBooking._id,
    direction: "in",
    sender: archivedEmail,
    recipient: "bookings@dbcinemarentals.com",
    subject: archivedEmailThread.subject,
    text: "Here is the case follow-up.",
    at: Date.now(),
    messageId: "<case-backfill@example.invalid>",
    state: "received",
    humanRequested: false,
  });
  const archivedProfileMessage = put("messages", {
    accountId: archivedAccount._id,
    sender: "renter",
    text: archivedInbound.text,
    at: archivedInbound.at,
    meta: { channel: "email", emailThreadId: String(archivedEmailThread._id), emailMessageId: String(archivedInbound._id) },
  });
  archivedInbound.profileMessageId = archivedProfileMessage._id;
  await inbox.copyVerifiedHistory.handler({ db, scheduler: { runAfter: async () => {} } }, { accountId: archivedAccount._id, threadId: archivedEmailThread._id, cursor: null });
  const archivedChatThread = await db.query("chat_threads").withIndex("by_account_booking", q => q.eq("accountId", archivedAccount._id).eq("bookingId", archivedBooking._id)).first();
  assert(archivedChatThread, "verified email history can create the rental chat thread");
  assert.equal(archivedChatThread.caseArchivedAt, firstCase.openedAt, "a backfilled case rental chat receives the earliest case archive date");
  const caseArchives = await db.query("chat_case_archives").withIndex("by_booking", q => q.eq("bookingId", archivedBooking._id)).collect();
  assert.equal(caseArchives.length, 2, "each case remains represented in the permanent archive");
  assert(caseArchives.every(archive => archive.threadId === archivedChatThread._id), "all cases link to the newly created rental conversation");

  const newerInbound = put("email_messages", {
    threadId: thread._id,
    direction: "in",
    sender: email,
    recipient: "bookings@dbcinemarentals.com",
    subject: thread.subject,
    text: "One more detail.",
    at: Date.now() + 1,
    messageId: "<tom-newer@example.invalid>",
    state: "received",
    humanRequested: false,
  });
  thread.latestInboundMessageId = newerInbound._id;
  await assert.rejects(() => inbox.reserveChatOwnerReply.handler({ db }, {
    threadId: thread._id,
    emailMessageId: inbound._id,
    chatMessageId: sourceChatMessage._id,
    replyId: "22345678-1234-1234-1234-123456789abc",
    text: "Replying to the stale message.",
  }), /newer email arrived/);
  assert.equal(sentPayloads.length, 2, "stale email context cannot send to the renter");

  adminAllowed = false;
  await assert.rejects(() => call("invalid-token", {}), /unauthorized/);
  assert.equal(sentPayloads.length, 2, "unauthorized chat callers cannot send email");

  const uncertainEmail = "uncertain@example.com";
  const uncertainAccount = put("accounts", { email: uncertainEmail, emailVerifiedAt: Date.now(), name: "Uncertain renter" });
  const uncertainThread = put("email_threads", {
    email: uncertainEmail, subject: "Uncertain reply", replyKey: "def0123456789abcdef01234", accountId: uncertainAccount._id,
    verifiedRenterEmail: uncertainEmail, status: "open", createdAt: Date.now(), updatedAt: Date.now(), lastAt: Date.now(),
    lastDirection: "in", lastText: "Can you help?", unreadOwner: 1,
  });
  const uncertainInbound = put("email_messages", {
    threadId: uncertainThread._id, direction: "in", sender: uncertainEmail, recipient: "bookings@dbcinemarentals.com",
    subject: uncertainThread.subject, text: "Can you help?", at: Date.now(), messageId: "<uncertain-inbound@example.invalid>",
    references: [], state: "received", humanRequested: false,
  });
  uncertainThread.latestInboundMessageId = uncertainInbound._id;
  const uncertainChatMessage = put("messages", {
    accountId: uncertainAccount._id, sender: "renter", text: uncertainInbound.text, at: uncertainInbound.at,
    meta: { channel: "email", emailThreadId: String(uncertainThread._id), emailMessageId: String(uncertainInbound._id) },
  });
  uncertainInbound.profileMessageId = uncertainChatMessage._id;
  const uncertainArgs = {
    threadId: uncertainThread._id, emailMessageId: uncertainInbound._id, chatMessageId: uncertainChatMessage._id,
    replyId: "42345678-1234-1234-1234-123456789abc", text: "I am checking that for you.",
  };
  adminAllowed = true;
  providerResponses.push({ sent: false, ambiguous: true });
  const beforeUncertain = sentPayloads.length;
  assert.deepEqual(await call("admin-token", uncertainArgs), { ok: false, uncertain: true }, "timeouts and 5xx outcomes remain explicitly uncertain");
  const uncertainOutbox = [...docs.values()].find(row => row.threadId === uncertainThread._id && row.direction === "out");
  assert.equal(uncertainOutbox.state, "uncertain", "an ambiguous provider outcome cannot be made retryable");
  const unmatchedWebhook = await inbox.recordResendDeliveryEvent.handler({ db, scheduler: { runAfter: async () => {} } }, {
    secret: process.env.INBOUND_EMAIL_SECRET,
    webhookEventId: "ambiguous-reply-unmatched-delivery-event",
    resendEmailId: "resend-id-not-known-to-outbox",
    eventType: "delivered",
    recipients: [uncertainEmail],
    from: "bookings@dbcinemarentals.com",
    occurredAt: Date.now(),
  });
  assert.equal(unmatchedWebhook.pending, true, "delivery events without a stored provider ID are buffered rather than guessed by recipient");
  assert.equal(uncertainOutbox.state, "uncertain", "an unmatched delivery event cannot falsely reconcile an ambiguous send");
  const beforeAlternateRetry = sentPayloads.length;
  assert.deepEqual(await call("admin-token", { ...uncertainArgs, replyId: "72345678-1234-1234-1234-123456789abc", text: "Just checking again." }), { ok: false, uncertain: true }, "a different reply ID and edited text cannot bypass an unresolved send for the same inbound");
  assert.equal(sentPayloads.length, beforeAlternateRetry, "the server blocks cross-ID retries before reaching Resend");
  const uncertainAdminThread = await inbox.adminThread.handler({ db }, { token: "admin-token", threadId: uncertainThread._id });
  assert.equal(uncertainAdminThread.replyDeliveryStatus, "uncertain", "the admin inbox exposes unresolved delivery as a first-class warning state");
  const originalNow = Date.now;
  Date.now = () => originalNow() + 26 * 60 * 60 * 1000;
  try {
    assert.deepEqual(await call("admin-token", uncertainArgs), { ok: false, uncertain: true }, "a retry after provider idempotency retention remains blocked");
  } finally {
    Date.now = originalNow;
  }
  assert.equal(sentPayloads.length, beforeUncertain + 1, "unknown delivery never resends after the provider's 24-hour key window");
  assert.equal(uncertainOutbox.state, "uncertain");
  const freshInbound = put("email_messages", {
    threadId: uncertainThread._id, direction: "in", sender: uncertainEmail, recipient: "bookings@dbcinemarentals.com",
    subject: uncertainThread.subject, text: "I saw your message — thanks.", at: uncertainOutbox.at + 1000,
    messageId: "<uncertain-new-cycle@example.invalid>", references: [uncertainOutbox.messageId].filter(Boolean), state: "received", humanRequested: false,
  });
  uncertainThread.latestInboundMessageId = freshInbound._id;
  const freshChatMessage = put("messages", {
    accountId: uncertainAccount._id, sender: "renter", text: freshInbound.text, at: freshInbound.at,
    meta: { channel: "email", emailThreadId: String(uncertainThread._id), emailMessageId: String(freshInbound._id) },
  });
  freshInbound.profileMessageId = freshChatMessage._id;
  const freshCycleStatus = await inbox.adminThread.handler({ db }, { token: "admin-token", threadId: uncertainThread._id });
  assert.equal(freshCycleStatus.replyDeliveryStatus, null, "a genuinely newer inbound email opens a fresh reply cycle");
  const beforeFreshCycle = sentPayloads.length;
  assert.deepEqual(await call("admin-token", {
    threadId: uncertainThread._id, emailMessageId: freshInbound._id, chatMessageId: freshChatMessage._id,
    replyId: "82345678-1234-1234-1234-123456789abc", text: "Thanks for confirming.",
  }), { ok: true });
  assert.equal(sentPayloads.length, beforeFreshCycle + 1, "a new linked renter email can be answered without resending the earlier uncertain reply");

  const noProviderMessageIdEmail = "no-provider-id@example.com";
  const noProviderMessageIdAccount = put("accounts", { email: noProviderMessageIdEmail, emailVerifiedAt: Date.now(), name: "Receipt renter" });
  const noProviderMessageIdThread = put("email_threads", {
    email: noProviderMessageIdEmail, subject: "Provider receipt", replyKey: "0123456789abcdef01234567",
    accountId: noProviderMessageIdAccount._id, verifiedRenterEmail: noProviderMessageIdEmail, status: "open",
    createdAt: Date.now(), updatedAt: Date.now(), lastAt: Date.now(), lastDirection: "in", unreadOwner: 1,
  });
  const noProviderMessageIdInbound = put("email_messages", {
    threadId: noProviderMessageIdThread._id, direction: "in", sender: noProviderMessageIdEmail,
    recipient: "bookings@dbcinemarentals.com", subject: noProviderMessageIdThread.subject, text: "Can you advise?",
    at: Date.now(), messageId: "<receipt-renter-inbound@example.invalid>", references: [], state: "received", humanRequested: false,
  });
  noProviderMessageIdThread.latestInboundMessageId = noProviderMessageIdInbound._id;
  const noProviderMessageIdChat = put("messages", {
    accountId: noProviderMessageIdAccount._id, sender: "renter", text: noProviderMessageIdInbound.text,
    at: noProviderMessageIdInbound.at,
    meta: { channel: "email", emailThreadId: String(noProviderMessageIdThread._id), emailMessageId: String(noProviderMessageIdInbound._id) },
  });
  noProviderMessageIdInbound.profileMessageId = noProviderMessageIdChat._id;
  providerResponses.push({ sent: true, resendEmailId: "resend-with-later-rfc-receipt" });
  const beforeNoProviderMessageId = sentPayloads.length;
  assert.deepEqual(await call("admin-token", {
    threadId: noProviderMessageIdThread._id,
    emailMessageId: noProviderMessageIdInbound._id,
    chatMessageId: noProviderMessageIdChat._id,
    replyId: "92345678-1234-1234-1234-123456789abc",
    text: "I can help with that.",
  }), { ok: true }, "an accepted email does not become uncertain just because Resend has not returned its RFC Message-ID yet");
  assert.equal(sentPayloads.length, beforeNoProviderMessageId + 1);
  const noProviderMessageIdOutbox = [...docs.values()].find(row => row.threadId === noProviderMessageIdThread._id && row.direction === "out");
  assert.equal(noProviderMessageIdOutbox.state, "sent");
  assert.equal(noProviderMessageIdOutbox.messageId, undefined, "the app never substitutes a fabricated Message-ID");
  const providerMessageIdEvent = await inbox.recordResendDeliveryEvent.handler({ db, scheduler: { runAfter: async () => {} } }, {
    secret: process.env.INBOUND_EMAIL_SECRET,
    webhookEventId: "actual-rfc-message-id-event",
    resendEmailId: "resend-with-later-rfc-receipt",
    eventType: "sent",
    recipients: [noProviderMessageIdEmail],
    from: "DB Cinema Rentals <bookings@dbcinemarentals.com>",
    messageId: "<resend-real-message-id@example.invalid>",
    occurredAt: Date.now(),
  });
  assert.deepEqual(providerMessageIdEvent, { ok: true, matched: true, updated: true });
  assert.equal(noProviderMessageIdOutbox.messageId, "<resend-real-message-id@example.invalid>", "a signed provider receipt later fills the actual email Message-ID");

  const ownerEmail = "owner-reply@example.com";
  const ownerThread = put("email_threads", {
    email: ownerEmail, subject: "Owner reply uncertainty", status: "open", createdAt: Date.now(), updatedAt: Date.now(), lastAt: Date.now(),
  });
  const ownerInbound = put("email_messages", {
    threadId: ownerThread._id, direction: "in", sender: ownerEmail, recipient: "bookings@dbcinemarentals.com",
    subject: ownerThread.subject, text: "Can you advise?", at: Date.now(), messageId: "<owner-inbound@example.invalid>",
    references: [], state: "received", humanRequested: false,
  });
  ownerThread.latestInboundMessageId = ownerInbound._id;
  const ownerResponses = [{ sent: false, ambiguous: true }];
  const ownerPayloads = [];
  const ownerReply = (replyId, text) => inbox.sendOwnerReply.handler({
    runQuery: async (ref, queryArgs) => {
      assert.match(String(ref), /emailInbox\.replyContext$/);
      return inbox.replyContext.handler({ db }, queryArgs);
    },
    runMutation: async (ref, mutationArgs) => {
      const name = String(ref).split(".").at(-1);
      if (name === "reserveOwnerReply") return inbox.reserveOwnerReply.handler({ db }, mutationArgs);
      if (name === "markChatOwnerReplyUncertain") return inbox.markChatOwnerReplyUncertain.handler({ db }, mutationArgs);
      if (name === "markEmailReplyRetryable") return inbox.markEmailReplyRetryable.handler({ db }, mutationArgs);
      if (name === "markSendFailed") return inbox.markSendFailed.handler({ db }, mutationArgs);
      if (name === "finishOwnerReply") return inbox.finishOwnerReply.handler({ db, scheduler: { runAfter: async () => {} } }, mutationArgs);
      throw new Error(`Unexpected owner reply mutation: ${String(ref)}`);
    },
    runAction: async (_ref, actionArgs) => {
      ownerPayloads.push(actionArgs);
      return ownerResponses.shift() ?? { sent: true, messageId: `<${actionArgs.deliveryKey}@example.invalid>` };
    },
  }, { token: "admin-token", threadId: ownerThread._id, replyId, text });
  assert.deepEqual(await ownerReply("owner-reply-attempt-0001", "We are checking."), { ok: false, uncertain: true }, "the standalone email inbox also persists ambiguous delivery as uncertain");
  const ownerOutbox = [...docs.values()].find(row => row.threadId === ownerThread._id && row.direction === "out");
  assert.equal(ownerOutbox.state, "uncertain");
  assert.deepEqual(await ownerReply("owner-reply-attempt-0002", "Following up."), { ok: false, uncertain: true }, "a new inbox reply ID cannot bypass unresolved delivery for the same inbound");
  assert.equal(ownerPayloads.length, 1, "the email inbox sends no alternate reply while the prior outcome is unclear");

  const definiteEmail = "definite@example.com";
  const definiteAccount = put("accounts", { email: definiteEmail, emailVerifiedAt: Date.now(), name: "Definite renter" });
  const definiteThread = put("email_threads", {
    email: definiteEmail, subject: "Definite failure", replyKey: "ef0123456789abcdef012345", accountId: definiteAccount._id,
    verifiedRenterEmail: definiteEmail, status: "open", createdAt: Date.now(), updatedAt: Date.now(), lastAt: Date.now(),
    lastDirection: "in", lastText: "Can you help?", unreadOwner: 1,
  });
  const definiteInbound = put("email_messages", {
    threadId: definiteThread._id, direction: "in", sender: definiteEmail, recipient: "bookings@dbcinemarentals.com",
    subject: definiteThread.subject, text: "Can you help?", at: Date.now(), messageId: "<definite-inbound@example.invalid>",
    references: [], state: "received", humanRequested: false,
  });
  definiteThread.latestInboundMessageId = definiteInbound._id;
  const definiteChatMessage = put("messages", {
    accountId: definiteAccount._id, sender: "renter", text: definiteInbound.text, at: definiteInbound.at,
    meta: { channel: "email", emailThreadId: String(definiteThread._id), emailMessageId: String(definiteInbound._id) },
  });
  definiteInbound.profileMessageId = definiteChatMessage._id;
  const definiteArgs = {
    threadId: definiteThread._id, emailMessageId: definiteInbound._id, chatMessageId: definiteChatMessage._id,
    replyId: "52345678-1234-1234-1234-123456789abc", text: "I am checking that for you.",
  };
  providerResponses.push({ sent: false, ambiguous: false });
  const beforeDefinite = sentPayloads.length;
  await assert.rejects(() => call("admin-token", definiteArgs), /could not be sent/);
  const definiteOutbox = [...docs.values()].find(row => row.threadId === definiteThread._id && row.direction === "out");
  assert.equal(definiteOutbox.state, "failed", "a definite provider rejection remains safely retryable");
  assert.deepEqual(await call("admin-token", definiteArgs), { ok: true });
  assert.equal(sentPayloads.length, beforeDefinite + 2, "a definite rejection can be retried with the same delivery key");
  assert.equal(definiteOutbox.state, "sent");

  const persistEmail = "persist@example.com";
  const persistAccount = put("accounts", { email: persistEmail, emailVerifiedAt: Date.now(), name: "Persistence renter" });
  const persistThread = put("email_threads", {
    email: persistEmail, subject: "Persistence failure", replyKey: "f0123456789abcdef0123456", accountId: persistAccount._id,
    verifiedRenterEmail: persistEmail, status: "open", createdAt: Date.now(), updatedAt: Date.now(), lastAt: Date.now(),
    lastDirection: "in", lastText: "Can you help?", unreadOwner: 1,
  });
  const persistInbound = put("email_messages", {
    threadId: persistThread._id, direction: "in", sender: persistEmail, recipient: "bookings@dbcinemarentals.com",
    subject: persistThread.subject, text: "Can you help?", at: Date.now(), messageId: "<persist-inbound@example.invalid>",
    references: [], state: "received", humanRequested: false,
  });
  persistThread.latestInboundMessageId = persistInbound._id;
  const persistChatMessage = put("messages", {
    accountId: persistAccount._id, sender: "renter", text: persistInbound.text, at: persistInbound.at,
    meta: { channel: "email", emailThreadId: String(persistThread._id), emailMessageId: String(persistInbound._id) },
  });
  persistInbound.profileMessageId = persistChatMessage._id;
  const persistArgs = {
    threadId: persistThread._id, emailMessageId: persistInbound._id, chatMessageId: persistChatMessage._id,
    replyId: "62345678-1234-1234-1234-123456789abc", text: "I am checking that for you.",
  };
  failFinishOnce = true;
  const beforePersistFailure = sentPayloads.length;
  assert.deepEqual(await call("admin-token", persistArgs), { ok: false, uncertain: true }, "a confirmed provider send that cannot be persisted is not resent");
  const persistOutbox = [...docs.values()].find(row => row.threadId === persistThread._id && row.direction === "out");
  assert.equal(persistOutbox.state, "uncertain");
  assert.deepEqual(await call("admin-token", persistArgs), { ok: false, uncertain: true });
  assert.equal(sentPayloads.length, beforePersistFailure + 1, "a post-provider persistence failure cannot trigger a duplicate email");

  const ui = fs.readFileSync(path.join(__dirname, "../src/components/rentals/RentalConversation.tsx"), "utf8");
  const inboxUi = fs.readFileSync(path.join(__dirname, "../src/components/admin/RentalInbox.tsx"), "utf8");
  assert.match(ui, /api\.emailInbox\.sendChatOwnerReply/, "the combined admin chat uses the tracked email outbox for email-origin replies");
  assert.match(ui, /email-chat-reply-routing/, "admins are told when the chat composer will send by email");
  assert.match(ui, /emailReplyContext/, "ordinary renter-chat replies continue to use the chat path unless the latest renter message is email-origin");
  assert.match(ui, /email-delivery-unclear/, "the combined admin chat explicitly warns on unclear email delivery");
  assert.match(ui, /emailReplyStatusLoading \|\| emailReplyDeliveryStatus/, "the risky email send is disabled until its delivery state is known");
  assert.match(inboxUi, /Delivery unclear — check before sending again/, "the standalone email inbox uses concise delivery-unclear wording");
  assert.match(inboxUi, /!!replyDeliveryStatus/, "the standalone email send action is paused while a reply outcome is unresolved");

  process.stdout.write("PASS email replies: threading/auth, uncertain delivery visible, alternate-ID retries blocked across inbox/chat, fresh inbound cycle allowed, definite retry, 24h+ idempotency protection, delivery reconciliation, and post-send persistence failure.\n");
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
