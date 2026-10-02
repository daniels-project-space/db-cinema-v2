const assert = require("node:assert/strict");
const { load } = require("./lib/rentalTestHarness.cjs");
const { restoreMembershipSelection, accountPricingContext } = load("shared/membershipSelection.ts");
const member={membershipActive:true,membershipTier:'studio',earnedCredit:0,refundCredit:0,loyaltyPercent:0};
assert.notEqual(accountPricingContext(member),accountPricingContext({...member,earnedCredit:128.7}),'A renewal credit must invalidate the open basket quote');
assert.notEqual(accountPricingContext(member),accountPricingContext({...member,refundCredit:100}),'Returned credit must reprice checkout');
assert.notEqual(accountPricingContext(member),accountPricingContext({...member,membershipActive:false}),'Membership expiry must reprice the basket');
assert.equal(accountPricingContext(member),accountPricingContext({...member,avatarUrl:'new-photo',name:'Changed profile'}),'Cosmetic profile updates must not reset financial consent');
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
