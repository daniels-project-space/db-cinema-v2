const assert = require("node:assert/strict");
const { load, db, put } = require("./lib/rentalTestHarness.cjs");
const { quoteSwapFunding } = load("convex/lib/rentalSwapFunding.ts");
const line = { listingId: "old", start: 100, end: 200, qty: 1, lineTotal: 100 };
const replacement = amount => ({ ...line, listingId: "new", lineTotal: amount });
const fixture = percent => ({
  pricingVersion: "single-benefit-v1", benefitKind: "loyalty", swapBenefitRule: { version: "encore-percent-v1", percent },
  subtotal: 100, discount: percent, lineItems: [line],
  checkoutLineFunding: [{ ...line, gross: 100, discount: percent, membershipCredit: 0, accountCredit: 0, card: 100 - percent }],
  checkoutLineCreditSources: [], creditAllocations: [],
});

(async () => {
  for (const percent of [2, 4, 10]) {
    const booking = fixture(percent);
    const upgrade = await quoteSwapFunding({ db }, booking, 0, replacement(120));
    assert.equal(upgrade.deltaPence, Math.round(2000 * (100 - percent) / 100));
    assert.equal(upgrade.nextFunding.discount, 120 * percent / 100);
    const downgrade = await quoteSwapFunding({ db }, booking, 0, replacement(50));
    assert.equal(downgrade.deltaPence, -Math.round(5000 * (100 - percent) / 100));
    const after = { ...booking, subtotal: 50, discount: downgrade.nextFunding.discount, lineItems: [replacement(50)], checkoutLineFunding: [downgrade.nextFunding] };
    const second = await quoteSwapFunding({ db }, after, 0, replacement(75));
    assert.equal(second.deltaPence, Math.round(2500 * (100 - percent) / 100));
  }
  const pennies = await quoteSwapFunding({ db }, fixture(2), 0, replacement(0.26));
  assert.equal(pennies.nextFunding.discount, 0.01, "Percentage is rounded to a whole penny");
  assert.equal(pennies.nextFunding.card, 0.25);
  const account = put("accounts", { email: "encore-credit@example.invalid" });
  const credit = put("credits", { accountId: account._id, kind: "refund", currency: "GBP", amount: 20, remaining: 0 });
  const credited = { ...fixture(10), accountId: account._id, creditAllocations: [{ creditId: credit._id, amount: 20, kind: "refund" }], checkoutLineCreditSources: [{ lineIndex: 0, creditId: credit._id, amount: 20, kind: "refund" }], checkoutLineFunding: [{ ...fixture(10).checkoutLineFunding[0], accountCredit: 20, card: 70 }] };
  const creditedDowngrade = await quoteSwapFunding({ db }, credited, 0, replacement(10));
  assert.equal(creditedDowngrade.deltaPence, -7000);
  assert.equal(creditedDowngrade.nextFunding.discount, 1);
  assert.equal(creditedDowngrade.nextFunding.accountCredit, 9);
  assert.equal(creditedDowngrade.restore[0].amountPence, 1100);
  await assert.rejects(quoteSwapFunding({ db }, { ...fixture(10), swapBenefitRule: undefined }, 0, replacement(50)), /cannot be safely repriced/);
  await assert.rejects(quoteSwapFunding({ db }, { ...fixture(10), swapBenefitRule: { version: "encore-percent-v1", percent: 9 } }, 0, replacement(50)), /cannot be safely repriced/);
  await assert.rejects(quoteSwapFunding({ db }, { ...fixture(10), membershipSignupOfferSaving: 1 }, 0, replacement(50)), /cannot be safely repriced/);
  await assert.rejects(quoteSwapFunding({ db }, { ...fixture(10), discount: 9 }, 0, replacement(50)), /cannot be safely repriced/);
  await assert.rejects(quoteSwapFunding({ db }, { ...fixture(10), lineItems: [line, line], checkoutLineFunding: [fixture(10).checkoutLineFunding[0], fixture(10).checkoutLineFunding[0]] }, 0, replacement(50)), /does not balance/);
  console.log("PASS swap Encore discount: frozen percentage, rounding, repeats and unsafe historical cases");
})().catch(error => { console.error(error); process.exitCode = 1; });
