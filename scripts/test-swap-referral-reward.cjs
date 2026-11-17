const assert = require("node:assert/strict");
const { load, db, put } = require("./lib/rentalTestHarness.cjs");
const { quoteSwapFunding, quoteSwapBasketFunding } = load("convex/lib/rentalSwapFunding.ts");
const { checkoutLineAllocation } = load("shared/checkoutLineAllocation.ts");

const account = put("accounts", { email: "swap-referral@example.invalid" });
const sourceLine = (listingId, amount) => ({ listingId, title: listingId, start: 100, end: 200, qty: 1, lineTotal: amount });
const makeBooking = (lines, percent = 40) => {
  const subtotal = lines.reduce((sum, line) => sum + line.lineTotal, 0);
  const discount = Math.round(subtotal * percent) / 100;
  const allocation = checkoutLineAllocation(lines.map(line => line.lineTotal), [0], discount, 0, 0);
  const reward = put("referral_rewards", { accountId: account._id, redemptionId: "referral-redemption", percent, state: "used", usedAt: 500, expiresAt: 1000 });
  const booking = put("bookings", {
    accountId: account._id, referralRewardId: reward._id, pricingVersion: "single-benefit-v1", benefitKind: "referral_reward",
    subtotal, discount, deliveryFee: 0, creditApplied: 0, membershipCreditApplied: 0, refundCreditApplied: 0, earnedCreditApplied: 0,
    lineItems: lines,
    checkoutLineFunding: lines.map((line, index) => ({ ...line, gross: line.lineTotal, ...allocation[index] })),
    creditAllocations: [], checkoutLineCreditSources: [],
  });
  reward.usedBookingId = booking._id;
  return { booking, reward, lines };
};

(async () => {
  const single = makeBooking([sourceLine("old-single", 100)]);
  const singleQuote = await quoteSwapFunding({ db }, single.booking, 0, sourceLine("new-single", 120));
  assert.equal(singleQuote.nextFunding.discount, 48, "the reward's recorded 40% applies to the replacement line");
  assert.equal(singleQuote.deltaPence, 1200, "the card charge is the exact net change after the reward");

  const basket = makeBooking([sourceLine("old-a", 100), sourceLine("old-b", 50)]);
  const basketQuote = await quoteSwapBasketFunding({ db }, basket.booking, [
    { lineIndex: 0, oldLine: basket.lines[0], newLine: sourceLine("new-a", 200) },
  ]);
  assert.equal(basketQuote.nextSubtotal, 250);
  assert.equal(basketQuote.nextDiscount, 100, "the reward is repriced once across the changed basket");
  assert.equal(basketQuote.deltaPence, 6000, "the basket produces one net charge after its saved reward");

  const stalePercent = makeBooking([sourceLine("old-stale", 100)]);
  stalePercent.reward.percent = 50;
  await assert.rejects(quoteSwapFunding({ db }, stalePercent.booking, 0, sourceLine("new-stale", 120)), /cannot be safely repriced/);
  const unlinked = makeBooking([sourceLine("old-unlinked", 100)]);
  unlinked.reward.usedBookingId = "another-booking";
  await assert.rejects(quoteSwapFunding({ db }, unlinked.booking, 0, sourceLine("new-unlinked", 120)), /cannot be safely repriced/);

  const unsupported = ["weekend", "quiet", "promo", "catalog_offer", "referral_friend"];
  for (const benefitKind of unsupported) {
    const line = sourceLine(`old-${benefitKind}`, 100);
    const booking = {
      pricingVersion: "single-benefit-v1", benefitKind, subtotal: 100, discount: 10, lineItems: [line],
      checkoutLineFunding: [{ ...line, gross: 100, discount: 10, membershipCredit: 0, accountCredit: 0, card: 90 }],
      creditAllocations: [], checkoutLineCreditSources: [],
    };
    await assert.rejects(quoteSwapFunding({ db }, booking, 0, sourceLine(`new-${benefitKind}`, 120)), /cannot be safely repriced/);
  }

  console.log("PASS swap referral reward: linked percent snapshot, single/basket deltas, tamper rejection and unsupported-benefit fail-closed cases");
})().catch(error => { console.error(error); process.exitCode = 1; });
