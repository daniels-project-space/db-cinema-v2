const assert = require("node:assert/strict");
const { db, docs, load, put, setMock } = require("./lib/rentalTestHarness.cjs");

const chatMessages = [];
setMock("./adminAuth", {
  assertAdmin: async () => {},
  checkAdminToken: () => true,
});
setMock("./lib/rentalChat", {
  postRentalMessage: async (_ctx, message) => chatMessages.push(message),
});
setMock("./lib/mailer", {
  deliveryMessageId: (key) => `<${key}@fixture.invalid>`,
  sendBusinessMail: async () => true,
});
process.env.INBOUND_EMAIL_SECRET = "fixture-inbound-secret";

const { gafferReplyAddress, ingest, resolveReplyKey } = load("convex/emailInbox.ts");

assert.equal(
  gafferReplyAddress("abcdef0123456789abcdef01", " DBcinemarentals.com "),
  "gaffer+abcdef0123456789abcdef01@dbcinemarentals.com",
);
assert.equal(gafferReplyAddress("abcdef0123456789abcdef01", ""), null, "never fall back to the owner inbox when Gaffer routing is unconfigured");
assert.equal(gafferReplyAddress("bad-key", "dbcinemarentals.com"), null);

function input(from, providerId, extra = {}) {
  return {
    secret: "fixture-inbound-secret",
    providerId,
    references: [],
    from,
    to: "rentals@dbcinemarentals.com",
    subject: `Rental enquiry ${providerId}`,
    text: "Can you help with a rental?",
    ...extra,
  };
}

(async () => {
  const verifiedAccount = put("accounts", {
    email: "verified@example.com",
    emailVerifiedAt: 1,
    name: "Verified renter",
  });
  const verified = await ingest.handler({ db }, input("verified@example.com", "verified-message", { messageId: "<verified-message@example.com>" }));
  assert.equal(verified.accountId, verifiedAccount._id);
  assert.equal(docs.get(verified.threadId).verifiedRenterEmail, "verified@example.com");
  assert.equal(chatMessages.length, 1);
  assert.equal(chatMessages[0].accountId, verifiedAccount._id);
  assert.equal(chatMessages[0].meta.channel, "email");

  const spoofedReply = await ingest.handler({ db }, input("outsider@example.com", "spoofed-reference", { inReplyTo: "<verified-message@example.com>" }));
  assert.notEqual(spoofedReply.threadId, verified.threadId, "a sender must not join another renter's email conversation using a copied Message-ID");
  assert.equal(docs.get(spoofedReply.threadId).email, "outsider@example.com");
  assert.equal(chatMessages.length, 1, "a sender with a copied Message-ID must not appear in the verified renter's profile chat");

  const legitimateReply = await ingest.handler({ db }, input("verified@example.com", "verified-reply", { inReplyTo: "<verified-message@example.com>" }));
  assert.equal(legitimateReply.threadId, verified.threadId, "a matching verified sender must retain the same email thread and renter profile");
  assert.equal(chatMessages.length, 2);
  assert.equal(chatMessages[1].accountId, verifiedAccount._id);
  const linkedChatCount = chatMessages.length;

  put("accounts", {
    email: "unverified@example.com",
    name: "Unverified account",
  });
  const unverified = await ingest.handler({ db }, input("unverified@example.com", "unverified-message"));
  assert.equal(unverified.accountId, null, "an unverified email must stay out of the existing renter profile/chat");
  assert.equal(docs.get(unverified.threadId).accountId, undefined);
  assert.equal(docs.get(unverified.threadId).verifiedRenterEmail, undefined);
  assert.equal(chatMessages.length, linkedChatCount, "unverified senders must not be attached to a renter chat");

  put("accounts", {
    email: "reverification@example.com",
    emailVerifiedAt: 1,
    emailVerificationRequired: true,
    name: "Stale verified account",
  });
  const reverification = await ingest.handler({ db }, input("reverification@example.com", "reverification-message"));
  assert.equal(reverification.accountId, null, "an account waiting for reverification must not be linked");
  assert.equal(docs.get(reverification.threadId).verifiedRenterEmail, undefined);
  assert.equal(chatMessages.length, linkedChatCount, "reverification-pending senders must not be attached to a renter chat");

  const duplicateEmail = "duplicate-profile@example.com";
  put("accounts", {
    email: duplicateEmail,
    name: "Older unverified duplicate",
  });
  const verifiedDuplicate = put("accounts", {
    email: duplicateEmail,
    emailVerifiedAt: 2,
    name: "Verified duplicate",
  });
  const duplicateProfile = await ingest.handler({ db }, input(duplicateEmail, "duplicate-profile-message"));
  assert.equal(duplicateProfile.accountId, verifiedDuplicate._id, "a duplicate unverified row must not hide the verified profile");
  assert.equal(chatMessages.at(-1).accountId, verifiedDuplicate._id);

  const followUpEmail = "follow-up-renter@example.com";
  const followUpAccount = put("accounts", {
    email: followUpEmail,
    emailVerifiedAt: 3,
    name: "Follow-up renter",
  });
  const followUpReply = await ingest.handler({ db }, input(followUpEmail, "follow-up-reply", {
    subject: "Re: Following up on your call",
    priorMessage: {
      providerId: "gaffer-follow-up:reply-key-1234567890abcdef12345678",
      subject: "Following up on your call",
      text: "I can prepare that equipment quote for you.",
      at: 10,
    },
  }));
  assert.equal(followUpReply.accountId, followUpAccount._id);
  assert.match(docs.get(followUpReply.threadId).replyKey, /^[a-f0-9]{24}$/i, "every email thread gets a private Gaffer reply token");
  const followUpMessages = [...docs.values()]
    .filter((message) => message.threadId === followUpReply.threadId)
    .sort((a, b) => a.at - b.at);
  assert.deepEqual(followUpMessages.map((message) => message.direction), ["out", "in"]);
  assert.equal(followUpMessages[0].text, "I can prepare that equipment quote for you.");
  assert.deepEqual(followUpReply.history.map((message) => message.role), ["assistant", "user"]);
  assert.equal(chatMessages.at(-1).accountId, followUpAccount._id, "follow-up email replies join the verified renter chat");
  const addressedReply = await resolveReplyKey.handler({ db }, {
    secret: "fixture-inbound-secret",
    replyKey: docs.get(followUpReply.threadId).replyKey,
    email: followUpEmail,
  });
  assert.equal(addressedReply.ok, true);
  assert.equal(addressedReply.threadId, followUpReply.threadId);
  const spoofedAddressedReply = await resolveReplyKey.handler({ db }, {
    secret: "fixture-inbound-secret",
    replyKey: docs.get(followUpReply.threadId).replyKey,
    email: "spoof@example.com",
  });
  assert.equal(spoofedAddressedReply.ok, false, "reply tokens remain bound to the exact sender address");

  process.stdout.write("Gaffer reply addresses, profile linking, and follow-up email context passed.\n");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
