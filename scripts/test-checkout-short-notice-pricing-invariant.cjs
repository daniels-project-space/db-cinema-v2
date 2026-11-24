const assert = require("node:assert/strict");
const harness = require("./lib/rentalTestHarness.cjs");
const { calculateRentalPrice } = harness.load("convex/lib/rentalPrice.ts");
const catalog = harness.load("convex/catalog.ts");
const { sameDayRentalFeePence, isSameLondonRentalDay } = harness.load("shared/sameDayRentalFee.ts");
const { checkoutLineAllocation } = harness.load("shared/checkoutLineAllocation.ts");

const dayMs = 86400000;
const sameDayStart = Date.UTC(2030, 0, 1);
const nextDayStart = sameDayStart + dayMs;
const unit = harness.put("inventory_units", { active: true, quantityOwned: 1 });
const listing = harness.put("listings", {
  title: "Short-notice pricing fixture",
  active: true,
  stockMappingStatus: "complete",
  pricing: { daily: 100 },
  depositAmount: 0,
  components: [{ inventoryUnitId: unit._id, qty: 1 }],
});

const context = {
  db: harness.db,
  runQuery: async (reference, args) => {
    if (reference === "accounts._byEmail") return null;
    if (reference === "catalog.repriceLines") return catalog.repriceLines.handler(context, args);
    throw Error(`Unexpected query ${reference}`);
  },
};

function input(start, end = start, targetListing = listing) {
  return {
    items: [{
      listingId: targetListing._id,
      title: targetListing.title,
      start,
      end,
      qty: 1,
      total: 1,
      deposit: 0,
      pickupTime: "10:00",
      returnTime: "18:00",
    }],
    customer: { email: "short-notice@example.invalid" },
    fulfilment: "pickup",
  };
}

