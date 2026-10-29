const assert = require("node:assert/strict");
const { load, setMock } = require("./lib/rentalTestHarness.cjs");

for (const [alias, file] of Object.entries({
  "@/lib/pricing": "src/lib/pricing.ts",
  "@/lib/dates": "src/lib/dates.ts",
  "@/lib/mount": "src/lib/mount.ts",
  "@/lib/compat": "src/lib/compat.ts",
  "@/lib/site": "src/lib/site.ts",
  "@/lib/kitRank": "src/lib/kitRank.ts",
  "@/lib/catalogCandidates": "src/lib/catalogCandidates.ts",
})) setMock(alias, load(file));

setMock("next/server", { NextResponse: { json: (body, init = {}) => ({ body, status: init.status ?? 200 }) } });
setMock("@/lib/ai", { botModel: { name: "isolated-test-model" } });
setMock("ai", { generateObject: async () => ({ object: { stages: [{ key: "camera", recommend: "Sony a7 III" }, { key: "gimbal" }] } }) });
setMock("@/lib/ratelimit", { rateLimit: async () => ({ allowed: true }) });

const fx3 = {
  _id: "fx3-body",
  slug: "sony-fx3-body-kit",
  title: "Sony FX3 Body Kit with Cage and 320GB CFexpress Card",
  itemType: "camera-body",
  active: true,
  stockMappingStatus: "complete",
  pricing: { daily: 47, day3: 40 },
  specs: { mount: "Sony E", coverage: "full-frame" },
  components: [{ inventoryUnitId: "fx3-pool", qty: 1 }],
  inventoryFacts: { owned: true, reviewRequired: false, contents: ["1 × Sony FX3 body"] },
  demandScore: 50,
};
const a7Bundle = {
  _id: "a7-gimbal-bundle",
  slug: "sony-a7-iii-gimbal-bundle",
  title: "Sony a7 III, 24-70mm GM Lens and DJI RS3 Pro Gimbal",
  itemType: "camera-body",
  active: true,
  stockMappingStatus: "complete",
  pricing: { daily: 45, day3: 38 },
  specs: { mount: "Sony E", coverage: "full-frame" },
  components: [{ inventoryUnitId: "a7-bundle-pool", qty: 1 }],
  inventoryFacts: { owned: true, reviewRequired: false, contents: ["1 × Sony a7 III", "1 × 24-70mm GM Lens", "1 × DJI RS3 Pro Gimbal"] },
  demandScore: 20,
};

let refreshed = 0;
const calls = [];
setMock("convex/browser", { ConvexHttpClient: class {
  async action(_name, args) {
    calls.push("refresh");
    refreshed++;
    assert.equal(args.items.length, 1);
    assert([fx3._id, a7Bundle._id].includes(args.items[0].listingId), "the stock refresh is anchored to a real catalogue candidate");
    assert.equal(args.items[0].start, Date.parse("2030-11-20T00:00:00.000Z"));
    assert.equal(args.items[0].end, Date.parse("2030-11-20T00:00:00.000Z"));
    assert.equal(args.items[0].pickupTime, "10:00");
    assert.equal(args.items[0].returnTime, "18:00");
    return { checkedAt: Date.now(), cached: true };
  }
  async query(name, args) {
    calls.push(name);
    if (name === "catalog.compatibilityKits") return [];
    if (name === "catalog.byItemType") throw Error("BadConvexFunctionIdentifier");
    if (name === "catalog.listListings") return [fx3, a7Bundle].slice(0, args.limit ?? 500);
    if (name === "availability.forListing") return { available: 3, owned: 3 };
    throw Error(`Unexpected query ${name}`);
  }
} });

process.env.OPENROUTER_API_KEY = "isolated-route-test";
process.env.NEXT_PUBLIC_CONVEX_URL = "https://fixture.convex.cloud";
const { POST } = load("src/app/api/assemble/route.ts");

(async () => {
  const response = await POST({ json: async () => ({
    start: "2030-11-20",
    end: "2030-11-20",
    pickupTime: "10:00",
    returnTime: "18:00",
    shootType: "interview",
    size: "small crew",
    note: "FX3 camera body only",
    categories: [],
    cameras: 1,
    budget: 120,
  }) });

  assert.equal(response.status, 200);
  assert.equal(refreshed, 1, "assembly refreshes the shared Rental Manager stock mirror before ranking availability");
  assert(calls.indexOf("refresh") < calls.indexOf("availability.forListing"), "the existing cart refresh completes before live candidate availability reads");
  const cameraStage = response.body.stages.find(stage => stage.key === "camera");
  assert(cameraStage, "the camera-only assembly keeps its requested camera stage");
  assert.equal(cameraStage.recommendedId, fx3._id, "the named FX3 outranks the parser's cheaper A7 bundle");
  assert(!response.body.stages.some(stage => stage.key === "gimbal"), "a camera-only brief does not add a gimbal stage");
  assert(cameraStage.options.some(option => option.listingId === fx3._id), "the legacy catalogue fallback feeds real FX3 listing cards");
  console.log("PASS assembly route: refreshes Rental Manager stock, recovers the exact FX3 from the older catalogue API, and preserves camera-only intent.");
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
