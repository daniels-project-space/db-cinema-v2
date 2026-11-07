const assert = require("node:assert/strict");
const fs = require("node:fs");
const { load, db, put, tables } = require("./lib/rentalTestHarness.cjs");

const chat = load("convex/chat.ts");
const { GAFFER_AUTO_RESUME_MS } = load("convex/lib/rentalChat.ts");
const scheduled = [];
const ctx = { db, scheduler: { runAfter: async (...args) => scheduled.push(args) } };
const originalNow = Date.now;
let now = originalNow();
Date.now = () => now;
process.env.ADMIN_TOKEN = "fixture-admin";

const account = put("accounts", { email: "account-channel@test.invalid" });
const otherAccount = put("accounts", { email: "other-channel@test.invalid" });
put("sessions", { token: "renter", accountId: account._id, expiresAt: now + 60_000 });
put("sessions", { token: "other", accountId: otherAccount._id, expiresAt: now + 60_000 });

(async () => {
  try {
    const first = await chat.recordGafferUserMessage.handler(ctx, { token: "renter", text: "Can you help me choose a lens?" });
    assert.equal(first.handledByHuman, false);
    const answer = await chat.recordGafferReply.handler(ctx, {
      token: "renter",
      renterMessageId: first.messageId,
      text: "Tell me what you are filming and I can recommend one.",
    });
    assert.equal(answer.saved, true);
    const offerQuestion = await chat.recordGafferUserMessage.handler(ctx, { token: "renter", text: "I have a complicated booking question." });
    const offer = await chat.recordGafferReply.handler(ctx, {
      token: "renter",
      renterMessageId: offerQuestion.messageId,
      text: "Would you like me to connect you with a team member?",
    });
    assert.equal(offer.offerHuman, true, "Gaffer's explicit offer is made available to the chat UI");
    assert.equal((await db.get(offer.messageId)).meta.offerHuman, true, "the human offer survives chat reload");
    const directRequest = await chat.recordGafferUserMessage.handler(ctx, { token: "other", text: "Please connect me with a person." });
    assert.equal(directRequest.handledByHuman, true, "direct human requests bypass Gaffer and escalate immediately");
    assert(tables.get("chat_threads").some((thread) => thread.accountId === otherAccount._id && thread.escalated), "direct requests reach the team's escalation queue");
    const widget = fs.readFileSync("src/components/BotBubble.tsx", "utf8");
    assert(widget.includes("m.meta?.offerHuman") && widget.includes("<HumanHandoffOffer"), "the storefront widget only shows handoff after Gaffer offers it");
    assert(widget.includes("requestAccountHuman({ token: account.token! })"), "the storefront handoff action is wired to the authenticated support thread");
    assert(widget.indexOf('aria-label="Chat notifications"') < widget.indexOf("<HumanHandoffOffer"), "the notification prompt follows Gaffer's first answer before later controls");

    const stale = await chat.recordGafferUserMessage.handler(ctx, { token: "renter", text: "One more question." });
    const latest = await chat.recordGafferUserMessage.handler(ctx, { token: "renter", text: "Actually, one last question." });
    assert.equal((await chat.recordGafferReply.handler(ctx, {
      token: "renter",
      renterMessageId: stale.messageId,
      text: "This stale response must not be saved.",
    })).saved, false);
    assert.equal((await chat.recordGafferReply.handler(ctx, {
      token: "renter",
      renterMessageId: latest.messageId,
      text: "This answer belongs to the latest question.",
    })).saved, true);

    await chat.requestHuman.handler(ctx, { token: "renter" });
    const handoffQuestion = await chat.recordGafferUserMessage.handler(ctx, { token: "renter", text: "I still need the team." });
    assert.equal(handoffQuestion.handledByHuman, true);
    const suppressedReply = await chat.recordGafferReply.handler(ctx, {
      token: "renter",
      renterMessageId: handoffQuestion.messageId,
      text: "Gaffer must not answer during human handoff.",
    });
    assert.deepEqual(suppressedReply, { saved: false, handledByHuman: true });

    const supportThreads = tables.get("chat_threads").filter((thread) => thread.accountId === account._id && thread.bookingId == null);
    assert.equal(supportThreads.length, 1, "all account enquiries use one general support thread");
    const supportMessages = tables.get("messages").filter((message) => message.accountId === account._id && message.bookingId == null);
    assert.equal(supportMessages.length, 9);
    assert.equal(supportMessages.at(-1).text, "I still need the team.");
    assert(scheduled.some((entry) => entry[0] === GAFFER_AUTO_RESUME_MS && entry[2]?.expectedUpdatedAt), "human handoff retains its four-hour return timer");
    await assert.rejects(() => chat.recordGafferReply.handler(ctx, {
      token: "other",
      renterMessageId: first.messageId,
      text: "Cross-account reply",
    }), /not part of your account-support thread/);

    console.log("PASS authenticated Gaffer widget exchanges share one account-support thread, stale replies are rejected, and human handoff suppresses Gaffer.");
  } finally {
    Date.now = originalNow;
    delete process.env.ADMIN_TOKEN;
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
