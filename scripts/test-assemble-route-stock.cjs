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
const fx3Bundle = { ...fx3, _id: "fx3-lens-bundle", slug: "fx3-lens-bundle", title: "Sony FX3 with 24-70mm GM Lens", demandScore: 9000,
  specs: { ...fx3.specs, includesLens: true }, inventoryFacts: { owned: true, reviewRequired: false, contents: ["1 × Sony FX3 body", "1 × 24-70mm lens"] } };
const fx3Gimbal = { ...fx3Bundle, title: "Sony FX3 with 24-70mm lens and gimbal", inventoryFacts: { owned: true, contents: ["1 × Sony FX3 body", "1 × lens", "1 × gimbal"] } };
const { assemblyStageBrief, inferAssemblyBriefConstraint, matchesAssemblyCamera } = load("shared/recommendationPolicy.ts");
assert.equal(inferAssemblyBriefConstraint(assemblyStageBrief("I need a lens for my Sony FX3", "lens"), ["fx3"]), null, "a camera's brand must not become an unrelated lens restriction");
const noGimbal = { model: "fx3", brief: "Sony FX3 with a lens, no gimbal", strict: true, count: 1 };
assert(matchesAssemblyCamera(fx3Bundle, noGimbal), "excluding a gimbal still permits the lens the customer requested");
assert(!matchesAssemblyCamera(fx3Gimbal, noGimbal), "a specifically excluded gimbal is never preselected");
const r5 = { ...fx3, _id: "r5-body", slug: "canon-r5-body", title: "Canon R5 camera body", demandScore: 1,
  marketingOnly: false, marketingOnlySource: "rental_manager", inventoryFacts: { owned: true, reviewRequired: false, contents: ["1 × Canon R5 camera"] } };
const plCamera = { ...fx3, _id: "pl-camera", slug: "pl-camera", title: "Blackmagic URSA Mini PL camera", demandScore: 2,
  marketingOnly: false, marketingOnlySource: "rental_manager", specs: { mount: "PL", coverage: "ff" }, inventoryFacts: { owned: true, reviewRequired: false, contents: ["1 × Blackmagic URSA camera"] } };
const komodo = { ...fx3, _id: "komodo-body", slug: "komodo-body", title: "RED Komodo Cinema Camera Body", demandScore: 1,
  marketingOnly: false, marketingOnlySource: "rental_manager", inventoryFacts: { owned: true, reviewRequired: false, contents: ["1 × RED Komodo camera"] } };
const remus = { ...fx3, _id: "remus-45", slug: "remus-45", title: "Blazar Remus 45mm T2 PL Anamorphic Lens", itemType: "lens", demandScore: 1,
  marketingOnly: false, marketingOnlySource: "rental_manager", specs: { mount: "PL", coverage: "ff", lensFocal: "45" }, components: [{ inventoryUnitId: "remus-pool", qty: 1 }], inventoryFacts: { owned: true, reviewRequired: false, contents: ["1 × Blazar Remus 45mm lens"] } };
const sonyLens = { ...remus, _id: "sony-lens", slug: "sony-lens", title: "Sony 70-200mm GM Lens", demandScore: 9999, specs: { mount: "E", coverage: "ff", lensFocal: "70-200" } };
const namedLight = { ...fx3, _id: "aputure-300d", slug: "aputure-300d", title: "Aputure 300d light", itemType: "light", demandScore: 1,
  marketingOnly: false, marketingOnlySource: "rental_manager", specs: {}, inventoryFacts: { owned: true, reviewRequired: false, contents: ["1 × Aputure 300d light"] } };
const otherLight = { ...namedLight, _id: "other-light", slug: "other-light", title: "Nanlite 500w light", demandScore: 9999 };
const dji1 = { ...fx3, _id: "dji-one", slug: "dji-one", title: "DJI Mic Wireless Kit with 2x Lavalier Microphones", itemType: "wireless-mic", demandScore: 1,
  marketingOnly: false, marketingOnlySource: "rental_manager", specs: {}, components: [{ inventoryUnitId: "dji-one-pool", qty: 1 }], inventoryFacts: { owned: true, reviewRequired: false, contents: ["1 × DJI Wireless Mics"] } };
const dji2 = { ...dji1, _id: "dji-two", slug: "dji-two", title: "DJI Mic 2 Wireless Kit", demandScore: 999, components: [{ inventoryUnitId: "dji-two-pool", qty: 1 }], inventoryFacts: { owned: true, reviewRequired: false, contents: ["1 × DJI Mic 2 wireless"] } };
const popular = Array.from({ length: 40 }, (_, i) => ({ ...a7Bundle, _id: `popular-${i}`, slug: `popular-${i}`, demandScore: 5000 - i }));
const catalogue = [fx3Bundle, ...popular, a7Bundle, fx3, r5, plCamera, komodo, remus, sonyLens, namedLight, otherLight, dji1, dji2];
let fx3Available = true;
let remusAvailable = true;