(async () => {
  const roundUpUnit = harness.put("inventory_units", { active: true, quantityOwned: 2 });
  const roundUpListing = harness.put("listings", {
    title: "Whole-pound total fixture",
    active: true,
    stockMappingStatus: "complete",
    pricing: { daily: 29 },
    depositAmount: 0,
    components: [{ inventoryUnitId: roundUpUnit._id, qty: 1 }],
  });
  const realNow = Date.now;
  let sameDayQuote, nextDayQuote, multiDayQuote, roundUpQuote;
  try {
    Date.now = () => Date.UTC(2030, 0, 1, 8);
    sameDayQuote = await calculateRentalPrice(context, input(sameDayStart));
    nextDayQuote = await calculateRentalPrice(context, input(nextDayStart));
    multiDayQuote = await calculateRentalPrice(context, input(sameDayStart, sameDayStart + 2 * dayMs));
    roundUpQuote = await calculateRentalPrice(context, input(sameDayStart, sameDayStart + 2 * dayMs, roundUpListing));
  } finally {
    Date.now = realNow;
  }

  assert.equal(sameDayQuote.items[0].total, 100, "same-day booking uses the current one-day listing rate");
  assert.equal(nextDayQuote.items[0].total, 100, "next-day booking uses the current one-day listing rate");
  assert.equal(sameDayQuote.sameDayFee, 10, "same-day fee is 10% of discounted equipment only");
  assert.equal(nextDayQuote.sameDayFee, 0, "tomorrow's pickup does not receive the same-day fee");
  assert.equal(sameDayQuote.totalDue, 110, "server total includes the same-day fee exactly once");
  assert.equal(nextDayQuote.totalDue, 100, "tomorrow's total has no same-day fee");
  assert.equal(multiDayQuote.items[0].total, 270, "three-day synthetic tier applies its 10% duration discount");
  assert.equal(multiDayQuote.sameDayFee, 27, "same-day fee uses the discounted three-day equipment price");
  assert.equal(multiDayQuote.totalDue, 297, "discounted rental and same-day fee compose once");
  assert.equal(roundUpQuote.items[0].total, 79, "checkout applies 10% to the £87 three-day base and rounds the resulting £78.30 rental total up once");
  assert.equal(roundUpQuote.sameDayFee, 7.9, "the same-day surcharge is exactly 10% of the rounded equipment rate");
  assert.equal(roundUpQuote.totalDue, 86.9, "checkout adds the exact fee without rounding the total up again");

  const mixedFee = sameDayRentalFeePence([
    { pickupAt: sameDayStart, discountedEquipmentAmount: 90 },
    { pickupAt: nextDayStart, discountedEquipmentAmount: 100 },
  ], Date.UTC(2030, 0, 1, 8));
  assert.equal(mixedFee, 900, "mixed-date basket charges only the same-day discounted equipment line");
  assert.equal(sameDayRentalFeePence([
    { pickupAt: sameDayStart, discountedEquipmentAmount: 90 },
    { pickupAt: nextDayStart, discountedEquipmentAmount: 100 },
  ], Date.UTC(2030, 0, 1, 8)), mixedFee, "repeated quote calculation cannot compound the fee");

  assert.equal(isSameLondonRentalDay(Date.UTC(2030, 6, 2, 0), Date.UTC(2030, 6, 1, 23, 30)), true,
    "London midnight follows BST, not UTC midnight");
  assert.equal(isSameLondonRentalDay(Date.UTC(2030, 6, 1, 23), Date.UTC(2030, 6, 1, 22, 30)), false,
    "a pickup before London midnight is not same-day after midnight");
  assert.equal(sameDayRentalFeePence([{ pickupAt: sameDayStart, discountedEquipmentAmount: 79 }], Date.UTC(2030, 0, 1, 8)), 790,
    "the same-day surcharge is 10% of £79");
  assert.equal(sameDayRentalFeePence([{ pickupAt: sameDayStart, discountedEquipmentAmount: 79.05 }], Date.UTC(2030, 0, 1, 8)), 791,
    "the same-day surcharge rounds half a penny up to the nearest penny");

  const funding = checkoutLineAllocation([100], [], 0, 0, 0, [sameDayQuote.sameDayFee]);
  assert.equal(funding.reduce((sum, line) => sum + line.card, 0), sameDayQuote.totalDue,
    "Stripe line allocation matches the authoritative quote total");
  const fundedByCredit = checkoutLineAllocation([100], [], 0, 0, 5, [sameDayQuote.sameDayFee]);
  assert.equal(fundedByCredit.reduce((sum, line) => sum + line.card, 0), sameDayQuote.totalDue - 5,
    "account credit can fund the fee without discounting or duplicating it");

  const checkout = harness.load("convex/checkout.ts");
  const quoteArgs = { ...input(sameDayStart), customerEmail: "short-notice@example.invalid" };
  delete quoteArgs.customer;
  const realNowForQuote = Date.now;
  let firstQuote, repeatedQuote;
  try {
    Date.now = () => Date.UTC(2030, 0, 1, 8);
    firstQuote = await checkout.priceQuote.handler(context, quoteArgs);
    repeatedQuote = await checkout.priceQuote.handler(context, quoteArgs);
  } finally {
    Date.now = realNowForQuote;
  }
  assert.equal(firstQuote.sameDayFee, 10, "customer price quote exposes same-day fee");
  assert.equal(firstQuote.totalDue, 110, "customer price quote matches checkout's authoritative total");
  assert.equal(repeatedQuote.totalDue, firstQuote.totalDue, "retrying a quote does not add the fee a second time");
  const roundUpArgs = { ...input(sameDayStart, sameDayStart + 2 * dayMs, roundUpListing), customerEmail: "short-notice@example.invalid" };
  delete roundUpArgs.customer;
  let roundUpCheckoutQuote;
  try {
    Date.now = () => Date.UTC(2030, 0, 1, 8);
    roundUpCheckoutQuote = await checkout.priceQuote.handler(context, roundUpArgs);
  } finally {
    Date.now = realNowForQuote;
  }
  assert.equal(roundUpCheckoutQuote.items[0].total, 79, "the checkout price-quote endpoint shares the whole-pound duration calculation");
  assert.equal(roundUpCheckoutQuote.totalDue, 86.9, "the checkout price-quote endpoint matches the exact same-day total");

  console.log("PASS same-day checkout surcharge: London cutoff, discounted/mixed-date gear, quote parity and one-time Stripe allocation.");
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
