const assert = require("node:assert/strict");
const { load, db, put, tables } = require("./lib/rentalTestHarness.cjs");

const chat = load("convex/chat.ts");
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
const booking = put("bookings", { accountId: account._id, guestEmail: account.email, status: "confirmed", paidConfirmedAt:now, verificationProvider:"didit", idVerifyStatus:"verified", idVerificationSource:"didit", idVerifiedAt:now, verificationChecks:{identity:"approved",selfie:"approved",address:"approved"} });
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
  await chat._postBot.handler(ctx, { accountId: account._id, bookingId, replyTo: renter._id, generation: thread.gafferGeneration ?? 0, text: "I found the answer.", answerComplete: true });
  const job = [...tables.get("gaffer_alert_jobs")].reverse().find((item) => item.bookingId === bookingId && item.state === "pending");
  assert(job, "a resolved answer schedules the ten-minute follow-up");
  now = job.dueAt;
  await chat.delayedGafferInquiry.handler(ctx, { id: job._id });
  return [...(tables.get("messages") ?? [])].reverse().find((message) => message.sender === "bot" && message.bookingId === bookingId)._id;
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

    now = initialTimer.expectedActivityAt + GAFFER_AUTO_RESUME_MS;
    assert.deepEqual(await chat.autoResumeGaffer.handler(ctx, initialTimer), { resumed: true });
    const thread = tables.get("chat_threads").find((item) => item.bookingId === booking._id);
    assert.equal(thread.escalated, false);
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
    await chat.send.handler(ctx, { token: "renter", bookingId: booking._id, text: "I still need help." });
    assert.equal(latestTimer()[2].expectedActivityAt, beforeSystemMessage.expectedActivityAt, "renter messages do not extend the human idle window");
    now = beforeSystemMessage.expectedActivityAt + GAFFER_AUTO_RESUME_MS;
    assert.deepEqual(await chat.autoResumeGaffer.handler(ctx, beforeSystemMessage), { resumed: true }, "Gaffer resumes four hours after the last human activity despite renter or system messages");
    assert.equal(thread.escalated, false);

    await rentalRequests.submit.handler(ctx, {
      token: "renter", bookingId: booking._id, requestId: "rental-change-request-0001", kind: "dates",
      detail: "Please move the pickup time later.",
    });
    const requestTimer = latestTimer()[2];
    assert.equal(thread.escalated, true, "rental change requests hand off to the team");
    now = requestTimer.expectedActivityAt + GAFFER_AUTO_RESUME_MS;
    assert.deepEqual(await chat.autoResumeGaffer.handler(ctx, requestTimer), { resumed: true }, "rental change requests receive the same four-hour idle timer");
    assert.equal(thread.escalated, false);
    console.log("PASS account-wide support thread, separate rental thread, four-hour idle handoff, stale-timer protection, and no proactive Gaffer reply.");
  } finally {
    Date.now = originalNow;
    delete process.env.ADMIN_TOKEN;
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
