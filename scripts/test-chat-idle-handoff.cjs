const assert = require("node:assert/strict");
const { load, db, put, tables } = require("./lib/rentalTestHarness.cjs");

const chat = load("convex/chat.ts");
const renterChat = load("convex/rentalChat.ts");
const rentalChat = load("convex/rentalChat.ts");
const { GAFFER_AUTO_RESUME_MS } = load("convex/lib/rentalChat.ts");
const rentalRequests = load("convex/rentalRequests.ts");
const scheduled = [];
const ctx = { db, scheduler: { runAfter: async (...args) => scheduled.push(args) } };
const originalNow = Date.now;
let now = originalNow();
Date.now = () => now;
process.env.ADMIN_TOKEN = "fixture-admin";
assert.equal(GAFFER_AUTO_RESUME_MS, 4 * 60 * 60 * 1000, "Gaffer returns after four idle hours");

const account = put("accounts", { email: "chat-idle@test.invalid" });
const booking = put("bookings", { accountId: account._id, guestEmail: account.email, status: "confirmed", paidConfirmedAt:now, stripePaymentIntentId:"pi_chat_idle_fixture", verificationProvider:"didit", idVerifyStatus:"verified", idVerificationSource:"didit", idVerifiedAt:now, verificationChecks:{identity:"approved",selfie:"approved",address:"approved"}, lineItems:[{title:"Camera kit",qty:1,start:now,end:now+86400000}] });
put("sessions", { token: "renter", accountId: account._id, expiresAt: now + 24 * 60 * 60 * 1000 });

function latestTimer() {
  const item = [...scheduled].reverse().find((entry) => entry[2]?.expectedUpdatedAt);
  assert(item, "human handoff schedules an idle return");
  return item;
}

function gafferReplyForLatestRenter() {
  const latest = [...(tables.get("messages") ?? [])].reverse().find((message) => message.sender === "renter");
  assert(latest, "the renter message is persisted");
  assert(scheduled.some((entry) => entry[2]?.messageId === latest._id), "Gaffer replies only after a new renter message");
}

async function offerHumanForLatestRenter(bookingId) {
  const renter = [...(tables.get("messages") ?? [])].reverse().find((message) => message.sender === "renter" && message.bookingId === bookingId);
  const thread = tables.get("chat_threads").find((item) => item.accountId === account._id && item.bookingId === bookingId);
  await db.patch(renter._id, { text: "Please connect me with a person." });
  await chat._postBot.handler(ctx, { accountId: account._id, bookingId, replyTo: renter._id, generation: thread.gafferGeneration ?? 0, text: "Would you like me to connect you with a human from our team?" });
  const botMessage = [...(tables.get("messages") ?? [])].reverse().find((message) => message.sender === "bot" && message.bookingId === bookingId);
  if (renter._id === thread.firstRenterMessageId) {
    const updatedThread = tables.get("chat_threads").find((item) => item.accountId === account._id && item.bookingId === bookingId);
    assert.equal(String(updatedThread.notificationPromptMessageId), String(botMessage._id), "the first answer in each thread anchors the notification prompt");
    const renterView = await renterChat.messages.handler(ctx, { token: "renter", bookingId, admin: false, paginationOpts: { numItems: 50, cursor: null } });
    assert.equal(String(renterView.notificationPromptMessageId), String(botMessage._id), "the renter's matching conversation receives that prompt anchor");
    assert(renterView.page.some((message) => String(message._id) === String(botMessage._id)), "the answer is present in the conversation before its anchored prompt can render");
  }
  return botMessage._id;
}

