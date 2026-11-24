const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { db, docs, load, setMock, tables } = require("./lib/rentalTestHarness.cjs");

const sentMail = [];
let convexClientCreations = 0;
let gafferCalls = 0;
setMock("./lib/mailer", {
  sendMail: async payload => { sentMail.push(payload); return { sent: true }; },
});
setMock("convex/browser", { ConvexHttpClient: class { constructor() { convexClientCreations += 1; } } });
setMock("@/lib/gaffer", { handleChat: async () => { gafferCalls += 1; return { reply: "private reply" }; } });

const contact = load("convex/contact.ts");
const notify = load("convex/notify.ts");
const inboundHandler = load("src/app/api/email/inbound/route.ts");
const scheduled = [];
const ctx = {
  db,
  scheduler: { runAfter: async (delay, reference, args) => scheduled.push({ delay, reference, args }) },
  runMutation: async (reference, args) => {
    assert.match(String(reference), /contact\.markAutoHandled$/);
    return contact.markAutoHandled.handler({ db }, args);
  },
};

const originalFetch = global.fetch;
const originalSecret = process.env.INBOUND_EMAIL_SECRET;
const originalAppUrl = process.env.APP_URL;
const originalTelegramToken = process.env.TELEGRAM_BOT_TOKEN;
const originalTelegramChat = process.env.TELEGRAM_ADMIN_CHAT_ID;
const originalConvexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
const originalResendWebhookSecret = process.env.RESEND_WEBHOOK_SECRET;
const response = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body });

