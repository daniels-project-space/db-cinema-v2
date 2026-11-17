const assert = require("node:assert/strict");
const fs = require("node:fs");
const { load, db, put, tables, setMock } = require("./lib/rentalTestHarness.cjs");

const chat = load("convex/chat.ts");
const { signGafferCompletion } = load("shared/gafferCompletionProof.ts");
const { isGafferHumanHandoffOffer } = load("shared/gafferHumanHandoff.ts");
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
const proofSecret = "synthetic-only-account-channel-proof-secret";
process.env.GAFFER_COMPLETION_PROOF_SECRET = proofSecret;
const saveReply = async (question, text, resolved = false) => {
  const completionProof = await signGafferCompletion(proofSecret, { messageId: question.messageId, answer: text.trim(), resolved, expiresAt: Date.now() + 120_000 });
  return chat.recordGafferReply.handler(ctx, { token: "renter", renterMessageId: question.messageId, text, completionProof });
};

(async () => {
  try {
    assert.equal(isGafferHumanHandoffOffer("Would you like me to connect you with a team member?"), true);
    assert.equal(isGafferHumanHandoffOffer("Would you like me to recommend a lens?"), false);
    assert.equal(isGafferHumanHandoffOffer("Our human team is available on weekdays."), false);
    setMock("@openrouter/ai-sdk-provider", { createOpenRouter: () => { throw new Error("No provider call expected in fallback test."); } });
    setMock("ai", { generateObject: async () => { throw new Error("No provider call expected in fallback test."); } });
    const { gafferReply } = load("convex/gaffer.ts");
    const originalOpenRouterKey = process.env.OPENROUTER_API_KEY;
    delete process.env.OPENROUTER_API_KEY;
    const fallbackPosted = [];
    const gafferContext = {
      escalated: false,
      gafferGeneration: 1,
      latestRenterId: "renter-message-1",
      messages: [{ sender: "renter", text: "Can you help me choose a microphone?" }],
    };
    const gafferCtx = {
      runQuery: async (reference) => {
        assert.equal(reference, "chat._gafferContext");
        return gafferContext;
      },
      runMutation: async (reference, args) => {
        assert.equal(reference, "chat._postBot");
        fallbackPosted.push(args);
        return true;
      },
    };
    await gafferReply.handler(gafferCtx, { accountId: account._id, messageId: "renter-message-1" });
    assert.match(fallbackPosted.at(-1).text, /ask me again.*keep helping here/i);
    assert.equal(fallbackPosted.at(-1).offerHuman, undefined, "a temporary model failure must not immediately offer a human");
    assert.equal(fallbackPosted.at(-1).handoff, undefined, "a routine model failure must not escalate the chat");
    gafferContext.messages[0].text = "Please connect me to a person.";
    await gafferReply.handler(gafferCtx, { accountId: account._id, messageId: "renter-message-1" });
    assert.equal(fallbackPosted.at(-1).handoff, true, "explicit human requests still escalate immediately");
    if (originalOpenRouterKey === undefined) delete process.env.OPENROUTER_API_KEY;
    else process.env.OPENROUTER_API_KEY = originalOpenRouterKey;

    const first = await chat.recordGafferUserMessage.handler(ctx, { token: "renter", text: "Can you help me choose a lens?" });
    assert.equal(first.handledByHuman, false);
    const answer = await saveReply(first, "Tell me what you are filming and I can recommend one.");
    assert.equal(answer.saved, true);
    await assert.rejects(() => chat.requestHuman.handler(ctx, { token: "renter", offerMessageId: answer.messageId }), /Gaffer must offer a team handoff/);
    const offerQuestion = await chat.recordGafferUserMessage.handler(ctx, { token: "renter", text: "I have a complicated booking question." });
    const offer = await saveReply(offerQuestion, "Would you like me to connect you with a team member?");
    assert.equal(offer.offerHuman, true, "Gaffer's explicit offer is made available to the chat UI");
    assert.equal((await db.get(offer.messageId)).meta.offerHuman, true, "the human offer survives chat reload");
    const directRequest = await chat.recordGafferUserMessage.handler(ctx, { token: "other", text: "Please connect me with a person." });
    assert.equal(directRequest.handledByHuman, true, "direct human requests bypass Gaffer and escalate immediately");
    assert(tables.get("chat_threads").some((thread) => thread.accountId === otherAccount._id && thread.escalated), "direct requests reach the team's escalation queue");
    const widget = fs.readFileSync("src/components/BotBubble.tsx", "utf8");
    assert(widget.includes("m.meta?.offerHuman") && widget.includes("<HumanHandoffOffer"), "the storefront widget only shows handoff after Gaffer offers it");
    assert(widget.includes("offerMessageId: m.id"), "the storefront handoff action proves it follows Gaffer's live offer");
    assert(widget.indexOf('aria-label="Chat notifications"') < widget.indexOf("<HumanHandoffOffer"), "the notification prompt follows Gaffer's first answer before later controls");

    const stale = await chat.recordGafferUserMessage.handler(ctx, { token: "renter", text: "One more question." });
    const latest = await chat.recordGafferUserMessage.handler(ctx, { token: "renter", text: "Actually, one last question." });
    assert.equal((await chat.recordGafferReply.handler(ctx, {
      token: "renter",
      renterMessageId: stale.messageId,
      text: "This stale response must not be saved.",
    })).saved, false);
    const latestAnswer = await saveReply(latest, "Would you like me to connect you with a team member?");
    assert.equal(latestAnswer.saved, true);
    assert.equal(latestAnswer.offerHuman, true);
    const savedLatestAnswer = await db.get(latestAnswer.messageId);
    assert.equal(savedLatestAnswer?.meta?.offerHuman, true);
    const latestSupportMessage = (await db.query("messages").withIndex("by_booking_account_at", q => q.eq("bookingId", undefined).eq("accountId", account._id)).order("desc").take(1))[0];
    assert.equal(latestSupportMessage?._id, latestAnswer.messageId);

    await assert.rejects(() => chat.requestHuman.handler(ctx, { token: "renter", offerMessageId: offer.messageId }), /Gaffer must offer a team handoff/);
    await chat.requestHuman.handler(ctx, { token: "renter", offerMessageId: latestAnswer.messageId });
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
    delete process.env.GAFFER_COMPLETION_PROOF_SECRET;
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
