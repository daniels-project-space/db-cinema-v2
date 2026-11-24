const assert = require("node:assert/strict");
const { load, db, put } = require("./lib/rentalTestHarness.cjs");
process.env.ADMIN_TOKEN = "component-preview-admin";
const preview = load("convex/componentReplacementPreview.ts");
const unit = (rmv2ItemId, replacementCost) => put("inventory_units", { rmv2ItemId, name: rmv2ItemId, active: true, quantityOwned: 2, replacementCost });
const body = unit("body", 3000), old = unit("old", 1000), replacement = unit("new", 2000);
const rule = { originalMasterItemId: "old", replacementMasterItemId: "new", quantityPerKit: 1, priceAdjustmentPence: 500, replacementSizeScore: 2, reviewedAt: 1,
  weights: [{ masterItemId: "body", weightGrams: 1000 }, { masterItemId: "old", weightGrams: 600 }, { masterItemId: "new", weightGrams: 800 }],
  replacementInventory: { masterItemId: "new", active: true, quantityOwned: 2, replacementCost: 2000 } };
const listing = put("listings", { title: "Camera kit", active: true, stockMappingStatus: "complete", components: [{ inventoryUnitId: body._id, qty: 1 }, { inventoryUnitId: old._id, qty: 1 }], pricing: { daily: 100 },
  componentReplacementEvidence: { version: 1, checkoutAvailable: false, reviewedSubstitutions: [rule] } });
const now = Date.now();
const state = put("rmv2_sync_state", { key: "shared-stock-v1", status: "ok", lastSyncedAt: now, cursor: JSON.stringify({ checkedAt: now }) });
const args = { token: "component-preview-admin", listingId: listing._id, originalMasterItemId: "old", replacementMasterItemId: "new", start: Date.UTC(2031, 0, 1), end: Date.UTC(2031, 0, 1), quantity: 2 };
(async () => {
  await assert.rejects(preview.preview.handler({ db }, { ...args, token: "guest" }), /unauthorized/i);
  await assert.rejects(preview.preview.handler({ db }, { ...args, end: args.start + 366 * 86400000 }), /invalid rental dates/i);
  const result = await preview.preview.handler({ db }, args);
  assert.equal(result.checkoutAvailable, false);
  assert.equal(result.stockAvailabilityChecked, false);
  assert.equal(result.kitStockAvailable, true);
  assert.deepEqual(result.componentNames,{original:'old',replacement:'new'});
  assert.equal(result.allocation.priceAdjustmentPence, 1000);
  assert.equal(result.allocation.replacementValuePence, 1000000);
  assert.equal(result.allocation.weightGrams, 3600);
  assert.deepEqual(result.allocation.components, [{ unitId: "body", quantity: 2 }, { unitId: "new", quantity: 2 }]);
  assert.deepEqual(result.physicalDemands, [{ inventoryUnitId: body._id, start: args.start, end: args.end, qty: 2 }, { inventoryUnitId: replacement._id, start: args.start, end: args.end, qty: 2 }], "The effective stock claims use local inventory IDs, never the removed original");
  const missing = { ...rule, originalMasterItemId: "declared:lens-f4", declaredMissingOriginal: { descriptorId: "declared:lens-f4", label: "16–35mm f/4 lens", quantityPerKit: 1, sourceUrl: "https://example.invalid/listing", sourceExcerpt: "Includes 16–35mm f/4 lens" },
    weights: rule.weights.filter(weight => weight.masterItemId !== "old") };
  await db.patch(listing._id, { stockMappingStatus: "incomplete", components: [{ inventoryUnitId: body._id, qty: 1 }], componentReplacementEvidence: { version: 1, checkoutAvailable: false, reviewedSubstitutions: [missing] } });
  const declared = await preview.preview.handler({ db }, { ...args, originalMasterItemId: "declared:lens-f4" });
  assert.equal(declared.componentNames.original,'16–35mm f/4 lens');
  assert.deepEqual(declared.allocation.components, [{ unitId: "body", quantity: 2 }, { unitId: "new", quantity: 2 }]);
  assert.equal(declared.checkoutAvailable, false);
  assert.equal(declared.stockAvailabilityChecked, false);
  const other = put("listings", { active: true, components: [{ inventoryUnitId: body._id, qty: 1 }], title: "Another camera" });
  const combined = await preview.preview.handler({ db }, { ...args, quantity: 1, originalMasterItemId: "declared:lens-f4", otherItems: [{ listingId: other._id, start: args.start, end: args.end, qty: 2 }] });
  assert.equal(combined.kitStockAvailable, true);
  assert.equal(combined.providedBasketStockAvailable, false, "Overlapping lines must share the same physical stock pool");
  assert.equal(combined.stockAvailabilityChecked, false, "A caller-supplied basket cannot certify the customer's entire basket");
  const reservation = put("reservations", { inventoryUnitId: replacement._id, start: args.start, end: args.end, qty: 1, status: "confirmed", source: "site" });
  assert.equal((await preview.preview.handler({ db }, { ...args, originalMasterItemId: "declared:lens-f4" })).kitStockAvailable, false, "Real overlapping reservations block the replacement component");
  await db.patch(reservation._id, { status: "cancelled" });
  await db.patch(listing._id, { stockMappingStatus: "complete", components: [{ inventoryUnitId: body._id, qty: 1 }, { inventoryUnitId: old._id, qty: 1 }], componentReplacementEvidence: { version: 1, checkoutAvailable: false, reviewedSubstitutions: [rule] } });
  await db.patch(replacement._id, { replacementCost: 2100 });
  await assert.rejects(preview.preview.handler({ db }, args), /inventory has changed/i);
  await db.patch(replacement._id, { replacementCost: 2000 });
  await db.patch(state._id, { lastSyncedAt: now - 3600000 });
  await assert.rejects(preview.preview.handler({ db }, args), /fresh check/i);
  console.log("PASS owner-only replacement preview: actual mapped units and price, stale stock/value rejected; checkout and availability remain disabled");
})().catch(error => { console.error(error); process.exitCode = 1; });
