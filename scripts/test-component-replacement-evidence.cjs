const assert = require("node:assert/strict");
const { load, db } = require("./lib/rentalTestHarness.cjs");
const sync = load("convex/sync.ts");
const evidence = { version: 1, checkoutAvailable: false, reviewedSubstitutions: [{ originalMasterItemId: "old", replacementMasterItemId: "new", quantityPerKit: 1, priceAdjustmentPence: 500, extensionAdjustmentPence: Array.from({length:30}, (_, index) => (index + 1) * 125), replacementSizeScore: 2, reviewedAt: 100,
  weights: [{ masterItemId: "body", weightGrams: 1000 }, { masterItemId: "old", weightGrams: 600 }, { masterItemId: "new", weightGrams: 800 }], replacementInventory: { masterItemId: "new", active: true, quantityOwned: 2, replacementCost: 2000 } }] };
const component = (masterItemId, qty = 1) => ({ masterItemId, name: masterItemId, qty, quantityOwned: 2, active: true, replacementCost: 1000 });
const listing = { hyggloProductId: 7001, stockMappingStatus: "complete", stockComponents: [component("body"), component("old")], slug: "replacement-evidence-fixture", title: "Camera and lens", category: "Cameras", itemType: "camera-body", sizeScore: 1, weightKg: 2,
  sourceImages: [], pricing: { daily: 20 }, depositAmount: 2000, minimumRentalDays: 1, unavailableDates: [] };
const find = () => db.query("listings").withIndex("by_slug", q => q.eq("slug", listing.slug)).first();
(async () => {
  process.env.RMV2_WEBHOOK_URL = "https://fixture-manager.convex.site/dbcinema/booking-sync";
  process.env.RMV2_WEBHOOK_SECRET = "fixture-service-token";
  const originalFetch = global.fetch;
  global.fetch = async (_url, options) => {
    assert.equal(options.headers["x-dbcinema-sync-token"], "fixture-service-token");
    return { ok: true, json: async () => ({ protocolVersion: 1, status: "success", path: "hygglo_products:catalogueForStorefront", value: [{ productId: 7002, name: "Camera body", prices: [{ days: 1, pricePerDay: 20 }], valuation: 2000,
      isMarketingOnly: false, marketingOnlyMode: "manual", marketingOnlyUpdatedAt: 1, copySourceFingerprint: `v1:${"a".repeat(64)}`,
      stockMapping: { version: 1, complete: true, owned: true, components: listing.stockComponents }, componentReplacementEvidence: evidence }] }) };
  };
  let sourceArgs;
  await sync.syncFromRmv2.handler({ runMutation: async (_ref, args) => { sourceArgs = args; return sync.applyCatalog.handler({ db }, args); } }, {});
  assert.deepEqual(sourceArgs.items[0].componentReplacementEvidence, evidence, "Authenticated manager evidence survives the real catalogue importer");
  assert.deepEqual((await db.query("listings").withIndex("by_slug", q => q.eq("slug", "camera-body-7002")).first()).componentReplacementEvidence, evidence);
  global.fetch = originalFetch;
  await sync.applyCatalog.handler({ db }, { items: [{ ...listing, componentReplacementEvidence: evidence }] });
  let row = await find();
  assert.deepEqual(row.componentReplacementEvidence, evidence);
  assert.equal(row.componentReplacementEvidence.checkoutAvailable, false);
  await sync.applyCatalog.handler({ db }, { items: [{ ...listing, componentReplacementEvidence: { ...evidence, reviewedSubstitutions: [{ ...evidence.reviewedSubstitutions[0], extensionAdjustmentPence: [100] }] } }] });
  assert.equal((await find()).componentReplacementEvidence, undefined, "An incomplete extension adjustment ladder is rejected");
  await sync.applyCatalog.handler({ db }, { items: [{ ...listing, stockComponents: [component("body")] , componentReplacementEvidence: evidence }] });
  row = await find();
  assert.equal(row.componentReplacementEvidence, undefined, "Changed component mapping clears stale evidence");
  await sync.applyCatalog.handler({ db }, { items: [{ ...listing, componentReplacementEvidence: { ...evidence, checkoutAvailable: true } }] });
  assert.equal((await find()).componentReplacementEvidence, undefined, "An enabled or malformed upstream payload is never imported");
  await sync.applyCatalog.handler({ db }, { items: [{ ...listing, componentReplacementEvidence: evidence }] });
  await sync.applyCatalog.handler({ db }, { items: [listing] });
  assert.equal((await find()).componentReplacementEvidence, undefined, "A source that omits evidence cannot leave stale rules in place");
  const missing = { ...evidence, reviewedSubstitutions: [{ ...evidence.reviewedSubstitutions[0], originalMasterItemId: "declared:lens-f4", declaredMissingOriginal: { descriptorId: "declared:lens-f4", label: "16–35mm f/4 lens", quantityPerKit: 1, sourceUrl: "https://example.invalid/listing", sourceExcerpt: "Includes 16–35mm f/4 lens" }, weights: evidence.reviewedSubstitutions[0].weights.filter(weight => weight.masterItemId !== "old") }] };
  await sync.applyCatalog.handler({ db }, { items: [{ ...listing, stockMappingStatus: "incomplete", stockComponents: [component("body")], componentReplacementEvidence: missing }] });
  assert.deepEqual((await find()).componentReplacementEvidence, missing, "A documented missing lens needs no invented inventory unit");
  await sync.applyCatalog.handler({ db }, { items: [{ ...listing, stockMappingStatus: "incomplete", stockComponents: [component("body")], componentReplacementEvidence: { ...missing, reviewedSubstitutions: [{ ...missing.reviewedSubstitutions[0], declaredMissingOriginal: { ...missing.reviewedSubstitutions[0].declaredMissingOriginal, sourceExcerpt: "" } }] } }] });
  assert.equal((await find()).componentReplacementEvidence, undefined, "A missing component without source evidence is never imported");
  console.log("PASS disabled component evidence: exact source mapping, stale clearing and no upstream enablement");
})().catch(error => { console.error(error); process.exitCode = 1; });
