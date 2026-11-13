const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const { load, db, put, setMock, tables } = require("./lib/rentalTestHarness.cjs");
const { emailDeliveryStatusLabel, mergeEmailRecipientDeliveryStatuses } = load("shared/emailDeliveryStatus.ts");

const env = ["INBOUND_EMAIL_SECRET", "NEXT_PUBLIC_CONVEX_URL", "RESEND_WEBHOOK_SECRET", "RESEND_API_KEY"];
const saved = Object.fromEntries(env.map(key => [key, process.env[key]]));
process.env.INBOUND_EMAIL_SECRET = "delivery-status-fixture-secret";

async function testReceiptAndRace() {
  process.env.RESEND_API_KEY = "not-used-by-delivery-events";
  const inbox = load("convex/emailInbox.ts");
  const scheduled = [];
  const ctx = { db: Object.create(db), scheduler: { runAfter: async (...args) => scheduled.push(args) } };
  const thread = put("email_threads", {
    email: "renter@example.invalid", subject: "Rental update", status: "open", createdAt: 10,
    updatedAt: 10, lastAt: 10, lastDirection: "in", lastText: "Question", unreadOwner: 1,
  });
  const inbound = put("email_messages", {
    threadId: thread._id, direction: "in", sender: thread.email, recipient: "dbcinemarentals@gmail.com",
    subject: thread.subject, text: "Question", at: 10, state: "processing", humanRequested: false,
  });
  const outbound = put("email_messages", {
    threadId: thread._id, direction: "out", sender: "bookings@dbcinemarentals.com", recipient: thread.email,
    subject: thread.subject, text: "Answer", at: 11, providerId: "out:email-auto:inbound-fixture",
    state: "processing", leaseUntil: Date.now() + 60_000, humanRequested: false,
  });
  const deliveryEvent = {
    secret: process.env.INBOUND_EMAIL_SECRET,
    webhookEventId: "evt-delivered-before-finalize",
    resendEmailId: "resend-email-fixture-1",
    eventType: "delivered",
    recipients: [thread.email],
    from: "DB Cinema Rentals <bookings@dbcinemarentals.com>",
    occurredAt: 1_700_000_000_000,
  };

  const early = await inbox.recordResendDeliveryEvent.handler(ctx, deliveryEvent);
  assert.equal(early.pending, true, "delivery may arrive before the send finalizer saves Resend's ID");
  const duplicateEarly = await inbox.recordResendDeliveryEvent.handler(ctx, deliveryEvent);
  assert.equal(duplicateEarly.duplicate, true, "an early webhook retry is idempotent");
  assert.equal((tables.get("email_delivery_events") || []).length, 1, "duplicate early events create one pending receipt");
  assert.equal(scheduled.length, 1, "unmatched signed events are cleaned up if no outbox row is ever linked");

  await inbox.finishAutomaticReply.handler(ctx, {
    threadId: thread._id, inboundId: inbound._id, outboundId: outbound._id,
    text: "Answer", messageId: "<fixture@example.invalid>", resendEmailId: deliveryEvent.resendEmailId,
    humanRequested: false,
  });
  let stored = await db.get(outbound._id);
  assert.equal(stored.resendEmailId, deliveryEvent.resendEmailId);
  assert.equal(stored.state, "sent", "provider acceptance remains separate from recipient delivery state");
  assert.deepEqual(stored.recipientDeliveryStatuses, [{
    recipient: thread.email, status: "delivered", at: deliveryEvent.occurredAt,
    eventId: deliveryEvent.webhookEventId,
  }], "finalization links and applies the earlier delivery event");
  assert.equal((tables.get("email_delivery_events") || []).length, 0, "linked pending receipts are consumed transactionally");

  const duplicateAfterLink = await inbox.recordResendDeliveryEvent.handler(ctx, deliveryEvent);
  assert.equal(duplicateAfterLink.updated, false, "replayed event after reconciliation does not change status");

  const sendEvent = async (webhookEventId, eventType, recipient, occurredAt, reason) => inbox.recordResendDeliveryEvent.handler(ctx, {
    ...deliveryEvent,
    webhookEventId,
    eventType,
    recipients: recipient ? [recipient] : [],
    occurredAt,
    ...(reason ? { reason } : {}),
  });
  await sendEvent("evt-delayed", "delivery_delayed", thread.email, deliveryEvent.occurredAt - 100, "Mailbox is temporarily busy");
  stored = await db.get(outbound._id);
  assert.equal(stored.recipientDeliveryStatuses[0].status, "delivered", "out-of-order older delivery-delay events cannot regress a delivered result");
  await sendEvent("evt-bounced", "bounced", thread.email, deliveryEvent.occurredAt + 100, "Mailbox rejected delivery");
  stored = await db.get(outbound._id);
  assert.equal(stored.recipientDeliveryStatuses[0].status, "bounced");
  assert.equal(stored.recipientDeliveryStatuses[0].reason, "Mailbox rejected delivery");
  await sendEvent("evt-complained", "complained", thread.email, deliveryEvent.occurredAt + 200);
  await sendEvent("evt-suppressed", "suppressed", "blocked@example.invalid", deliveryEvent.occurredAt + 300, "Account suppression list");
  await sendEvent("evt-failed", "failed", "failed@example.invalid", deliveryEvent.occurredAt + 400, "Provider failed delivery");
  await sendEvent("evt-cc-delivered", "delivered", "dbcinemarentals@gmail.com", deliveryEvent.occurredAt + 500);
  stored = await db.get(outbound._id);
  const byRecipient = Object.fromEntries(stored.recipientDeliveryStatuses.map(item => [item.recipient, item]));
  assert.equal(byRecipient[thread.email].status, "complained", "a later complaint supersedes the earlier delivery result");
  assert.equal(byRecipient["blocked@example.invalid"].status, "suppressed");
  assert.equal(byRecipient["failed@example.invalid"].status, "failed");
  assert.equal(byRecipient["dbcinemarentals@gmail.com"].status, "delivered", "provider outcomes remain per recipient");

  await assert.rejects(inbox.recordResendDeliveryEvent.handler(ctx, { ...deliveryEvent, secret: "wrong" }), /unauthorized/);
  const unrelated = await inbox.recordResendDeliveryEvent.handler(ctx, {
    ...deliveryEvent, webhookEventId: "evt-unrelated", resendEmailId: "unrelated-id",
    from: "Other sender <elsewhere@example.invalid>",
  });
  assert.equal(unrelated.ignored, "unmatched email", "unmatched traffic from other senders is not retained");

  const orphan = await inbox.recordResendDeliveryEvent.handler(ctx, {
    ...deliveryEvent, webhookEventId: "evt-orphan-expire", resendEmailId: "never-linked",
  });
  assert.equal(orphan.pending, true);
  const pending = (tables.get("email_delivery_events") || []).find(event => event.webhookEventId === "evt-orphan-expire");
  assert(pending);
  await inbox.expirePendingDeliveryEvent.handler(ctx, { pendingId: pending._id });
  assert.equal((tables.get("email_delivery_events") || []).some(event => event._id === pending._id), false, "unmatched receipts expire instead of accumulating");

  assert.deepEqual(mergeEmailRecipientDeliveryStatuses(undefined, []), []);
  assert.equal(emailDeliveryStatusLabel("suppressed"), "Suppressed");
}

