const assert = require("node:assert/strict");
const fs = require("node:fs");
const { load, db, put, tables, setMock } = require("./lib/rentalTestHarness.cjs");

const chat = load("convex/chat.ts");
const rentalChat = load("convex/rentalChat.ts");
const rentalChatHelpers = load("convex/lib/rentalChat.ts");
const { signGafferCompletion } = load("shared/gafferCompletionProof.ts");
const { isGafferHumanHandoffOffer } = load("shared/gafferHumanHandoff.ts");
const { GAFFER_AUTO_RESUME_MS } = load("convex/lib/rentalChat.ts");
const scheduled = [];
const ctx = { db, scheduler: { runAfter: async (...args) => scheduled.push(args) } };
let requestSequence = 0;
const recordQuestion = (token, text, requestId = `account-support-request-${String(++requestSequence).padStart(4, "0")}`) =>
  chat.recordGafferUserMessage.handler(ctx, { token, text, requestId });
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
    assert.equal(isGafferHumanHandoffOffer("Would you like me to connect you with a team member?"), false, "team-offer wording alone cannot expose a human button");
    assert.equal(isGafferHumanHandoffOffer("Would you like me to connect you with a team member?", true), true, "a human offer is allowed only in response to explicit renter intent");
    assert.equal(isGafferHumanHandoffOffer("Would you like me to recommend a lens?"), false);
    assert.equal(isGafferHumanHandoffOffer("Our human team is available on weekdays."), false);
    const messageCountBeforeUnauthorized = (tables.get("messages") ?? []).length;
    const queuedBeforeUnauthorized = scheduled.length;
    await assert.rejects(() => recordQuestion("missing-session", "Can you help me?", "account-support-unauthenticated-0001"), /unauthorized/);
    assert.equal((tables.get("messages") ?? []).length, messageCountBeforeUnauthorized, "unauthenticated requests cannot persist a renter question");
    assert.equal(scheduled.length, queuedBeforeUnauthorized, "unauthenticated requests cannot enqueue Gaffer work");
    setMock("@openrouter/ai-sdk-provider", { createOpenRouter: () => () => ({}) });
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

    const firstRequestId = "account-support-request-first-0001";
    const first = await recordQuestion("renter", "Can you help me choose a lens?", firstRequestId);
    assert.equal(first.handledByHuman, false);
    assert.equal(first.duplicate, false);
    const firstGafferSchedule = scheduled.find((entry) => entry[1] === "gaffer.gafferReply" && entry[2]?.messageId === first.messageId);
    assert(firstGafferSchedule, "saving an account-support question durably schedules Gaffer on the server");
    const messageCountBeforeReplay = tables.get("messages").length;
    const scheduleCountBeforeReplay = scheduled.length;
    const firstReplay = await recordQuestion("renter", "Can you help me choose a lens?", firstRequestId);
    assert.equal(String(firstReplay.messageId), String(first.messageId), "a request replay returns the original account-support message");
    assert.equal(firstReplay.duplicate, true);
    assert.equal(tables.get("messages").length, messageCountBeforeReplay, "replaying a question does not insert it twice");
    assert.equal(scheduled.length, scheduleCountBeforeReplay, "replaying a question does not enqueue a second Gaffer answer");
    const supportThread = tables.get("chat_threads").find((thread) => thread.accountId === account._id && thread.bookingId == null);
    assert.equal(String(supportThread.firstRenterMessageId), String(first.messageId), "new support threads persist their true first renter message");
    const accountGafferContext = {
      escalated: false,
      gafferGeneration: supportThread.gafferGeneration ?? 0,
      latestRenterId: first.messageId,
      messages: [{ sender: "renter", text: "Can you help me choose a lens?" }],
    };
    let loseCommittedReply = true;
    const durableGafferCtx = {
      runQuery: async (reference) => {
        assert.equal(reference, "chat._gafferContext");
        return accountGafferContext;
      },
      runMutation: async (reference, args) => {
        assert.equal(reference, "chat._postBot");
        const committed = await chat._postBot.handler(ctx, args);
        if (loseCommittedReply) {
          loseCommittedReply = false;
          throw new Error("Synthetic worker response lost after its reply committed.");
        }
        return committed;
      },
    };
    await assert.rejects(gafferReply.handler(durableGafferCtx, { accountId: account._id, messageId: first.messageId }), /response lost/);
    const firstReplies = () => tables.get("messages").filter((message) => message.accountId === account._id && message.bookingId == null && message.sender === "bot" && message._id === supportThread.notificationPromptMessageId);
    assert.equal(firstReplies().length, 1, "a persisted question still gets its answer when the worker loses its acknowledgement");
    await gafferReply.handler(durableGafferCtx, { accountId: account._id, messageId: first.messageId });
    assert.equal(firstReplies().length, 1, "replaying after a committed reply does not duplicate it");
    const answer = { saved: true, messageId: firstReplies()[0]._id, offerHuman: firstReplies()[0].meta?.offerHuman === true };
    assert.equal(String(supportThread.gafferReplyTo), String(first.messageId), "the persisted answer is fenced to the question it answers");
    assert.equal(String(supportThread.notificationPromptMessageId), String(answer.messageId), "notification prompt anchors to the first server Gaffer answer");
    const initialConversation = await rentalChat.messages.handler(ctx, { token: "renter", admin: false, paginationOpts: { numItems: 50, cursor: null } });
    assert.equal(String(initialConversation.notificationPromptMessageId), String(answer.messageId), "the renter query returns the persisted notification anchor");
    const adminConversation = await rentalChat.messages.handler(ctx, { token: "fixture-admin", admin: true, accountId: account._id, paginationOpts: { numItems: 50, cursor: null } });
    assert.equal(adminConversation.notificationPromptMessageId, null, "the notification anchor is not exposed as renter-only UI metadata to admins");
    await assert.rejects(() => chat.requestHuman.handler(ctx, { token: "renter", offerMessageId: answer.messageId }), /Gaffer must offer a team handoff/);
    const offerQuestion = await recordQuestion("renter", "I have a complicated booking question.");
    const offer = await saveReply(offerQuestion, "Would you like me to connect you with a team member?");
    assert.equal(offer.offerHuman, false, "a generic team offer is not made available to the chat UI");
    assert.equal((await db.get(offer.messageId)).meta?.offerHuman, undefined, "generic team-offer wording is not persisted as permission");
    assert.equal((await db.get(offer.messageId)).text, "I can keep helping here. What should I check next?", "an unsolicited handoff sentence is removed from the renter-visible reply");
    await assert.rejects(() => chat.requestHuman.handler(ctx, { token: "renter", offerMessageId: offer.messageId }), /Gaffer must offer a team handoff/);
    const directRequest = await recordQuestion("other", "Please connect me with a person.");
    assert.equal(directRequest.handledByHuman, true, "direct human requests bypass Gaffer and escalate immediately");
    assert(tables.get("chat_threads").some((thread) => thread.accountId === otherAccount._id && thread.escalated), "direct requests reach the team's escalation queue");
    const gafferPrompt = fs.readFileSync("convex/gaffer.ts", "utf8");
    assert.match(gafferPrompt, /After a resolved answer with ten minutes of renter silence, the system sends an INTERNAL team notification only; it does not send the renter a follow-up or reveal a handoff control/);
    assert.doesNotMatch(gafferPrompt, /system asks whether the renter wants the team after 10 minutes|server offers it after an answered issue has been quiet for ten minutes/, "Gaffer's model instructions must not confuse the internal alert with a customer-facing follow-up");
    const widget = fs.readFileSync("src/components/BotBubble.tsx", "utf8");
    assert(widget.includes("m.meta?.offerHuman") && widget.includes("<HumanHandoffOffer"), "the storefront widget only shows handoff after Gaffer offers it");
    assert(widget.includes("offerMessageId: m.id"), "the storefront handoff action proves it follows Gaffer's live offer");
    assert(widget.indexOf('aria-label="Chat notifications"') < widget.indexOf("<HumanHandoffOffer"), "the notification prompt follows Gaffer's first answer before later controls");
    assert(widget.includes("requestId: accountRequestId!") && widget.includes("createClientRequestId"), "the account widget retries the same saved question idempotently");
    assert(!widget.includes("recordAccountReply"), "authenticated account questions no longer depend on browser reply completion");

    const originalProviderKey = process.env.OPENROUTER_API_KEY;
    process.env.OPENROUTER_API_KEY = "synthetic-provider-key";
    setMock("@openrouter/ai-sdk-provider", { createOpenRouter: () => () => ({}) });
    setMock("ai", { generateObject: async () => { throw new Error("Synthetic provider outage."); } });
    const providerAccount = put("accounts", { email: "provider-failure@test.invalid" });
    put("sessions", { token: "provider-failure", accountId: providerAccount._id, expiresAt: now + 60_000 });
    const providerQuestion = await recordQuestion("provider-failure", "Can you help with my account?", "account-support-provider-failure-0001");
    const providerThread = tables.get("chat_threads").find((thread) => thread.accountId === providerAccount._id && thread.bookingId == null);
    const providerContext = {
      escalated: false,
      gafferGeneration: providerThread.gafferGeneration ?? 0,
      latestRenterId: providerQuestion.messageId,
      messages: [{ sender: "renter", text: "Can you help with my account?" }],
      booking: null,
      catalogueWindow: null,
      hours: "10:00–18:00",
      location: null,
      accountRentals: [],
      accountCredit: { available: 0, currency: "GBP" },
      checkoutUi: { accountCredit: "Available account credit is shown at checkout." },
    };
    const providerFailureContext = {
      runQuery: async () => providerContext,
      runMutation: async (reference, args) => {
        assert.equal(reference, "chat._postBot");
        return chat._postBot.handler(ctx, args);
      },
    };
    await gafferReply.handler(providerFailureContext, { accountId: providerAccount._id, messageId: providerQuestion.messageId });
    const providerFallback = tables.get("messages").find((message) => message.accountId === providerAccount._id && message.sender === "bot");
    assert.match(providerFallback.text, /ask me again.*keep helping here/i, "a provider failure is converted to a saved fallback instead of losing the account question");
    if (originalProviderKey === undefined) delete process.env.OPENROUTER_API_KEY;
    else process.env.OPENROUTER_API_KEY = originalProviderKey;

    const takeoverAccount = put("accounts", { email: "human-takeover@test.invalid" });
    put("sessions", { token: "human-takeover", accountId: takeoverAccount._id, expiresAt: now + 60_000 });
    const takeoverQuestion = await recordQuestion("human-takeover", "Can someone help me with a change?", "account-support-human-takeover-0001");
    const takeoverThread = tables.get("chat_threads").find((thread) => thread.accountId === takeoverAccount._id && thread.bookingId == null);
    await db.patch(takeoverThread._id, { escalated: true, escalatedAt: now, gafferGeneration: (takeoverThread.gafferGeneration ?? 0) + 1 });
    const takeoverContext = {
      runQuery: async () => ({ escalated: true, gafferGeneration: takeoverThread.gafferGeneration, latestRenterId: takeoverQuestion.messageId, messages: [{ sender: "renter", text: "Can someone help me with a change?" }] }),
      runMutation: async () => { throw new Error("Gaffer must not post after human takeover."); },
    };
    await gafferReply.handler(takeoverContext, { accountId: takeoverAccount._id, messageId: takeoverQuestion.messageId });
    assert.equal(tables.get("messages").filter((message) => message.accountId === takeoverAccount._id && message.sender === "bot").length, 0, "a previously queued answer stays quiet after human takeover");

    const stale = await recordQuestion("renter", "One more question.");
    const latest = await recordQuestion("renter", "Actually, one last question.");
    assert.equal((await chat.recordGafferReply.handler(ctx, {
      token: "renter",
      renterMessageId: stale.messageId,
      text: "This stale response must not be saved.",
    })).saved, false);
    await db.patch(latest.messageId, { text: "I would like to speak to a person about this." });
    const latestAnswer = await saveReply(latest, "Would you like me to connect you with a team member?");
    assert.equal(latestAnswer.saved, true);
    assert.equal(latestAnswer.offerHuman, true);
    const savedLatestAnswer = await db.get(latestAnswer.messageId);
    assert.equal(savedLatestAnswer?.meta?.offerHuman, true);
    assert.equal(String(supportThread.notificationPromptMessageId), String(answer.messageId), "reopened and longer chats do not move the notification prompt to a recent exchange");
    const latestSupportMessage = (await db.query("messages").withIndex("by_booking_account_at", q => q.eq("bookingId", undefined).eq("accountId", account._id)).order("desc").take(1))[0];
    assert.equal(latestSupportMessage?._id, latestAnswer.messageId);

    await assert.rejects(() => chat.requestHuman.handler(ctx, { token: "renter", offerMessageId: offer.messageId }), /Gaffer must offer a team handoff/);
    await chat.requestHuman.handler(ctx, { token: "renter", offerMessageId: latestAnswer.messageId });
    const handoffQuestion = await recordQuestion("renter", "I still need to speak with a person.");
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
    assert.equal(supportMessages.at(-1).text, "I still need to speak with a person.");

    for (let index = 0; index < 55; index++) put("messages", { accountId: account._id, sender: "bot", text: `Older prompt paging fixture ${index}`, at: now + index + 1 });
    const longConversation = await rentalChat.messages.handler(ctx, { token: "renter", admin: false, paginationOpts: { numItems: 50, cursor: null } });
    assert.equal(String(longConversation.notificationPromptMessageId), String(answer.messageId), "a long/reopened support history retains the true prompt anchor");
    assert.equal(longConversation.page.some((message) => String(message._id) === String(answer.messageId)), false, "the regression proves the anchor survives after its message leaves the latest page");

    const legacyAccount = put("accounts", { email: "legacy-channel@test.invalid" });
    put("sessions", { token: "legacy", accountId: legacyAccount._id, expiresAt: now + 60_000 });
    const legacyMessageId = put("messages", { accountId: legacyAccount._id, sender: "renter", text: "A legacy message", at: now - 10 });
    put("chat_threads", { accountId: legacyAccount._id, escalated: false, updatedAt: now - 10 });
    const legacyReply = await recordQuestion("legacy", "A later message in the old thread");
    const legacyThread = tables.get("chat_threads").find((thread) => thread.accountId === legacyAccount._id && thread.bookingId == null);
    assert.equal(legacyThread.firstRenterMessageId, undefined, "legacy support threads are not assigned a false first-message anchor");
    assert.notEqual(String(legacyMessageId), String(legacyReply.messageId));

    const systemFirstAccount = put("accounts", { email: "system-first-channel@test.invalid" });
    put("sessions", { token: "system-first", accountId: systemFirstAccount._id, expiresAt: now + 60_000 });
    await rentalChatHelpers.postRentalMessage(ctx, { accountId: systemFirstAccount._id, sender: "system", text: "Welcome to support." });
    const firstRenterAfterSystem = await recordQuestion("system-first", "Can I get a quote?");
    const systemFirstThread = tables.get("chat_threads").find((thread) => thread.accountId === systemFirstAccount._id && thread.bookingId == null);
    assert.equal(String(systemFirstThread.firstRenterMessageId), String(firstRenterAfterSystem.messageId), "prior system notices do not suppress the first-renter anchor");
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
