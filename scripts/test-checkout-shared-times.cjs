const assert = require("node:assert/strict");
const fs = require("node:fs");
const { load } = require("./lib/rentalTestHarness.cjs");

const { applySharedTimePair, selectSharedTimePair } = load("shared/checkoutTimeSelection.ts");
const pairs = [
  { pickupTime: "09:00", returnTime: "12:00" },
  { pickupTime: "10:00", returnTime: "14:00" },
  { pickupTime: "11:00", returnTime: "13:00" },
];

assert.deepEqual(selectSharedTimePair(pairs, "10:00", "14:00"), pairs[1], "Keeps an exact valid shared pair");
assert.deepEqual(selectSharedTimePair(pairs, "10:00", "13:00", "pickup"), pairs[1], "Changing pickup keeps it and chooses a compatible return");
assert.deepEqual(selectSharedTimePair(pairs, "10:00", "13:00", "return"), pairs[2], "Changing return keeps it and chooses a compatible pickup");
assert.equal(selectSharedTimePair([], "10:00", "14:00"), null, "No shared availability fails closed");

const start = "2030-11-06", end = "2030-11-08";
const items = [
  { key: "one", listingId: "same-listing", start, end, days: 3, perDay: 100, total: 300 },
  { key: "two", listingId: "same-listing", start, end, days: 3, perDay: 100, total: 300 },
];
const updated = applySharedTimePair(items, [270, 270], "10:00", "11:00");
assert(updated.every(item => item.pickupTime === "10:00" && item.returnTime === "11:00"), "Every kit line receives the selected clocks");
assert(updated.every(item => item.days === 3 && item.total === 270 && item.perDay === 90), "Each line receives its server-quoted total and exact duration days");
assert.equal(new Set(updated.map(item => item.key)).size, 2, "Duplicate product lines retain unique cart keys after shared-time updates");
assert.throws(() => applySharedTimePair(items, [270], "10:00", "11:00"), /kit changed/i, "A stale partial quote cannot update only part of the kit");
assert.throws(() => applySharedTimePair(items, [270, -1], "10:00", "11:00"), /price could not be verified/i, "Invalid prices fail before any state is applied");
assert.throws(() => applySharedTimePair(items.map(item => ({ ...item, end: start })), [270, 270], "22:00", "09:00"), /Return must be after pickup/i, "Invalid same-date order fails closed");
const checkout = fs.readFileSync("src/app/checkout/page.tsx", "utf8");
assert.match(checkout, /const \[sharedRentalTimes,\s*setSharedRentalTimes\] = useState\(true\)/, "checkout defaults to one shared time pair for the whole kit");
assert.match(checkout, /checked=\{sharedRentalTimes\}[\s\S]*Use one time for the whole kit/, "the basket-wide time option is visibly enabled by default");
assert.match(checkout, /useSharedTimes=\{sharedRentalTimes\}/, "the default shared choice reaches each item's availability-checked selector");
console.log("PASS checkout shared times: preferred available pairs, all-line synchronization, exact-duration pricing, duplicate-key safety, and stale/invalid quote guards.");
