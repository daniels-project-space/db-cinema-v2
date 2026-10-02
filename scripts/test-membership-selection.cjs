const assert = require("node:assert/strict");
const { load } = require("./lib/rentalTestHarness.cjs");
const { restoreMembershipSelection } = load("shared/membershipSelection.ts");
for (const bad of [
  null,
  false,
  "pro",
  [],
  {},
  { tier: "invalid", intro: "trial" },
  { tier: "pro", intro: "credit" },
  { tier: "plus", intro: "expired" },
])
  assert.equal(restoreMembershipSelection(bad), null);
for (const tier of ["plus", "pro", "studio"])
  for (const intro of ["trial", "none"])
    assert.deepEqual(
      restoreMembershipSelection({
        tier,
        intro,
        termsAccepted: true,
        membershipActive: true,
      }),
      { tier, intro: "none", termsAccepted: false },
      "stored preferences cannot carry financial consent or confer membership",
    );
console.log(
  "Basket membership preference: valid plans restored, retired/invalid offers rejected, consent always requires fresh acceptance.",
);
