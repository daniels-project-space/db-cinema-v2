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

const { ingest } = load("convex/emailInbox.ts");

function input(from, providerId) {
  return {
    secret: "fixture-inbound-secret",
    providerId,
    references: [],
    from,
    to: "rentals@dbcinemarentals.com",
    subject: `Rental enquiry ${providerId}`,
    text: "Can you help with a rental?",
  };
}

(async () => {
  const verifiedAccount = put("accounts", {
    email: "verified@example.com",
    emailVerifiedAt: 1,
    name: "Verified renter",
  });
  const verified = await ingest.handler({ db }, input("verified@example.com", "verified-message"));
  assert.equal(verified.accountId, verifiedAccount._id);
  assert.equal(docs.get(verified.threadId).verifiedRenterEmail, "verified@example.com");
  assert.equal(chatMessages.length, 1);
  assert.equal(chatMessages[0].accountId, verifiedAccount._id);
  assert.equal(chatMessages[0].meta.channel, "email");

  put("accounts", {
    email: "unverified@example.com",
    name: "Unverified account",
  });
  const unverified = await ingest.handler({ db }, input("unverified@example.com", "unverified-message"));
  assert.equal(unverified.accountId, null, "an unverified email must stay out of the existing renter profile/chat");
  assert.equal(docs.get(unverified.threadId).accountId, undefined);
  assert.equal(docs.get(unverified.threadId).verifiedRenterEmail, undefined);
  assert.equal(chatMessages.length, 1, "unverified senders must not be attached to a renter chat");

  put("accounts", {
    email: "reverification@example.com",
    emailVerifiedAt: 1,
    emailVerificationRequired: true,
    name: "Stale verified account",
  });
  const reverification = await ingest.handler({ db }, input("reverification@example.com", "reverification-message"));
  assert.equal(reverification.accountId, null, "an account waiting for reverification must not be linked");
  assert.equal(docs.get(reverification.threadId).verifiedRenterEmail, undefined);
  assert.equal(chatMessages.length, 1, "reverification-pending senders must not be attached to a renter chat");

  process.stdout.write("Email profile linking uses only verified account email and posts into that renter chat.\n");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
