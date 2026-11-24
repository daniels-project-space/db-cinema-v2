const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const esbuild = require("esbuild");

const output = fs.mkdtempSync(path.join(os.tmpdir(), "dbc-rental-duration-"));
try {
  const build = (entry, outfile) => esbuild.buildSync({
    entryPoints: [entry], outfile: path.join(output, outfile), bundle: true, platform: "node", format: "cjs",
  });
  build("shared/rentalDuration.ts", "rentalDuration.cjs");
  build("shared/rentalPricing.ts", "shared-pricing.cjs");
  build("convex/lib/pricing.ts", "pricing.cjs");
  build("src/lib/pricing.ts", "storefront-pricing.cjs");
  build("convex/lib/websitePricing.ts", "website-pricing.cjs");
  const { rentalPricingDays } = require(path.join(output, "rentalDuration.cjs"));
  const { quote, toPence } = require(path.join(output, "pricing.cjs"));
  const { quote: storefrontQuote, formatRate } = require(path.join(output, "storefront-pricing.cjs"));
  const sharedQuote = require(path.join(output, "shared-pricing.cjs")).quote;
  const websitePricing = require(path.join(output, "website-pricing.cjs"));
  const day = (value) => Date.parse(`${value}T00:00:00.000Z`);

  assert.equal(rentalPricingDays(day("2026-06-10"), day("2026-06-10"), "09:00", "13:00"), 1, "same-day rentals bill one day");
  assert.equal(rentalPricingDays(day("2026-06-10"), day("2026-06-11"), "09:00", "08:59"), 1, "23h59 across dates bills one day");
  assert.equal(rentalPricingDays(day("2026-06-10"), day("2026-06-11"), "09:00", "09:00"), 1, "exactly 24 hours bills one day");
  assert.equal(rentalPricingDays(day("2026-06-10"), day("2026-06-11"), "09:00", "09:01"), 2, "a started second 24-hour period bills a second day");
  assert.equal(rentalPricingDays(day("2026-06-10"), day("2026-06-12"), "09:00", "09:00"), 2, "exactly 48 hours bills two days");
  assert.equal(rentalPricingDays(day("2026-06-10"), day("2026-06-11")), 2, "date-only legacy baskets keep inclusive-day pricing");
  assert.equal(rentalPricingDays(day("2026-03-28"), day("2026-03-29"), "09:00", "09:00"), 1, "London spring clock change uses elapsed time");
  assert.equal(rentalPricingDays(day("2026-10-24"), day("2026-10-25"), "09:00", "09:00"), 2, "London autumn clock change uses elapsed time");
  assert.throws(() => rentalPricingDays(day("2026-06-10"), day("2026-06-10"), "09:00", "09:00"), /after pickup/);
  assert.equal(quote({ daily: 120, day3: 270 }, rentalPricingDays(day("2026-06-10"), day("2026-06-11"), "09:00", "09:00")).total, 120, "authoritative price tier uses the one-day duration");
  assert.equal(quote({ daily: 120, day3: 270 }, rentalPricingDays(day("2026-06-10"), day("2026-06-11"), "09:00", "09:01")).total, 240, "crossing 24 hours triggers authoritative two-day pricing");

  const pennyPricing = { daily: 28.22, day3: 25.11, day7: 22.09 };
  assert.equal(formatRate(pennyPricing.daily), "29", "catalogue display rounds fractional daily rates up to match checkout");
  assert.equal(formatRate(pennyPricing.day7), "23", "multi-day display also rounds fractional rates up");
  assert.equal(formatRate(storefrontQuote({ daily: 10, day7: 15 }, 7).perDay), "7", "explicit source prices cannot override the requested 30% weekly discount");
  const fallbackTiers = [3, 7, 14, 30].map(days => sharedQuote({ daily: 100 }, days).perDay);
  assert.deepEqual(fallbackTiers, [90, 70, 65, 60], "missing listing duration prices use the current 10/30/35/40 percent total-discount ladder");
  const conflictingSourceTiers = [1, 3, 7, 14, 30].map(days => sharedQuote({ daily: 100, day3: 99, day7: 105, day14: 95, day30: 100 }, days).perDay);
  assert.deepEqual(conflictingSourceTiers, [100, 90, 70, 65, 60], "explicit Rental Manager rates cannot bypass the authoritative duration discount policy");
  const sourcePrice = { daily: 47.25 };
  const newListingFactors = websitePricing.websitePriceFactors(sourcePrice);
  const newListingPrice = websitePricing.applyWebsitePriceFactors(sourcePrice, newListingFactors);
  assert.equal(newListingPrice.daily, 59, "new listings get one 22.7% increase over the renter-visible £48 rate, rounded up");
  assert.deepEqual([1, 3, 7, 14, 30].map(days => sharedQuote(newListingPrice, days).total), [59, 160, 290, 537, 1062], "the increased daily rate feeds exact 10/30/35/40% total discounts, then rounds each final duration total up once");
  assert.deepEqual([1, 3, 7, 14, 30].map(days => sharedQuote(newListingPrice, days).perDay), [59, 53.33, 41.43, 38.36, 35.4], "per-day averages derive from the final rounded duration totals");
  const migrationFactors = websitePricing.websitePriceFactorsForPolicy(sourcePrice, undefined, 4, newListingPrice);
  const migratedPrice = websitePricing.applyWebsitePriceFactors(sourcePrice, migrationFactors);
  assert.equal(migratedPrice.daily, newListingPrice.daily, "a pricing-policy migration preserves the renter-visible daily rate instead of adding another 22.7%");
  const stableFactors = websitePricing.websitePriceFactorsForPolicy(sourcePrice, migrationFactors, websitePricing.WEBSITE_PRICE_POLICY_VERSION, migratedPrice);
  assert.deepEqual(websitePricing.applyWebsitePriceFactors(sourcePrice, stableFactors), migratedPrice, "subsequent catalogue syncs do not compound the approved price increase");
  const gearCard = fs.readFileSync("src/components/GearCard.tsx", "utf8");
  assert.match(gearCard, /formatRate\(quote\(pricing,\s*7\)\.total\)/, "the catalogue seven-day teaser uses the exact authoritative weekly total");
  const expected = [
    { days: 1, total: 29, dailyBaseline: 29, saved: 0, discountPercent: 0, nextTotal: 79, nextSaved: 8 },
    { days: 3, total: 79, dailyBaseline: 87, saved: 8, discountPercent: 10, nextTotal: 143, nextSaved: 60 },
    { days: 7, total: 143, dailyBaseline: 203, saved: 60, discountPercent: 30, nextTotal: 264, nextSaved: 142 },
  ];
  for (const row of expected) {
    const backend = quote(pennyPricing, row.days);
    const frontend = storefrontQuote(pennyPricing, row.days);
    assert.deepEqual(backend, sharedQuote(pennyPricing, row.days), `${row.days}-day server quote delegates to shared pricing`);
    assert.deepEqual(frontend, sharedQuote(pennyPricing, row.days), `${row.days}-day storefront quote delegates to shared pricing`);
    assert.deepEqual(frontend, backend, `storefront and Convex quote match for ${row.days}-day rentals`);
    assert.equal(backend.total, row.total, `${row.days}-day total remains penny accurate`);
    assert.equal(backend.dailyBaseline, row.dailyBaseline, `${row.days}-day daily baseline remains penny accurate`);
    assert.equal(backend.saved, row.saved, `${row.days}-day saving remains penny accurate`);
    assert.equal(backend.discountPercent, row.discountPercent, `${row.days}-day quote applies the policy discount to the full rental total`);
    assert.equal(backend.perDay, Math.round((backend.total / row.days) * 100) / 100, `${row.days}-day average derives from its final total`);
    assert.equal(backend.next?.total, row.nextTotal, `${row.days}-day next-tier total remains penny accurate`);
    assert.equal(backend.next?.saved, row.nextSaved, `${row.days}-day next-tier saving remains penny accurate`);
    const stripePence = toPence(backend.total);
    assert.equal(stripePence, Math.round(row.total * 100), `${row.days}-day quote converts to exact Stripe pence`);
    assert.equal(toPence(stripePence / 100), stripePence, `${row.days}-day Stripe pence conversion is idempotent`);
  }

  const increasedLadder = { daily: 29, day3: 25, day7: 20 };
  assert.deepEqual([1, 3, 7].map(days => sharedQuote(increasedLadder, days).total), [29, 79, 143], "whole-pound base rates apply the approved total duration discounts even when source tiers conflict");
  assert.deepEqual([1, 3, 7].map(days => sharedQuote(increasedLadder, days).perDay), [29, 26.33, 20.43], "average per-day rates derive from each final whole-pound rental total");
  const bookingPanel = fs.readFileSync("src/components/booking/BookingPanel.tsx", "utf8");
  assert.match(bookingPanel, /formatRate\(tier\.total\)\} total/, "duration ladder labels show the exact period total rather than a rounded average that cannot multiply back");
  assert.doesNotMatch(bookingPanel, /formatRate\(q\.perDay\)\/day × \{days\}/, "selected total does not imply a rounded per-day multiplication");

  const catalog = fs.readFileSync("convex/catalog.ts", "utf8");
  const catalogPricing = fs.readFileSync("convex/lib/catalogPricing.ts", "utf8");
  const pricing = fs.readFileSync("convex/lib/rentalPrice.ts", "utf8");
  const checkout = fs.readFileSync("src/app/checkout/page.tsx", "utf8");
  const dateEditor = fs.readFileSync("src/components/cart/CartItemDates.tsx", "utf8");
  const timeEditor = fs.readFileSync("src/components/cart/CartItemTimes.tsx", "utf8");
  const cartPage = fs.readFileSync("src/app/cart/page.tsx", "utf8");
  const cartDrawer = fs.readFileSync("src/components/cart/CartDrawer.tsx", "utf8");
  assert.match(catalog, /repriceRentalLines\(ctx,\s*items\)/, "catalogue repricing delegates to the shared authoritative helper");
  assert.match(catalogPricing, /rentalPricingDays\(item\.start,\s*item\.end,\s*item\.pickupTime,\s*item\.returnTime\)/, "the shared server repricer uses selected clocks");
  assert.match(pricing, /pickupTime:\s*i\.pickupTime,\s*returnTime:\s*i\.returnTime/, "checkout forwards selected clocks to authoritative repricing");
  assert.match(checkout, /pickupTime:\s*i\.pickupTime,\s*returnTime:\s*i\.returnTime/, "checkout price quote uses each rental line's selected clocks");
  assert.match(checkout, /<CartItemTimes\b/, "exact pickup and return clocks are selected at checkout");
  assert.doesNotMatch(cartPage, /<CartItemTimes\b/, "adding or editing basket dates does not prompt for exact times");
  assert.doesNotMatch(cartDrawer, /<CartItemTimes\b/, "the basket drawer does not prompt for exact times before checkout");
  assert.doesNotMatch(checkout, /pickupTime:\s*i\.pickupTime\s*\|\|\s*effectivePickupTime/, "checkout does not reuse a global clock across rental lines");
  assert.match(dateEditor, /pickupTime,\s*returnTime,\s*qty:\s*1/, "cart date editor forwards selected clocks when repricing");
  assert.match(timeEditor, /isFirstBasketItem\s*\?\s*"\. Each started 24-hour block counts as a day, so crossing a 24-hour boundary adds a rental day; the checkout total updates with your times\./, "checkout explains additional-day repricing once without repeating the warning per basket line");
  assert.match(cartPage, /<CartThirdDayOffer\s+item=\{it\}/, "full cart exposes the authoritative third-day offer");
  assert.match(cartDrawer, /<CartThirdDayOffer\s+item=\{it\}[^>]*currentTotal=\{quote\?\.items\[i\]\?\.total\s*\?\?\s*it\.total\}/, "cart drawer exposes the same authoritative third-day offer and current quote");
  console.log("Rental duration pricing: PASS");
} finally {
  fs.rmSync(output, { recursive: true, force: true });
}
