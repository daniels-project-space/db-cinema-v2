const assert = require("node:assert/strict");
const { db, docs, load, put, setMock } = require("./lib/rentalTestHarness.cjs");

const sent = [];
const results = [];
setMock("./lib/mailer", {
  OWNER_EMAIL: "dbcinemarentals@gmail.com",
  sendMail: async (message) => {
    sent.push(message);
    return results.shift() ?? false;
  },
  sendBusinessMail: async () => false,
  deliveryMessageId: (key) => `<${key}@test.invalid>`,
});
setMock("./lib/rentalChat", { postRentalMessage: async () => {} });
delete process.env.TELEGRAM_BOT_TOKEN;
delete process.env.TELEGRAM_ADMIN_CHAT_ID;
process.env.INBOUND_EMAIL_SECRET = "fixture-inbound-secret";

const { emailHumanRequestAlert, followUpReplyAlert } = load("convex/notify.ts");
const { claimInbound, markHumanRequested, scheduleHumanRequestAlertRetry } = load("convex/emailInbox.ts");
const scheduled = [];
const ctx = {
  db,
  scheduler: { runAfter: async (...args) => scheduled.push(args) },
  runMutation: async (reference, args) => {
    assert.equal(reference, "emailInbox.scheduleHumanRequestAlertRetry");
    return scheduleHumanRequestAlertRetry.handler(ctx, args);
  },
};
const base = {
  email: "customer@example.test",
  subject: "Mic rental request",
  body: "Could someone call me about availability?",
  inboundId: "email_messages-human-1",
};

(async () => {
  results.push(false, true);
  await emailHumanRequestAlert.handler(ctx, { ...base, attempt: 1 });
  assert.equal(scheduled.length, 1, "a failed mail send must schedule a retry");
  assert.equal(scheduled[0][0], 15_000, "the first retry is prompt");
  assert.equal(scheduled[0][1], "notify.emailHumanRequestAlert");
  assert.equal(scheduled[0][2].attempt, 2);
  await emailHumanRequestAlert.handler(ctx, scheduled[0][2]);
  assert.equal(sent[0].to, "dbcinemarentals@gmail.com");
  assert.equal(sent[1].to, "dbcinemarentals@gmail.com");
  assert.equal(sent[0].deliveryKey, sent[1].deliveryKey, "retries retain one delivery identity");
  assert.equal(scheduled.length, 1, "successful delivery must stop retries");

  const next = { ...base, inboundId: "email_messages-human-2" };
  results.push(false, false, false);
  await emailHumanRequestAlert.handler(ctx, { ...next, attempt: 1 });
  await emailHumanRequestAlert.handler(ctx, scheduled[1][2]);
  await emailHumanRequestAlert.handler(ctx, scheduled[2][2]);
  assert.equal(scheduled[1][0], 15_000);
  assert.equal(scheduled[2][0], 60_000);
  assert.equal(scheduled.length, 3, "three failed deliveries end without an unbounded retry loop");

  const thread = put("email_threads", {
    email: "customer@example.test",
    subject: "Mic rental request",
    status: "open",
  });
  const inbound = put("email_messages", {
    threadId: thread._id,
    direction: "in",
    state: "received",
    text: "Would your team please contact me directly?",
    humanRequested: false,
  });
  const inboundId = inbound._id;
  const beforeHandoff = scheduled.length;
  await claimInbound.handler(ctx, { secret: "fixture-inbound-secret", inboundId, humanRequested: true });
  assert.equal(scheduled.length, beforeHandoff, "Gaffer claims and processes the email before any owner alert is scheduled");
  assert.equal(docs.get(thread._id).status, "open");
  const firstHandoff = await markHumanRequested.handler(ctx, { secret: "fixture-inbound-secret", inboundId });
  assert.equal(firstHandoff.duplicate, false);
  assert.equal(docs.get(thread._id).status, "human_requested");
  assert.equal(docs.get(inboundId).humanRequested, true);
  assert.equal(scheduled.length, beforeHandoff + 1, "Gaffer's semantic handoff schedules the urgent owner email");
  assert.equal(scheduled.at(-1)[1], "notify.emailHumanRequestAlert");
  const secondHandoff = await markHumanRequested.handler(ctx, { secret: "fixture-inbound-secret", inboundId });
  assert.equal(secondHandoff.duplicate, true);
  assert.equal(scheduled.length, beforeHandoff + 1, "retries do not duplicate an urgent human alert");
  const beforeLegacyReply = sent.length;
  const legacyReply = await followUpReplyAlert.handler(ctx, { email: "customer@example.test", body: "Can you help me?" });
  assert.equal(legacyReply.ignored, "legacy owner-only routing disabled");
  assert.equal(sent.length, beforeLegacyReply, "legacy Gaffer replies are never forwarded directly to the owner");
  process.stdout.write("Human-request email delivery retries and bounded failure checks passed.\n");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
