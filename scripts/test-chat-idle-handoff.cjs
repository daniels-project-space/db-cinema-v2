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
const booking = put("bookings", { accountId: account._id, guestEmail: account.email, status: "confirmed" });
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

(async () => {
  try {
    await chat.send.handler(ctx, { token: "renter", text: "Account question" });
    await chat.send.handler(ctx, { token: "renter", bookingId: booking._id, text: "Rental question" });
    const threads = tables.get("chat_threads").filter((thread) => thread.accountId === account._id);
    assert.equal(threads.length, 2, "account enquiries share one thread while each rental remains separate");
    assert.equal(threads.filter((thread) => thread.bookingId == null).length, 1);
    assert.equal(threads.filter((thread) => thread.bookingId === booking._id).length, 1);

    await chat.requestHuman.handler(ctx, { token: "renter" });
    const accountTimer = latestTimer()[2];
    assert.equal(latestTimer()[0], 4 * 60 * 60 * 1000, "account support uses a four-hour idle handoff");
    const accountMessagesAtHandoff = tables.get("messages").length;
    now = accountTimer.expectedUpdatedAt + GAFFER_AUTO_RESUME_MS;
    assert.deepEqual(await chat.autoResumeGaffer.handler(ctx, accountTimer), { resumed: true });
    assert.equal(tables.get("messages").length, accountMessagesAtHandoff, "account support timer never sends an unsolicited message");
    assert.equal(threads.find((thread) => thread.bookingId == null).escalated, false);
    await chat.send.handler(ctx, { token: "renter", text: "I still need account help." });
    gafferReplyForLatestRenter();

    await chat.requestHuman.handler(ctx, { token: "renter", bookingId: booking._id });
    const initialTimer = latestTimer()[2];
    assert.equal(latestTimer()[0], GAFFER_AUTO_RESUME_MS);
    const messageCountAtHandoff = tables.get("messages").length;

    now = initialTimer.expectedUpdatedAt + 3 * 60 * 60 * 1000;
    assert.deepEqual(await chat.autoResumeGaffer.handler(ctx, initialTimer), { resumed: false, rescheduled: true }, "a previously scheduled three-hour timer waits for the new four-hour deadline");
    assert.equal(latestTimer()[0], 60 * 60 * 1000);
    now = initialTimer.expectedUpdatedAt + GAFFER_AUTO_RESUME_MS - 1;
    const early = await chat.autoResumeGaffer.handler(ctx, initialTimer);
    assert.deepEqual(early, { resumed: false, rescheduled: true });

    now = initialTimer.expectedUpdatedAt + GAFFER_AUTO_RESUME_MS;
    assert.deepEqual(await chat.autoResumeGaffer.handler(ctx, initialTimer), { resumed: true });
    const thread = tables.get("chat_threads").find((item) => item.bookingId === booking._id);
    assert.equal(thread.escalated, false);
    assert.equal(tables.get("messages").length, messageCountAtHandoff, "the timer never sends an unsolicited message");

    await chat.send.handler(ctx, { token: "renter", bookingId: booking._id, text: "I still need help" });
    gafferReplyForLatestRenter();

    await chat.requestHuman.handler(ctx, { token: "renter", bookingId: booking._id });
    const staleTimer = latestTimer()[2];
    await db.patch(thread._id, { tgMessageId: 42 });
    now += 60 * 60 * 1000;
    await chat._adminReply.handler(ctx, { tgMessageId: 42, text: "We are checking this for you." });
    const refreshedTimer = latestTimer()[2];
    assert.notEqual(refreshedTimer.expectedUpdatedAt, staleTimer.expectedUpdatedAt);

    now = staleTimer.expectedUpdatedAt + GAFFER_AUTO_RESUME_MS;
    assert.deepEqual(await chat.autoResumeGaffer.handler(ctx, staleTimer), { resumed: false }, "older timer cannot end an active human handoff");
    now = refreshedTimer.expectedUpdatedAt + GAFFER_AUTO_RESUME_MS;
    assert.deepEqual(await chat.autoResumeGaffer.handler(ctx, refreshedTimer), { resumed: true });
    assert.equal(thread.escalated, false);

    await chat.requestHuman.handler(ctx, { token: "renter", bookingId: booking._id });
    const beforeSystemMessage = latestTimer()[2];
    now = beforeSystemMessage.expectedUpdatedAt + 60 * 60 * 1000;
    await chat.postSystem.handler(ctx, { accountId: account._id, bookingId: booking._id, text: "The pickup time was updated." });
    const afterSystemMessage = latestTimer()[2];
    assert.notEqual(afterSystemMessage.expectedUpdatedAt, beforeSystemMessage.expectedUpdatedAt, "system messages reschedule the idle handoff timer");
    now = beforeSystemMessage.expectedUpdatedAt + GAFFER_AUTO_RESUME_MS;
    assert.deepEqual(await chat.autoResumeGaffer.handler(ctx, beforeSystemMessage), { resumed: false }, "a stale timer cannot end an active handoff");
    now = afterSystemMessage.expectedUpdatedAt + GAFFER_AUTO_RESUME_MS;
    assert.deepEqual(await chat.autoResumeGaffer.handler(ctx, afterSystemMessage), { resumed: true });
    assert.equal(thread.escalated, false);

    await rentalRequests.submit.handler(ctx, {
      token: "renter", bookingId: booking._id, requestId: "rental-change-request-0001", kind: "dates",
      detail: "Please move the pickup time later.",
    });
    const requestTimer = latestTimer()[2];
    assert.equal(thread.escalated, true, "rental change requests hand off to the team");
    now = requestTimer.expectedUpdatedAt + GAFFER_AUTO_RESUME_MS;
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
