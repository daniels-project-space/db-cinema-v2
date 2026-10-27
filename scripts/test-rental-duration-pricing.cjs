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
  build("convex/lib/pricing.ts", "pricing.cjs");
  const { rentalPricingDays } = require(path.join(output, "rentalDuration.cjs"));
  const { quote } = require(path.join(output, "pricing.cjs"));
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

  const catalog = fs.readFileSync("convex/catalog.ts", "utf8");
  const pricing = fs.readFileSync("convex/lib/rentalPrice.ts", "utf8");
  const checkout = fs.readFileSync("src/app/checkout/page.tsx", "utf8");
  const dateEditor = fs.readFileSync("src/components/cart/CartItemDates.tsx", "utf8");
  assert.match(catalog, /rentalPricingDays\(it\.start,\s*it\.end,\s*it\.pickupTime,\s*it\.returnTime\)/, "server listing repricing uses selected clocks");
  assert.match(pricing, /pickupTime:\s*i\.pickupTime,\s*returnTime:\s*i\.returnTime/, "checkout forwards selected clocks to authoritative repricing");
  assert.match(checkout, /pickupTime:\s*i\.pickupTime\s*\|\|\s*effectivePickupTime[^,]*,\s*returnTime:\s*i\.returnTime\s*\|\|\s*effectiveReturnTime/, "checkout price quote uses the selected per-line or default clocks");
  assert.match(dateEditor, /pickupTime,\s*returnTime,\s*qty:\s*1/, "cart date editor forwards selected clocks when repricing");
  console.log("Rental duration pricing: PASS");
} finally {
  fs.rmSync(output, { recursive: true, force: true });
}
