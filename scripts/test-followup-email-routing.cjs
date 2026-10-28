const assert = require("node:assert/strict");
const { db, docs, load, put, setMock } = require("./lib/rentalTestHarness.cjs");

setMock("./lib/rentalChat", { accountForToken: async () => null });
setMock("./rateLimit", { bump: async () => ({ allowed: true }) });
process.env.INBOUND_EMAIL_SECRET = "fixture-inbound-secret";

const { resolveInbound } = load("convex/followUp.ts");

(async () => {
  const outbound = put("gaffer_follow_ups", {
    at: 10,
    email: "replying-renter@example.com",
    name: "Replying renter",
    subject: "Following up on your camera call",
    body: "I can send over the rental options we discussed.",
    replyKey: "abcdef0123456789abcdef01",
    direction: "out",
    handled: true,
  });
  const before = docs.size;

  const routed = await resolveInbound.handler({ db }, {
    secret: "fixture-inbound-secret",
    replyKey: outbound.replyKey,
    email: "replying-renter@example.com",
  });
  assert.equal(routed.ok, true);
  assert.equal(routed.original.subject, outbound.subject);
  assert.equal(routed.original.body, outbound.body);
  assert.equal(docs.size, before, "reply resolution must not create an owner-only follow-up or send a Telegram-only handoff");

  const spoofed = await resolveInbound.handler({ db }, {
    secret: "fixture-inbound-secret",
    replyKey: outbound.replyKey,
    email: "other-person@example.com",
  });
  assert.equal(spoofed.ok, false, "a reply key is accepted only for its original sender");
  assert.equal(docs.size, before);
  process.stdout.write("Legacy Gaffer follow-up replies resolve safely for the shared Gaffer email pipeline.\n");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