(async () => {
  try {
    await chat.send.handler(ctx, { token: "renter", text: "Account question" });
    await chat.send.handler(ctx, { token: "renter", bookingId: booking._id, text: "Rental question" });
    const threads = tables.get("chat_threads").filter((thread) => thread.accountId === account._id);
    assert.equal(threads.length, 2, "account enquiries share one thread while each rental remains separate");
    assert.equal(threads.filter((thread) => thread.bookingId == null).length, 1);
    assert.equal(threads.filter((thread) => thread.bookingId === booking._id).length, 1);

    await chat.requestHuman.handler(ctx, { token: "renter", offerMessageId: await offerHumanForLatestRenter(undefined) });
    const accountTimer = latestTimer()[2];
    assert.equal(latestTimer()[0], 4 * 60 * 60 * 1000, "account support uses a four-hour idle handoff");
    const accountMessagesAtHandoff = tables.get("messages").length;
    now = accountTimer.expectedActivityAt + GAFFER_AUTO_RESUME_MS;
    assert.deepEqual(await chat.autoResumeGaffer.handler(ctx, accountTimer), { resumed: true });
    assert.equal(tables.get("messages").length, accountMessagesAtHandoff, "account support timer never sends an unsolicited message");
    assert.equal(threads.find((thread) => thread.bookingId == null).escalated, false);
    await chat.send.handler(ctx, { token: "renter", text: "I still need account help." });
    gafferReplyForLatestRenter();
    const supportThread = threads.find((thread) => thread.bookingId == null);
    const firstPromptAnchor = String(supportThread.notificationPromptMessageId);
    const latestSupportQuestion = [...tables.get("messages")].reverse().find((message) => message.sender === "renter" && message.bookingId == null);
    await chat._postBot.handler(ctx, { accountId: account._id, replyTo: latestSupportQuestion._id, generation: supportThread.gafferGeneration ?? 0, text: "The answer is in your account settings." });
    assert.equal(String(supportThread.notificationPromptMessageId), firstPromptAnchor, "later support answers do not duplicate or move the one-time invitation");

    await chat.requestHuman.handler(ctx, { token: "renter", bookingId: booking._id, offerMessageId: await offerHumanForLatestRenter(booking._id) });
    const initialTimer = latestTimer()[2];
    assert.equal(latestTimer()[0], GAFFER_AUTO_RESUME_MS);
    const messageCountAtHandoff = tables.get("messages").length;

    now = initialTimer.expectedActivityAt + 3 * 60 * 60 * 1000;
    assert.deepEqual(await chat.autoResumeGaffer.handler(ctx, initialTimer), { resumed: false, rescheduled: true }, "a previously scheduled three-hour timer waits for the new four-hour deadline");
    assert.equal(latestTimer()[0], 60 * 60 * 1000);
    now = initialTimer.expectedActivityAt + GAFFER_AUTO_RESUME_MS - 1;
    const early = await chat.autoResumeGaffer.handler(ctx, initialTimer);
    assert.deepEqual(early, { resumed: false, rescheduled: true });

    const thread = tables.get("chat_threads").find((item) => item.bookingId === booking._id);
    now = initialTimer.expectedActivityAt + GAFFER_AUTO_RESUME_MS;
    await db.patch(thread._id, { tgMessageId: 41 });
    assert.deepEqual(await chat.autoResumeGaffer.handler(ctx, initialTimer), { resumed: true });
    assert.equal(thread.escalated, false);
    const resumedGeneration = thread.gafferGeneration;
    assert.deepEqual(await chat.autoResumeGaffer.handler(ctx, initialTimer), { resumed: false }, "a replay of the completed timer cannot change state again");
    assert.equal(thread.gafferGeneration, resumedGeneration, "a replay cannot advance the Gaffer generation twice");
    assert.equal(thread.tgMessageId, undefined, "the automatic resume retires its old Telegram reply target");
    const messageCountAfterAutoResume = tables.get("messages").length;
    assert.deepEqual(await chat._adminReply.handler(ctx, { tgMessageId: 41, text: "A delayed reply to the old alert." }), { ok: false });
    assert.equal(thread.escalated, false, "a stale Telegram reply cannot reopen a completed human handoff");
    assert.equal(tables.get("messages").length, messageCountAfterAutoResume, "a stale reply cannot append another owner message");
    await db.patch(thread._id, { tgMessageId: 49 });
    assert.deepEqual(await chat._adminReply.handler(ctx, { tgMessageId: 49, text: "A stale legacy alert reply." }), { ok: false, stale: true }, "legacy Telegram pointers cannot revive a handoff after Gaffer resumes");
    assert.equal(thread.tgMessageId, undefined, "a stale legacy pointer is retired when observed");
    await db.patch(thread._id, { tgMessageId: 48 });
    assert.deepEqual(await chat._adminReply.handler(ctx, { tgMessageId: 48, text: "/gaffer" }), { ok: true, duplicate: true });
    assert.equal(thread.tgMessageId, undefined, "a stale hand-back command also retires legacy pointers");
    assert.equal(tables.get("messages").length, messageCountAtHandoff, "the timer never sends an unsolicited message");

    await chat.send.handler(ctx, { token: "renter", bookingId: booking._id, text: "I still need help" });
    gafferReplyForLatestRenter();

    await chat.requestHuman.handler(ctx, { token: "renter", bookingId: booking._id, offerMessageId: await offerHumanForLatestRenter(booking._id) });
    const staleTimer = latestTimer()[2];
    await db.patch(thread._id, { tgMessageId: 42 });
    now += 60 * 60 * 1000;
    await chat._adminReply.handler(ctx, { tgMessageId: 42, text: "We are checking this for you." });
    const refreshedTimer = latestTimer()[2];
    assert.notEqual(refreshedTimer.expectedActivityAt, staleTimer.expectedActivityAt, "a real human reply restarts the four-hour idle window");

    now = staleTimer.expectedActivityAt + GAFFER_AUTO_RESUME_MS;
    assert.deepEqual(await chat.autoResumeGaffer.handler(ctx, staleTimer), { resumed: false }, "older timer cannot end an active human handoff");
    now = refreshedTimer.expectedActivityAt + GAFFER_AUTO_RESUME_MS;
    assert.deepEqual(await chat.autoResumeGaffer.handler(ctx, refreshedTimer), { resumed: true });
    assert.equal(thread.escalated, false);

    await chat.send.handler(ctx, { token: "renter", bookingId: booking._id, text: "I have another complicated question." });
    await chat.requestHuman.handler(ctx, { token: "renter", bookingId: booking._id, offerMessageId: await offerHumanForLatestRenter(booking._id) });
    const beforeSystemMessage = latestTimer()[2];
    now = beforeSystemMessage.expectedActivityAt + 60 * 60 * 1000;
    await chat.postSystem.handler(ctx, { accountId: account._id, bookingId: booking._id, text: "The pickup time was updated." });
    const afterSystemMessage = latestTimer()[2];
    assert.equal(afterSystemMessage.expectedActivityAt, beforeSystemMessage.expectedActivityAt, "system messages do not extend the human idle window");
    now = beforeSystemMessage.expectedActivityAt + 2 * 60 * 60 * 1000;
    await db.patch(thread._id, { closedAt: now - 1 });
    await chat.send.handler(ctx, { token: "renter", bookingId: booking._id, text: "I still need help." });
    assert.equal(thread.closedAt, undefined, "a renter reply reopens the same handoff thread");
    assert.equal(latestTimer()[2].expectedActivityAt, beforeSystemMessage.expectedActivityAt, "renter messages do not extend the human idle window");
    now = beforeSystemMessage.expectedActivityAt + GAFFER_AUTO_RESUME_MS;
    assert.deepEqual(await chat.autoResumeGaffer.handler(ctx, beforeSystemMessage), { resumed: true }, "Gaffer resumes four hours after the last human activity despite renter or system messages");
    assert.equal(thread.escalated, false);

    await rentalRequests.submit.handler(ctx, {
      token: "renter", bookingId: booking._id, requestId: "rental-change-request-0001", kind: "refund",
      detail: "Please review my refund request.",
    });
    const requestTimer = latestTimer()[2];
    assert.equal(thread.escalated, true, "refund review requests hand off to the team");
    await db.patch(thread._id, { tgMessageId: 42 });
    const resumeMessagesBefore = tables.get("messages").filter((message) => message.text === "Gaffer is back to help with this rental.").length;
    assert.deepEqual(await chat._adminReply.handler(ctx, { tgMessageId: 42, text: "/gaffer" }), { ok: true });
    assert.equal(thread.escalated, false, "the explicit /gaffer command reactivates the assistant");
    assert.equal(thread.tgMessageId, undefined, "a completed handoff no longer accepts replies against its stale Telegram pointer");
    assert.equal(tables.get("messages").filter((message) => message.text === "Gaffer is back to help with this rental.").length, resumeMessagesBefore + 1);
    const afterFirstResume = tables.get("messages").length;
    assert.deepEqual(await chat._adminReply.handler(ctx, { tgMessageId: 42, text: "/gaffer" }), { ok: false }, "a replayed Telegram command cannot append another resume message");
    assert.equal(tables.get("messages").length, afterFirstResume);
    now = requestTimer.expectedActivityAt + GAFFER_AUTO_RESUME_MS;
    assert.deepEqual(await chat.autoResumeGaffer.handler(ctx, requestTimer), { resumed: false }, "the scheduled timer cannot reprocess a handoff already resumed explicitly");
    assert.equal(thread.escalated, false);

    await chat.send.handler(ctx, { token: "renter", bookingId: booking._id, text: "Please connect me to the team again." });
    await chat.requestHuman.handler(ctx, { token: "renter", bookingId: booking._id, offerMessageId: await offerHumanForLatestRenter(booking._id) });
    const renterResumeTimer = latestTimer()[2];
    await db.patch(thread._id, { tgMessageId: 43 });
    const messageCountBeforeRenterResume = tables.get("messages").length;
    assert.deepEqual(await chat.resumeGaffer.handler(ctx, { token: "renter", bookingId: booking._id }), { ok: true });
    assert.equal(thread.escalated, false, "the renter can resume Gaffer during a human handoff");
    assert.equal(thread.tgMessageId, undefined, "renter resume invalidates the prior Telegram reply target");
    assert.deepEqual(await chat._adminReply.handler(ctx, { tgMessageId: 43, text: "A delayed reply after renter resume." }), { ok: false });
    assert.equal(thread.escalated, false, "a delayed team reply cannot undo a renter's resume choice");
    assert.deepEqual(await chat.autoResumeGaffer.handler(ctx, renterResumeTimer), { resumed: false }, "the stale four-hour timer cannot act after renter resume");
    assert.equal(tables.get("messages").length, messageCountBeforeRenterResume + 1, "resume writes one status message and stale work writes none");

    await rentalChat.setHandler.handler(ctx, { token: "fixture-admin", accountId: account._id, gaffer: false });
    assert.equal(supportThread.escalated, true, "manual human takeover starts the same four-hour lifecycle");
    const firstManualTimer = latestTimer()[2];
    now += 60 * 1000;
    const renterDuringHandoff = await chat.send.handler(ctx, {
      token: "renter",
      text: "Could someone update me?",
      requestId: "human-owned-renter-message-0001",
    });
    assert.equal(renterDuringHandoff.handledByHuman, true, "a new renter message stays with the team while the handoff is active");
    assert.equal(supportThread.escalated, true, "a renter message cannot reactivate Gaffer before the hand-back deadline");
    assert.equal(latestTimer()[2].expectedActivityAt, firstManualTimer.expectedActivityAt, "a renter message does not move the human-activity deadline");
    const messagesBeforeRetry = tables.get("messages").length;
    const scheduledBeforeRetry = scheduled.length;
    const renterRetry = await chat.send.handler(ctx, {
      token: "renter",
      text: "Could someone update me?",
      requestId: "human-owned-renter-message-0001",
    });
    assert.equal(renterRetry.duplicate, true, "retrying a renter message during handoff does not create new activity");
    assert.equal(tables.get("messages").length, messagesBeforeRetry, "the renter retry does not duplicate the message");
    assert.equal(scheduled.length, scheduledBeforeRetry, "the renter retry does not create a second handoff or timer");
    await db.patch(supportThread._id, { tgMessageId: 44 });
    await rentalChat.setHandler.handler(ctx, { token: "fixture-admin", accountId: account._id, gaffer: true });
    assert.equal(supportThread.escalated, false, "admin hand-back restores Gaffer");
    assert.equal(supportThread.tgMessageId, undefined, "admin hand-back invalidates the previous Telegram reply target");
    assert.deepEqual(await chat.autoResumeGaffer.handler(ctx, firstManualTimer), { resumed: false }, "a manual hand-back invalidates the old scheduled timer");
    assert.deepEqual(await chat._adminReply.handler(ctx, { tgMessageId: 44, text: "A delayed reply after admin hand-back." }), { ok: false });
    assert.equal(supportThread.escalated, false, "a stale Telegram reply cannot undo admin hand-back");

    const humanFirstAccount = put("accounts", { email: "human-first-chat@test.invalid" });
    put("sessions", { token: "human-first-renter", accountId: humanFirstAccount._id, expiresAt: now + 24 * 60 * 60 * 1000 });
    await chat.send.handler(ctx, { token: "human-first-renter", text: "Please have someone check this for me.", requestId: "human-first-chat-question-0001" });
    const humanFirstThread = tables.get("chat_threads").find((item) => item.accountId === humanFirstAccount._id && item.bookingId == null);
    const humanFirstQuestion = tables.get("messages").find((item) => item.accountId === humanFirstAccount._id && item.sender === "renter");
    assert.equal(String(humanFirstThread.firstRenterMessageId), String(humanFirstQuestion._id), "the new support thread records the first renter message before a human reply");
    assert.equal(humanFirstThread.notificationPromptMessageId, undefined, "no invitation is anchored before the first response");
    await db.patch(humanFirstThread._id, { escalated: true, tgMessageId: 901 });
    await chat._adminReply.handler(ctx, { tgMessageId: 901, text: "A team member has picked this up." });
    const firstHumanAnswer = tables.get("messages").find((item) => item.accountId === humanFirstAccount._id && item.sender === "owner");
    assert.equal(String(humanFirstThread.notificationPromptMessageId), String(firstHumanAnswer._id), "a human-first support response anchors the invitation to the actual answer");
    const initialHumanConversation = await renterChat.messages.handler(ctx, { token: "human-first-renter", admin: false, paginationOpts: { numItems: 50, cursor: null } });
    assert.equal(String(initialHumanConversation.notificationPromptMessageId), String(firstHumanAnswer._id), "the renter UI receives the first human-answer anchor");
    assert(initialHumanConversation.page.some((message) => String(message._id) === String(firstHumanAnswer._id)), "the first human answer is loaded before the prompt can render beside it");

    await db.patch(humanFirstThread._id, { closedAt: now - 1 });
    const followUp = await chat.send.handler(ctx, { token: "human-first-renter", text: "I have one more question.", requestId: "human-first-chat-question-0002" });
    assert.equal(followUp.handledByHuman, true, "reopening the support chat keeps the conversation with the team");
    assert.equal(humanFirstThread.closedAt, undefined, "reopening the chat does not create a duplicate thread");
    await db.patch(humanFirstThread._id, { tgMessageId: 902 });
    await chat._adminReply.handler(ctx, { tgMessageId: 902, text: "We have checked that for you." });
    assert.equal(String(humanFirstThread.notificationPromptMessageId), String(firstHumanAnswer._id), "repeat human replies and reopened chats do not move or duplicate the invitation anchor");
    const reopenedHumanConversation = await renterChat.messages.handler(ctx, { token: "human-first-renter", admin: false, paginationOpts: { numItems: 50, cursor: null } });
    assert.equal(String(reopenedHumanConversation.notificationPromptMessageId), String(firstHumanAnswer._id), "reopening the same thread preserves its one-time invitation");

    console.log("PASS account-wide support thread, separate rental thread, four-hour idle handoff, stale-timer protection, and no proactive Gaffer reply.");
  } finally {
    Date.now = originalNow;
    delete process.env.ADMIN_TOKEN;
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
