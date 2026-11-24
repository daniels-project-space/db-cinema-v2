const assert = require("node:assert/strict");
const { load } = require("./lib/rentalTestHarness.cjs");
const delivery = load("convex/delivery.ts");
const items = [{ listingId: "camera", sizeScore: 2, weightKg: 2, itemType: "camera-body" }, { listingId: "light", sizeScore: 2, weightKg: 1, itemType: "lens" }];
const previousFetch = global.fetch;
(async () => {
  global.fetch = async () => ({ ok: true, json: async () => ({ result: { latitude: 51.5095, longitude: -0.1281, region: "London" } }) });
  const ctx = { runQuery: async ref => ref === "settings.get" ? { deliveryMarginPct: 10 } : items };
  for (const deliveryLegs of ["one_way", "round_trip"]) {
    const result = await delivery.quote.handler(ctx, { postcode: "SW1A1AA", groups: [{ start: 1, end: 2, listingIds: ["camera", "light"] }], deliveryLegs });
    const expected = delivery.priceDeliveryLoad(items, 0, 10);
    assert.equal(result.ok, true);
    assert.equal(result.fee, deliveryLegs === "one_way" ? expected.oneWayFee : expected.roundTripFee);
    assert.equal(result.vehicle, expected.vehicle);
    assert.equal(result.load, expected.load);
  }
  assert.equal(delivery.priceDeliveryLoad([{ sizeScore: 2, weightKg: 2, itemType: "camera-body" }], 0, 10).vehicle, "motorcycle");
  assert.equal(delivery.priceDeliveryLoad([{ sizeScore: 2, weightKg: 21, itemType: "camera-body" }], 0, 10).vehicle, "van");
  assert.throws(() => delivery.priceDeliveryLoad([{ sizeScore: 2, weightKg: NaN, itemType: "lens" }], 0, 10), /fresh check/i);
  console.log("PASS delivery load parity: real quote and shared physical-load calculation match for both legs");
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => { global.fetch = previousFetch; });