(async () => {
  try {
    process.env.INBOUND_EMAIL_SECRET = "fixture-secret";
    process.env.APP_URL = "https://support.example.invalid";
    process.env.NEXT_PUBLIC_CONVEX_URL = "https://convex.example.invalid";
    delete process.env.RESEND_WEBHOOK_SECRET;
    delete process.env.TELEGRAM_BOT_TOKEN;
    delete process.env.TELEGRAM_ADMIN_CHAT_ID;

    const request = {
      name: "Kevin Johnson",
      email: "kevin@example.invalid",
      message: "I cannot contact support from my rental chat.",
      requestId: "contact-support-request-001",
    };
    const submitted = await contact.submit.handler(ctx, request);
    assert.equal(submitted.duplicate, false);
    assert.equal(tables.get("contact_messages").length, 1);
    assert.equal(tables.get("email_threads").length, 1);
    assert.equal(tables.get("email_messages").length, 1);
    assert.equal(scheduled.length, 1, "a durable enquiry queues exactly one Gaffer attempt");

    const privatePayload = JSON.stringify({
      source: "contact-form",
      contactId: submitted.id,
      name: "Kevin Johnson",
      email: "kevin@example.invalid",
      message: "PRIVATE-UNAUTHORIZED-CUSTOMER-MESSAGE",
    });
    for (const authorization of [undefined, "Bearer wrong-secret"]) {
      const denied = await inboundHandler.POST({
        headers: new Headers(authorization ? { authorization } : {}),
        nextUrl: new URL("https://dbcinemarentals.com/api/email/inbound"),
        text: async () => privatePayload,
      });
      assert.equal(denied.status, 401, "the private contact worker rejects absent or incorrect bearer credentials");
      assert.doesNotMatch(await denied.text(), /PRIVATE-UNAUTHORIZED-CUSTOMER-MESSAGE|kevin@example\.invalid/);
    }
    assert.equal(convexClientCreations, 0, "unauthorized inbound requests never open the private Convex client");
    assert.equal(gafferCalls, 0, "unauthorized inbound requests never invoke Gaffer");

    let calls = 0;
    const requestBodies = [];
    global.fetch = async (url, options) => {
      assert.equal(url, "https://support.example.invalid/api/email/inbound");
      assert.equal(options.headers.authorization, "Bearer fixture-secret");
      requestBodies.push(JSON.parse(options.body));
      calls += 1;
      // The first response is ambiguous: Gaffer may have completed before the 503.
      return calls === 1 ? response(503, { error: "temporary" }) : response(200, { duplicate: true });
    };

    const firstAttempt = await notify.contactAutoReply.handler(ctx, scheduled[0].args);
    assert.deepEqual(firstAttempt, { ok: false, retrying: true });
    assert.equal(scheduled[1].delay, 120_000);
    assert.equal(tables.get("contact_messages")[0].handled, false);
    assert.equal(tables.get("email_messages").length, 1, "a failed Gaffer request never removes the original message");

    const retryAttempt = await notify.contactAutoReply.handler(ctx, scheduled[1].args);
    assert.deepEqual(retryAttempt, { ok: true, replied: false });
    assert.deepEqual(requestBodies[1], requestBodies[0], "an ambiguous retry reuses the same contact identity and payload");
    assert.equal(requestBodies[1].contactId, submitted.id);
    assert.equal(tables.get("email_messages").length, 1, "duplicate webhook acknowledgement does not duplicate the customer enquiry");
    assert.equal(docs.get(submitted.id).handled, true);

    // Expired retries alert the team, but do not include renter message or address in the alert.
    sentMail.length = 0;
    scheduled.length = 0;
    global.fetch = async () => response(503, { error: "internal details" });
    const expired = await notify.contactAutoReply.handler(ctx, {
      ...scheduled[0]?.args,
      contactId: submitted.id,
      name: "Kevin Johnson",
      email: "kevin@example.invalid",
      message: "SECRET-RENTER-DETAILS-DO-NOT-LEAK",
      attempt: 3,
    });
    assert.deepEqual(expired, { ok: false, escalated: true });
    assert.equal(sentMail.length, 1, "exhaustion creates one owner alert");
    assert.equal(sentMail[0].to, "dbcinemarentals@gmail.com");
    assert.match(sentMail[0].html, new RegExp(submitted.id));
    assert.doesNotMatch(sentMail[0].html, /SECRET-RENTER-DETAILS-DO-NOT-LEAK|kevin@example\.invalid|Kevin Johnson/);

    // A missing worker secret is a configuration failure, not a false Gaffer success.
    sentMail.length = 0;
    delete process.env.INBOUND_EMAIL_SECRET;
    calls = 0;
    global.fetch = async () => { calls += 1; throw new Error("must not call the worker without auth"); };
    const missingSecret = await notify.contactAutoReply.handler(ctx, {
      contactId: submitted.id,
      name: "Kevin Johnson",
      email: "kevin@example.invalid",
      message: "A support question that remains in the inbox.",
    });
    assert.deepEqual(missingSecret, { ok: false, escalated: true });
    assert.equal(calls, 0, "the app does not call the inbound worker without its bearer secret");
    assert.equal(tables.get("email_messages").length, 1, "configuration failures preserve the central inbox message");
    assert.equal(sentMail.length, 1);

    const contactSource = fs.readFileSync(path.join(__dirname, "../convex/contact.ts"), "utf8");
    const contactPage = fs.readFileSync(path.join(__dirname, "../src/app/contact/page.tsx"), "utf8");
    const inboundSource = fs.readFileSync(path.join(__dirname, "../src/app/api/email/inbound/route.ts"), "utf8");
    const chatBubble = fs.readFileSync(path.join(__dirname, "../src/components/chat/ChatKit.tsx"), "utf8");
    assert.match(contactSource, /return \{ id: null, suppressed: true as const \}/, "honeypot suppression is distinguishable from successful delivery");
    assert.match(contactPage, /if \(!result\?\.id\) throw new Error/, "a suppressed or missing submission cannot show a false success");
    assert.match(contactPage, /renterFacingError\(e,/, "technical transport details are reduced to safe renter-facing guidance");
    assert.match(contactPage, /Gaffer will try to answer/, "the confirmation accurately describes Gaffer's first response");
    assert.doesNotMatch(contactPage, /The Grand Building|WC2N\s*5EJ|Waterstones/i, "public contact copy must not reveal the private pickup address or meeting landmark");
    assert.match(contactPage, /exact meeting point after payment, verification and booking confirmation/i, "contact page tells renters when exact pickup details are disclosed");
    assert.match(inboundSource, /providerId: `contact-form:\$\{contactId\}`/, "contact retries share a stable provider id for durable dedupe");
    assert.match(inboundSource, /claim\.state === "done"[\s\S]*?duplicate: true/, "an ambiguous retry safely acknowledges already-completed Gaffer work");
    assert.match(chatBubble, /Open contact form/, "Gaffer's contact route is presented as a named action, not a pasted URL");
    console.log("PASS contact support reliability: ambiguous retry, exhausted/configuration failures, durable inbox retention, privacy-safe escalation, and false-success prevention.");
  } finally {
    global.fetch = originalFetch;
    if (originalSecret === undefined) delete process.env.INBOUND_EMAIL_SECRET; else process.env.INBOUND_EMAIL_SECRET = originalSecret;
    if (originalAppUrl === undefined) delete process.env.APP_URL; else process.env.APP_URL = originalAppUrl;
    if (originalTelegramToken === undefined) delete process.env.TELEGRAM_BOT_TOKEN; else process.env.TELEGRAM_BOT_TOKEN = originalTelegramToken;
    if (originalTelegramChat === undefined) delete process.env.TELEGRAM_ADMIN_CHAT_ID; else process.env.TELEGRAM_ADMIN_CHAT_ID = originalTelegramChat;
    if (originalConvexUrl === undefined) delete process.env.NEXT_PUBLIC_CONVEX_URL; else process.env.NEXT_PUBLIC_CONVEX_URL = originalConvexUrl;
    if (originalResendWebhookSecret === undefined) delete process.env.RESEND_WEBHOOK_SECRET; else process.env.RESEND_WEBHOOK_SECRET = originalResendWebhookSecret;
  }
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
