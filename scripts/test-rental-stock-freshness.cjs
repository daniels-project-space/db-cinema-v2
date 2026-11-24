const assert = require("node:assert/strict");
const { load, db, put, putFreshSharedStock } = require("./lib/rentalTestHarness.cjs");

const availability = load("convex/availability.ts");
const replacements = load("convex/cartReplacements.ts");
const liveRecommendations = load("convex/liveRecommendations.ts");
const ctx = { db, scheduler: { runAfter: async () => {} } };
const unit = put("inventory_units", { name: "Freshness-test camera", active: true, quantityOwned: 1 });
const listing = put("listings", {
  active: true,
  category: "Lenses",
  itemType: "lens",
  title: "Freshness-test lens",
  slug: "freshness-test-lens",
  pricing: { daily: 20 },
  components: [{ inventoryUnitId: unit._id, qty: 1 }],
});
const start = Date.UTC(2030, 0, 1);
const end = start + 86400000;
const line = { listingId: listing._id, start, end, pickupTime: "10:00", returnTime: "17:00", qty: 1 };
const stockWindow = load("convex/lib/stockWindows.ts").stockWindow;
const group = { key: "lens", types: ["lens"], listingId: listing._id, start, end, pickupTime: "10:00", returnTime: "17:00" };

(async () => {
  const absentCart = await availability.forCart.handler(ctx, { items: [line] });
  assert.equal(absentCart[listing._id].ok, null, "missing RM snapshot stays unknown rather than falsely available");
  assert.equal(absentCart[listing._id].stockStatus, "refresh_required");
  assert.equal((await availability.forListing.handler(ctx, line)).stockStatus, "refresh_required");
  assert.equal((await availability.forTimeSlots.handler(ctx, { ...line, items: [] })).stockStatus, "refresh_required");
  assert.equal((await availability.forCheckoutTimeSlots.handler(ctx, { items: [line] })).stockStatus, "refresh_required");
  const calendar = await availability.forCalendar.handler(ctx, { listingId: listing._id, monthStart: Date.UTC(2030, 0, 1), items: [] });
  assert.equal(calendar["2030-01-01"].stockStatus, "refresh_required");
  assert.equal((await availability.nextAvailableForCart.handler(ctx, { items: [line], lineIndices: [0] }))[0].stockStatus, "refresh_required");
  assert.equal((await replacements.forCart.handler(ctx, { items: [{ ...line, key: "freshness" }] })).status, "refresh_required");
  assert.equal((await replacements.sets.handler(ctx, { items: [{ ...line, key: "freshness" }], sourceKey: "freshness" })).status, "refresh_required");
  const staleRecommendation = await liveRecommendations.options.handler(ctx, { groups: [group], basket: [] });
  assert.equal(staleRecommendation.stockStatus, "refresh_required");
  assert.equal(staleRecommendation.groups.lens.options[0].available, null, "Gaffer recommendations do not claim availability from a stale catalog mirror");

  const state = putFreshSharedStock();
  assert.equal((await availability.forCart.handler(ctx, { items: [line] }))[listing._id].ok, true);
  assert.equal((await availability.forListing.handler(ctx, line)).available, 1);
  const freshRecommendation = await liveRecommendations.options.handler(ctx, { groups: [group], basket: [] });
  assert.equal(freshRecommendation.stockStatus, "fresh");
  assert.equal(freshRecommendation.groups.lens.options[0].available, true);
  assert.equal((await replacements.forCart.handler(ctx, { items: [{ ...line, key: "freshness" }] })).status, "ready");

  const conflictWindow = stockWindow(line, true);
  put("reservations", {
    bookingId: "rental-manager-imported-conflict",
    listingId: listing._id,
    inventoryUnitId: unit._id,
    ...conflictWindow,
    qty: 1,
    source: "shared-stock-v1",
    status: "confirmed",
  });
  assert.equal((await availability.forCart.handler(ctx, { items: [line] }))[listing._id].ok, false, "a fresh RM-imported conflict is reported as unavailable");
  assert.equal((await availability.forListing.handler(ctx, line)).available, 0);
  const conflictedRecommendation = await liveRecommendations.options.handler(ctx, { groups: [group], basket: [] });
  assert.equal(conflictedRecommendation.groups.lens.options[0].available, false);

  const staleAt = Date.now() - 6 * 60000;
  await db.patch(state._id, { lastSyncedAt: staleAt, cursor: JSON.stringify({ version: 2, turnaroundBufferMinutes: 60, checkedAt: staleAt }) });
  const staleAfterConflict = await availability.forCart.handler(ctx, { items: [line] });
  assert.equal(staleAfterConflict[listing._id].ok, null, "a stale RM view is retriable, not presented as a confirmed stock conflict");
  assert.equal(staleAfterConflict[listing._id].stockStatus, "refresh_required");
  console.log("Rental stock freshness: every public availability surface fails closed on missing/stale RM snapshots, while fresh availability and imported conflicts remain distinct.");
})().catch(error => { console.error(error); process.exitCode = 1; });