let refreshed = 0;
const calls = [];
setMock("convex/browser", { ConvexHttpClient: class {
  async action(_name, args) {
    calls.push("refresh");
    refreshed++;
    assert.equal(args.items.length, 1);
    assert(catalogue.some(item => item._id === args.items[0].listingId), "the stock refresh is anchored to a real catalogue candidate");
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
    if (name === "catalog.listListings") return catalogue.slice(0, args.limit ?? 500);
    if (name === "availability.forListing") return { available: (args.listingId === fx3._id && !fx3Available) || (args.listingId === remus._id && !remusAvailable) ? 0 : 3, owned: 3 };
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
  assert(cameraStage.options.some(option => option.listingId === fx3._id), "the requested body is checked even behind more than 36 popular listings");
  assert.equal(cameraStage.cameraConstraint.model, "fx3");
  assert.equal(cameraStage.cameraConstraint.strict, true);

  fx3Available = false;
  const unavailable = await POST({ json: async () => ({ start: "2030-11-20", end: "2030-11-20", pickupTime: "10:00", returnTime: "18:00", note: "FX3 camera body only, no lens", cameras: 1 }) });
  const unavailableCamera = unavailable.body.stages.find(stage => stage.key === "camera");
  assert.equal(unavailableCamera.recommendedId, "", "an available lens bundle is not silently recommended as a camera-only body");
  assert.equal(unavailableCamera.cameraPreferredId, fx3._id, "the unavailable exact body stays subscribed so it can become a pick when stock returns");
  assert.match(unavailableCamera.note, /requested model and configuration/);
  fx3Available = true;
  fx3.minimumRentalDays = 2;
  const minimumPeriod = await POST({ json: async () => ({ start: "2030-11-20", end: "2030-11-20", pickupTime: "10:00", returnTime: "18:00", note: "FX3 camera body only", cameras: 1 }) });
  assert.equal(minimumPeriod.body.stages.find(stage => stage.key === "camera").recommendedId, "", "a one-day request cannot auto-pick a two-day-minimum listing");
  delete fx3.minimumRentalDays;

  const canon = await POST({ json: async () => ({ start: "2030-11-20", end: "2030-11-20", pickupTime: "10:00", returnTime: "18:00", note: "Canon R5 camera body only", cameras: 1 }) });
  assert.equal(canon.body.stages.find(stage => stage.key === "camera").recommendedId, r5._id, "the same constraint applies to another camera model");
  const noGimbalResult = await POST({ json: async () => ({ start: "2030-11-20", end: "2030-11-20", pickupTime: "10:00", returnTime: "18:00", note: "FX3 with a lens, no gimbal", cameras: 1 }) });
  assert(!noGimbalResult.body.stages.some(stage => stage.key === "gimbal"), "a model-generated stage cannot reintroduce an explicitly excluded item");
  const red = await POST({ json: async () => ({ start: "2030-11-20", end: "2030-11-20", pickupTime: "10:00", returnTime: "18:00", note: "RED Komodo camera body only", cameras: 1 }) });
  assert.equal(red.body.stages.find(stage => stage.key === "camera").recommendedId, komodo._id, "named cameras without numeric model codes remain anchored to the requested item");
  const lensRequest = { start: "2030-11-20", end: "2030-11-20", pickupTime: "10:00", returnTime: "18:00", note: "I need the Blazar Remus 45mm PL lens", categories: ["Lenses"], cameras: 1 };
  const lensResult = await POST({ json: async () => lensRequest });
  assert.equal(lensResult.body.stages.find(stage => stage.key === "camera").recommendedId, plCamera._id, "the recommended camera must fit the explicitly requested lens");
  assert.equal(lensResult.body.stages.find(stage => stage.key === "lens").recommendedId, remus._id, "a named lens outranks a more popular unrelated zoom");
  remusAvailable = false;
  const unavailableLens = await POST({ json: async () => lensRequest });
  assert.equal(unavailableLens.body.stages.find(stage => stage.key === "camera").recommendedId, "", "do not anchor a camera to an unavailable requested lens");
  assert.equal(unavailableLens.body.stages.find(stage => stage.key === "lens").recommendedId, "", "do not replace the unavailable named lens with an unrelated one");
  remusAvailable = true;
  const absentModel = await POST({ json: async () => ({ ...lensRequest, note: "I need the Blazar Remus 65mm PL lens" }) });
  assert.equal(absentModel.body.stages.find(stage => stage.key === "lens").recommendedId, "", "a different focal length must not stand in for a missing named lens");
  const lightResult = await POST({ json: async () => ({ start: "2030-11-20", end: "2030-11-20", pickupTime: "10:00", returnTime: "18:00", note: "Please include an Aputure 300d light", categories: ["Lighting"], cameras: 1 }) });
  assert.equal(lightResult.body.stages.find(stage => stage.key === "light").recommendedId, namedLight._id, "named-item ranking also applies outside cameras and lenses");
  const micResult = await POST({ json: async () => ({ start: "2030-11-20", end: "2030-11-20", pickupTime: "10:00", returnTime: "18:00", note: "DJI Mic 1 wireless microphone", categories: ["Audio"], cameras: 1 }) });
  assert(!micResult.body.stages.some(stage => ["camera", "lens", "shotgun-mic"].includes(stage.key)), "an audio-only named microphone request must not add an unrelated camera, lens or shotgun mic");
  const micStages = micResult.body.stages.filter(stage => ["lav-mic", "wireless-mic"].includes(stage.key));
  assert(micStages.some(stage => stage.recommendedId === dji1._id), "the owner-verified first generation is offered");
  assert(!micStages.some(stage => stage.recommendedId === dji2._id), "DJI Mic 2 does not replace the requested first generation");
  console.log("PASS assembly route: refreshes Rental Manager stock, recovers the exact FX3 from the older catalogue API, and preserves camera-only intent.");
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