async function testSignedWebhookRoute() {
  const calls = [];
  process.env.NEXT_PUBLIC_CONVEX_URL = "https://synthetic-test.convex.cloud";
  const key = Buffer.from("synthetic Resend webhook signing key");
  process.env.RESEND_WEBHOOK_SECRET = `whsec_${key.toString("base64")}`;
  setMock("next/server", { NextResponse: { json: (body, init = {}) => ({ body, status: init.status ?? 200, headers: init.headers }) } });
  setMock("convex/browser", { ConvexHttpClient: class {
    constructor(url) { assert.equal(url, process.env.NEXT_PUBLIC_CONVEX_URL); }
    async mutation(ref, args) { calls.push({ ref, args }); return { ok: true, matched: true, updated: true }; }
  } });
  setMock("@cvx/_generated/api", { api: { emailInbox: { recordResendDeliveryEvent: "emailInbox.recordResendDeliveryEvent" } } });
  setMock("@/lib/gaffer", { handleChat: async () => ({ reply: "not used" }) });
  setMock("@/lib/site", { CONTACT_EMAIL: "dbcinemarentals@gmail.com" });
  const route = load("src/app/api/email/inbound/route.ts");

  const event = {
    type: "email.bounced",
    created_at: "2026-11-12T10:00:00.000Z",
    data: {
      email_id: "resend-email-route-fixture",
      created_at: "2026-11-12T10:00:00.000Z",
      from: "DB Cinema Rentals <bookings@dbcinemarentals.com>",
      to: ["renter@example.invalid"],
      bounce: { message: "Test mailbox rejected", type: "Permanent" },
    },
  };
  const raw = JSON.stringify(event);
  const webhookId = "msg_delivery_fixture_1";
  const timestamp = String(Math.floor(Date.now() / 1000));
  const signature = crypto.createHmac("sha256", key).update(`${webhookId}.${timestamp}.${raw}`).digest("base64");
  const headers = new Map([
    ["svix-id", webhookId],
    ["svix-timestamp", timestamp],
    ["svix-signature", `v1,${signature}`],
  ]);
  const request = {
    text: async () => raw,
    headers: { get: name => headers.get(name.toLowerCase()) ?? null },
    nextUrl: { searchParams: new URLSearchParams() },
  };
  const response = await route.POST(request);
  assert.equal(response.status, 200);
  assert.equal(response.body.matched, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].ref, "emailInbox.recordResendDeliveryEvent");
  assert.equal(calls[0].args.eventType, "bounced");
  assert.deepEqual(calls[0].args.recipients, ["renter@example.invalid"]);
  assert.equal(calls[0].args.reason, "Test mailbox rejected");

  const invalid = await route.POST({ ...request, headers: { get: name => name === "svix-id" ? webhookId : null } });
  assert.equal(invalid.status, 401, "unsigned status events cannot mutate the central inbox");
  assert.equal(calls.length, 1);
}

(async () => {
  try {
    await testReceiptAndRace();
    await testSignedWebhookRoute();
    console.log("PASS Resend delivery outcomes: signed lifecycle webhook, per-recipient status, early-event reconciliation, duplicate/out-of-order idempotency, and orphan cleanup.");
  } finally {
    for (const key of env) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  }
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
