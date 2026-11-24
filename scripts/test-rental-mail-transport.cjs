/** Exercise the real MIME and Gmail API transport with network calls mocked. */
const assert = require("node:assert/strict");
const h = require("./lib/rentalTestHarness.cjs");

const originalFetch = global.fetch;
const envKeys = ["GOOGLE_OAUTH_CLIENT_ID", "GOOGLE_OAUTH_CLIENT_SECRET", "GMAIL_TOKEN_ENCRYPTION_KEY"];
const previousEnv = Object.fromEntries(envKeys.map((key) => [key, process.env[key]]));
const encryptionKey = Buffer.alloc(32, 7).toString("base64");
Object.assign(process.env, {
  GOOGLE_OAUTH_CLIENT_ID: "fixture-client-id",
  GOOGLE_OAUTH_CLIENT_SECRET: "fixture-client-secret",
  GMAIL_TOKEN_ENCRYPTION_KEY: encryptionKey,
});

const oauth = h.load("shared/gmailOAuth.ts");
const action = h.load("convex/gmailTransport.ts").send;
const connection = {
  encryptedRefreshToken: oauth.encryptGmailRefreshToken("fixture-refresh-token", encryptionKey),
};
const requests = [];
let sentMessageId;
let searchCount = 0;

global.fetch = async (url, options = {}) => {
  const request = { url: String(url), options };
  requests.push(request);

  if (request.url === "https://oauth2.googleapis.com/token") {
    const body = new URLSearchParams(request.options.body);
    assert.equal(body.get("refresh_token"), "fixture-refresh-token");
    return Response.json({ access_token: "fixture-access-token", token_type: "Bearer" });
  }
  if (request.url.includes("/messages?") && request.options.method !== "POST") {
    assert.equal(new Headers(request.options.headers).get("authorization"), "Bearer fixture-access-token");
    searchCount += 1;
    return Response.json(searchCount === 1 ? {} : { messages: [{ id: sentMessageId }] });
  }
  if (request.url.endsWith("/messages/send")) {
    assert.equal(new Headers(request.options.headers).get("authorization"), "Bearer fixture-access-token");
    const payload = JSON.parse(request.options.body);
    const mime = Buffer.from(payload.raw, "base64url").toString("utf8");
    assert.match(mime, /To: customer@example\.invalid/i);
    assert.match(mime, /Cc: info@dbcinemarentals\.com/i);
    assert.match(mime, /Subject: Runtime QA/i);
    assert.match(mime, /Reply-To: replies@example\.invalid, owner@example\.invalid/i);
    assert.match(mime, /In-Reply-To: <incoming@example\.invalid>/i);
    assert.match(mime, /References: <incoming@example\.invalid>/i);
    assert.match(mime, /Message-ID: <rental-[a-f0-9]+@dbcinemarentals\.com>/i);
    assert.match(mime, /DB Cinema Rentals Team/);
    assert.equal(payload.threadId, "gmail-thread-fixture");
    sentMessageId = "gmail-message-fixture";
    return Response.json({ id: sentMessageId });
  }
  throw new Error(`Unexpected test fetch: ${request.url}`);
};

const mail = {
  deliveryKey: "bookings-qa:payment:1",
  to: "customer@example.invalid",
  cc: ["info@dbcinemarentals.com"],
  subject: "Runtime QA",
  html: "<p>QA</p>",
  replyTo: ["replies@example.invalid", "owner@example.invalid"],
  inReplyTo: "<incoming@example.invalid>",
  references: ["<incoming@example.invalid>"],
  providerThreadId: "gmail-thread-fixture",
};

(async () => {
  try {
    const ctx = {
      runQuery: async () => connection,
    };
    const first = await action.handler(ctx, { mail });
    assert.equal(first.sent, true);
    assert.equal(first.providerId, "gmail-message-fixture");
    assert.equal(requests.filter(({ url }) => url.endsWith("/messages/send")).length, 1);
    const lookup = requests.find(({ url }) => url.includes("/messages?"));
    assert.match(lookup.url, /rfc822msgid/);

    const retry = await action.handler(ctx, { mail });
    assert.equal(retry.sent, true);
    assert.equal(retry.providerId, "gmail-message-fixture");
    assert.equal(requests.filter(({ url }) => url.endsWith("/messages/send")).length, 1,
      "a retry that finds the sent Message-ID must not send a duplicate");
    console.log("PASS Gmail transport renders branded MIME, preserves email headers and thread, and reuses Sent matches on retry. No network deliveries.");
  } finally {
    global.fetch = originalFetch;
    for (const key of envKeys) {
      if (previousEnv[key] === undefined) delete process.env[key];
      else process.env[key] = previousEnv[key];
    }
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
