/** Shared DB Cinema email transport under controlled HTTP; no network deliveries. */
const assert = require("node:assert/strict");
const h = require("./lib/rentalTestHarness.cjs");
const requests = [];
const { sendMail, sendBusinessMail, sendBusinessMailTracked, OWNER_EMAIL } = h.load("convex/lib/mailer.ts");
const originalFetch = global.fetch;

Object.assign(process.env, {
  GMAIL_USER: "dbcinemarentals@gmail.com",
  GMAIL_APP_PASSWORD: "legacy-unused",
  OWNER_EMAIL: "bookings@dbcinemarentals.com",
  RESEND_API_KEY: "resend-test-only",
  RESEND_FROM: "DB Cinema Rentals <bookings@dbcinemarentals.com>",
});
global.fetch = async (url, options) => {
  requests.push({ url, options });
  return new Response(JSON.stringify({ id: `resend-email-${requests.length}` }), { status: 200 });
};

(async () => {
  try {
    const message = {
      to: "customer@example.invalid",
      cc: ["dbcinemarentals@gmail.com"],
      subject: "Runtime QA",
      html: "<p>QA</p>",
      deliveryKey: "bookings-qa:payment:1",
    };

    assert.equal(OWNER_EMAIL(), "dbcinemarentals@gmail.com", "legacy OWNER_EMAIL cannot override the monitored inbox");
    assert.equal(await sendMail(message), true);
    assert.equal(requests.length, 1, "mail uses the centralized Resend transport even if legacy Gmail SMTP credentials exist");
    assert.equal(requests[0].url, "https://api.resend.com/emails");
    assert.equal(requests[0].options.headers["Idempotency-Key"], message.deliveryKey);
    const payload = JSON.parse(requests[0].options.body);
    assert.equal(payload.from, "DB Cinema Rentals <bookings@dbcinemarentals.com>");
    assert.equal(payload.reply_to, "dbcinemarentals@gmail.com");
    assert.deepEqual(payload.cc, message.cc);

    const tracked = await sendBusinessMailTracked(message);
    assert.equal(tracked.sent, true);
    assert.equal(tracked.ambiguous, false, "provider acceptance is recorded as a confirmed outcome");
    assert.equal(tracked.resendEmailId, "resend-email-2", "central inbox sends retain Resend's provider ID for later delivery events");

    global.fetch = async () => new Response(JSON.stringify({ error: "invalid_recipient" }), { status: 422 });
    const rejected = await sendBusinessMailTracked(message);
    assert.equal(rejected.sent, false);
    assert.equal(rejected.ambiguous, false, "a definite provider rejection remains retryable");
    global.fetch = async () => new Response(JSON.stringify({ error: "temporary_failure" }), { status: 503 });
    const uncertainServer = await sendBusinessMailTracked(message);
    assert.equal(uncertainServer.sent, false);
    assert.equal(uncertainServer.ambiguous, true, "a 5xx can follow provider acceptance");
    global.fetch = async () => { throw new Error("connection reset after submit"); };
    const uncertainNetwork = await sendBusinessMailTracked(message);
    assert.equal(uncertainNetwork.sent, false);
    assert.equal(uncertainNetwork.ambiguous, true, "a lost response is an ambiguous provider outcome");
    global.fetch = async (url, options) => {
      requests.push({ url, options });
      return new Response(JSON.stringify({ id: `resend-email-${requests.length}` }), { status: 200 });
    };

    const beforeMissingTransport = requests.length;
    delete process.env.RESEND_API_KEY;
    assert.equal(await sendMail(message), false, "Gmail SMTP credentials alone cannot send website mail");
    assert.equal(requests.length, beforeMissingTransport, "missing Resend configuration fails closed");

    process.env.RESEND_API_KEY = "resend-test-only";
    const followUp = { ...message, replyTo: "gaffer+0123456789abcdef01234567@inbound.dbcinemarentals.com" };
    assert.equal(await sendBusinessMail(followUp), true);
    const followUpPayload = JSON.parse(requests.at(-1).options.body);
    assert.equal(followUpPayload.reply_to, followUp.replyTo, "Gaffer reply threading remains supported");
    assert.equal(requests.at(-1).options.headers["Idempotency-Key"], message.deliveryKey);

    process.env.RESEND_FROM = "DB Cinema Rentals <bookings@unverified.example.invalid>";
    const beforeBadSender = requests.length;
    assert.equal(await sendBusinessMail(message), false, "a non-DB Cinema sender fails closed");
    assert.equal(requests.length, beforeBadSender);

    console.log("PASS mail transport: all site mail uses the verified DB Cinema Resend sender, replies default to the monitored Gmail, explicit Gaffer threading works, stale owner overrides and SMTP credentials are ignored, and missing/invalid transport configuration fails closed. No network or customer sends.");
  } finally {
    global.fetch = originalFetch;
    delete process.env.GMAIL_USER;
    delete process.env.GMAIL_APP_PASSWORD;
    delete process.env.OWNER_EMAIL;
    delete process.env.RESEND_API_KEY;
    delete process.env.RESEND_FROM;
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
