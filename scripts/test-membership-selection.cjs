const assert = require("node:assert/strict");
const { load } = require("./lib/rentalTestHarness.cjs");
const { restoreMembershipSelection, accountPricingContext, membershipOfferContext, membershipRecommendationPreview } = load("shared/membershipSelection.ts");
const contextArgs = { items: [{ listingId: 'lens', start: 1, end: 7 }], customerEmail: 'guest', fulfilment: 'pickup', account: accountPricingContext(null) };
const context = membershipOfferContext(contextArgs);
const recommendations = [{ tier: 'pro', netSaving: 19.8 }];
const previous = { offerContext: context, recommendations };
for (const selectedMembership of [undefined, {tier:'pro',intro:'none'}, {tier:'studio',intro:'none'}]) {
  const toggledContext = membershipOfferContext({...contextArgs, selectedMembership});
  assert.equal(toggledContext, context);
  assert.equal(membershipRecommendationPreview(previous, toggledContext, false), recommendations, 'A real offer stays visible while membership is toggled');
}
for (const change of [{items:[{listingId:'lens',start:2,end:8}]}, {customerEmail:'another'}, {fulfilment:'delivery'}, {promoCode:'NEW'}, {account:accountPricingContext({earnedCredit:10})}]) {
  assert.equal(membershipRecommendationPreview(previous, membershipOfferContext({...contextArgs,...change}), false), undefined, 'Never display an old offer for changed pricing inputs');
}
assert.equal(membershipRecommendationPreview(previous, context, true), undefined, 'Failed quotes cannot continue advertising a prior offer');
assert.equal(membershipRecommendationPreview(null, context, false), undefined);
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
