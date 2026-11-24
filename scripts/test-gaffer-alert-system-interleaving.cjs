const assert = require("node:assert/strict");
const { load, db, put, tables } = require("./lib/rentalTestHarness.cjs");

const chat = load("convex/chat.ts");
const rentalChat = load("convex/lib/rentalChat.ts");
const scheduled = [];
const ctx = {
  db,
  scheduler: {
    runAfter: async (...args) => {
      scheduled.push(args);
      return put("_scheduled_functions", { state: { kind: "pending" } })._id;
    },
  },
};
const originalNow = Date.now;
let now = originalNow();
Date.now = () => now;

const account = put("accounts", { email: "gaffer-alert-interleaving@example.invalid" });
const booking = put("bookings", { accountId: account._id, status: "confirmed", lineItems: [] });

async function answeredQuestion(text) {
  const renterMessageId = await rentalChat.postRentalMessage(ctx, {
    accountId: account._id,
    bookingId: booking._id,
    sender: "renter",
    text,
    deferOwnerAlert: true,
  });
  const thread = await rentalChat.rentalThread(ctx, account._id, booking._id);
  assert.equal(await chat._postBot.handler(ctx, {
    accountId: account._id,
    bookingId: booking._id,
    replyTo: renterMessageId,
    generation: thread.gafferGeneration ?? 0,
    text: "Here is the answer.",
    answerComplete: true,
  }), true);
  const job = tables.get("gaffer_alert_jobs").find((candidate) => candidate.renterMessageId === renterMessageId);
  assert(job, "an explicitly resolved Gaffer answer schedules its delayed check");
  return job;
}

function addSystemMessageAfter(job, text) {
  const bot = tables.get("messages").find((message) => message._id === job.botMessageId);
  const at = bot.at + 1;
  put("messages", { accountId: account._id, bookingId: booking._id, sender: "system", text, at });
  const thread = tables.get("chat_threads").find((row) => row.accountId === account._id && row.bookingId === booking._id);
  Object.assign(thread, { updatedAt: at, lastMessage: text, lastSender: "system" });
}

(async () => {
  try {
    const directJob = await answeredQuestion("Can you check this for me?");
    addSystemMessageAfter(directJob, "The rental status was updated.");
    now = directJob.dueAt;
    assert.deepEqual(await chat.delayedGafferInquiry.handler(ctx, { id: directJob._id }), { notified: true },
      "a system update is not a renter reply and must not suppress the 10-minute team follow-up");
    assert.equal(tables.get("admin_notifications").filter((row) => row.eventKey === `gaffer-handled:${directJob.botMessageId}`).length, 1);
    assert.deepEqual(await chat.delayedGafferInquiry.handler(ctx, { id: directJob._id }), { notified: false },
      "replaying a completed timer cannot duplicate the notification");

    now += 1;
    const repliedJob = await answeredQuestion("A new question before the quiet period ends");
    await rentalChat.postRentalMessage(ctx, {
      accountId: account._id,
      bookingId: booking._id,
      sender: "renter",
      text: "I have one more question.",
      deferOwnerAlert: true,
    });
    now = repliedJob.dueAt;
    assert.deepEqual(await chat.delayedGafferInquiry.handler(ctx, { id: repliedJob._id }), { notified: false },
      "an actual renter reply still cancels the stale answer's notification");

    now += 1;
    const recoveryJob = await answeredQuestion("Another resolved question");
    addSystemMessageAfter(recoveryJob, "A booking status note was added.");
    const failedSchedule = await db.get(recoveryJob.scheduledId);
    failedSchedule.state = { kind: "failed" };
    recoveryJob.checkAt = now - 1;
    await chat.recoverGafferAlerts.handler(ctx, {});
    assert.equal(recoveryJob.state, "pending", "recovery preserves a valid alert when only system activity followed the answer");
    assert.equal(recoveryJob.attempts, 2, "a failed scheduled check is retried through the bounded recovery path");
    assert.notEqual(recoveryJob.scheduledId, failedSchedule._id, "recovery creates a replacement timer");
    now = recoveryJob.dueAt;
    assert.deepEqual(await chat.delayedGafferInquiry.handler(ctx, { id: recoveryJob._id }), { notified: true },
      "the recovered timer still notifies after the original 10-minute quiet period");

    console.log("PASS Gaffer quiet-period alerts: system updates do not suppress follow-up; renter replies cancel it; failed timers recover idempotently.");
  } finally {
    Date.now = originalNow;
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
