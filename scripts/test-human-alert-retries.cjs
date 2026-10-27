const assert = require("node:assert/strict");
const { load, setMock } = require("./lib/rentalTestHarness.cjs");

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

const { emailHumanRequestAlert } = load("convex/notify.ts");
const { scheduleHumanRequestAlertRetry } = load("convex/emailInbox.ts");
const scheduled = [];
const ctx = {
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
  process.stdout.write("Human-request email delivery retries and bounded failure checks passed.\n");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
