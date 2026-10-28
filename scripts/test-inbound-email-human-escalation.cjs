const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const { load } = require("./lib/rentalTestHarness.cjs");
const { isHumanHandoffRequested } = load("src/lib/inboundEmail.ts");

const cases = [
  [true, "Can someone call me?", ""],
  [true, "", "Please contact the owner for me."],
  [true, "", "Could someone from your team call me?"],
  [true, "", "Would your team please contact me directly?"],
  [true, "", "Could you arrange a callback from a real person?"],
  [true, "", "I'd like to speak with a real person about this rental."],
  [true, "", "I need a human, please."],
  [true, "", "Could you have someone from your team get back to me?"],
  [true, "Please connect me with the owner", "Do you have an update?"],
  [false, "", "I'm filming a human interview; can you recommend a mic kit?"],
  [false, "", "The owner of this camera is listed in the product description."],
  [false, "", "I received an email from a person yesterday."],
  [false, "", "You can talk to a human if you need to."],
  [false, "", "Please do not call me; just send the pricing."],
  [false, "", "I received an email from a person yesterday."],
  [false, "", "You can talk to a human if you need to."],
  [false, "", "Please do not call me; just send the pricing."],
  [false, "", "No need for a human, your answer solved it."],
  [false, "", "I do not need a human."],
  [false, "", "I don't want to talk to a person; please send the pricing."],
];

for (const [expected, subject, body] of cases) {
  assert.equal(isHumanHandoffRequested(subject, body), expected, `${subject} ${body}`.trim());
}
const inboundRoute = readFileSync(path.join(__dirname, "../src/app/api/email/inbound/route.ts"), "utf8");
const emailInbox = readFileSync(path.join(__dirname, "../convex/emailInbox.ts"), "utf8");
const emailMailer = readFileSync(path.join(__dirname, "../convex/emailMailer.ts"), "utf8");
assert.match(inboundRoute, /claim\.state === "busy"[\s\S]{0,240}status: 503/);
assert.match(inboundRoute, /!delivered\?\.ok[\s\S]{0,240}status: 503/);
assert.doesNotMatch(inboundRoute, /status: 202/);
assert.match(inboundRoute, /api\.emailInbox\.resolveReplyKey/);
assert.match(inboundRoute, /api\.followUp\.resolveInbound/);
assert.match(inboundRoute, /priorMessage:[\s\S]{0,180}gaffer-follow-up/);
const automaticReply = emailInbox.split("export const sendAssistantReply = action({")[1]?.split("export const sendOwnerReply = action({")[0] ?? "";
assert.match(automaticReply, /gafferReplyAddress\(thread\.replyKey\)/);
assert.match(automaticReply, /args\.humanRequested && thread\.email !== OWNER_EMAIL[\s\S]{0,80}cc: \[OWNER_EMAIL\]/, "only human handoffs CC the owner on Gaffer's customer reply");
assert.match(emailMailer, /sendMail, supportEmailFrom/);
assert.match(emailMailer, /sendMail\(\{[\s\S]{0,120}from: supportEmailFrom\(\)/, "Gaffer email uses the shared booking mail transport and support sender");
assert.doesNotMatch(automaticReply, /replyTo:\s*OWNER_EMAIL/);
assert.match(inboundRoute, /assistant\.humanRequested\s*===\s*true/);
assert.match(inboundRoute, /api\.emailInbox\.markHumanRequested/);
const gafferAt = inboundRoute.indexOf("const assistant = await handleChat");
const urgentAlertAt = inboundRoute.indexOf("api.emailInbox.markHumanRequested", gafferAt);
assert.ok(gafferAt >= 0 && urgentAlertAt > gafferAt, "Gaffer processes the email before an owner alert is scheduled");
const inboundClaim = emailInbox.split("export const claimInbound = mutation({")[1]?.split("async function markEmailHumanRequested")[0] ?? "";
assert.doesNotMatch(inboundClaim, /emailHumanRequestAlert/, "the initial claim does not bypass Gaffer with an owner-only alert");
process.stdout.write("Inbound email human escalation intent checks passed.\n");
