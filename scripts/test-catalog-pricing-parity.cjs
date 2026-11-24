const assert = require("node:assert/strict");
const { db, load, put } = require("./lib/rentalTestHarness.cjs");
const { repriceLines } = load("convex/catalog.ts");
const { repriceRentalLines } = load("convex/lib/catalogPricing.ts");
const listing = put("listings", { active: true, title: "Camera", pricing: { daily: 100 }, depositAmount: 500 });
const start = Date.UTC(2031, 0, 1), end = Date.UTC(2031, 0, 2);
const items = [
  { listingId: listing._id, start, end, pickupTime: "09:00", returnTime: "09:00" },
  { listingId: listing._id, start, end, pickupTime: "09:00", returnTime: "09:01" },
  { listingId: listing._id, start, end },
];
(async () => {
  const direct = await repriceRentalLines({ db }, items);
  const queried = await repriceLines.handler({ db }, { items });
  assert.deepEqual(queried, direct);
  assert.deepEqual(queried.map(item => item.total), [100, 200, 200]);
  console.log("PASS catalogue pricing: handler and transaction helper agree at duration boundaries");
})().catch(error => { console.error(error); process.exitCode = 1; });
