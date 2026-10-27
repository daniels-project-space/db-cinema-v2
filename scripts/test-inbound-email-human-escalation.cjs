const assert = require("node:assert/strict");
const { load } = require("./lib/rentalTestHarness.cjs");
const { isHumanHandoffRequested } = load("src/lib/inboundEmail.ts");

const cases = [
  [true, "Can someone call me?", ""],
  [true, "", "Please contact the owner for me."],
  [true, "", "Could someone from your team call me?"],
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
process.stdout.write("Inbound email human escalation intent checks passed.\n");
