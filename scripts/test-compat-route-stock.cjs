const assert = require("node:assert/strict");
const { load, setMock } = require("./lib/rentalTestHarness.cjs");

for (const [alias, file] of Object.entries({
  "@/lib/pricing": "src/lib/pricing.ts",
  "@/lib/dates": "src/lib/dates.ts",
  "@/lib/compat": "src/lib/compat.ts",
  "@/lib/ratelimit": "src/lib/ratelimit.ts",
  "@/lib/catalogCandidates": "src/lib/catalogCandidates.ts",
})) setMock(alias, load(file));

setMock("next/server", { NextResponse: { json: (body, init = {}) => ({ body, status: init.status ?? 200 }) } });
setMock("@/lib/ratelimit", { rateLimit: async () => ({ allowed: true }) });

const camera = {
  _id: "fx3-body",
  slug: "sony-fx3-body",
  title: "Sony FX3 Body",
  itemType: "camera-body",
  active: true,
  stockMappingStatus: "complete",
  pricing: { daily: 47 },
  specs: { mount: "E", coverage: "ff" },
  components: [{ inventoryUnitId: "fx3-pool", qty: 1 }],
  inventoryFacts: { owned: true, reviewRequired: false, contents: ["1 × Sony FX3 body"] },
};
const standardLens = {
  _id: "standard-lens",
  slug: "sony-24-70-standard",
  title: "Sony 24-70mm Standard Zoom Lens",
  itemType: "lens",
  active: true,
  stockMappingStatus: "complete",
  pricing: { daily: 35 },
  specs: { mount: "E", coverage: "ff", lensFocal: "24-70", lensClass: "af", tier: "standard" },
  components: [{ inventoryUnitId: "standard-lens-pool", qty: 1 }],
  inventoryFacts: { owned: true, reviewRequired: false, contents: ["1 × Sony 24-70mm Standard Zoom Lens"] },
};
const premiumLens = {
  _id: "premium-lens",
  slug: "sony-24-70-premium",
  title: "Sony 24-70mm Premium G Master Lens",
  itemType: "lens",
  active: true,
  stockMappingStatus: "complete",
  pricing: { daily: 55 },
  specs: { mount: "E", coverage: "ff", lensFocal: "24-70", lensClass: "af", tier: "premium" },
  components: [{ inventoryUnitId: "premium-lens-pool", qty: 1 }],
  inventoryFacts: { owned: true, reviewRequired: false, contents: ["1 × Sony 24-70mm Premium G Master Lens"] },
  demandScore: 25,
};
const basket = [
  { listingId: camera._id, start: "2030-11-20", end: "2030-11-20", pickupTime: "10:00", returnTime: "18:00" },
  { listingId: standardLens._id, start: "2030-11-20", end: "2030-11-20", pickupTime: "10:00", returnTime: "18:00" },
];

let refreshed = 0;
let liveAvailable = true;
const calls = [];
setMock("convex/browser", { ConvexHttpClient: class {
  async action(_name, args) { calls.push("refresh"); refreshed++; assert.equal(args.items.length, 2); assert.equal(args.items[0].pickupTime, "10:00"); return { checkedAt: Date.now(), availability: {} }; }
  async query(name, args) {
    calls.push(name);
    if (name === "catalog.listingsByIds") return [camera, standardLens];
    if (name === "catalog.byItemType") throw Error("BadConvexFunctionIdentifier");
    if (name === "catalog.listListings") return [camera, standardLens, premiumLens].slice(0, args.limit ?? 500);
    if (name === "availability.forTimeSlots") return {
      available: liveAvailable ? 1 : 0,
      pickupSlots: liveAvailable ? ["10:00"] : [],
      returnSlots: liveAvailable ? ["18:00"] : [],
    };
    throw Error(`Unexpected query ${name}`);
  }
} });

process.env.NEXT_PUBLIC_CONVEX_URL = "https://fixture.convex.cloud";
const { POST } = load("src/app/api/compat/route.ts");

(async () => {
  const response = await POST({ json: async () => ({ items: basket }) });
  assert.equal(response.status, 200);
  assert.equal(refreshed, 1, "basket upgrades refresh Rental Manager inventory before checking options");
  assert.equal(calls[0], "refresh");
  assert.equal(response.body.upgrades[0]?.listingId, premiumLens._id, "the exact same-focal compatible premium lens is offered");
  assert.equal(response.body.upgrades[0]?.replaceListingId, standardLens._id);

  liveAvailable = false;
  const unavailable = await POST({ json: async () => ({ items: basket }) });
  assert.equal(unavailable.body.upgrades.length, 0, "unavailable upgrades are removed after the live basket stock check");
  console.log("PASS checkout compatibility route: refreshes shared stock, falls back to the bounded legacy catalogue, and offers only a live available exact-focal upgrade.");
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
