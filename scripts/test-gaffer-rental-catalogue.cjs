const assert = require("node:assert/strict");
const { load, put, tables, setMock } = require("./lib/rentalTestHarness.cjs");
const { gafferCatalogIntent } = load("convex/lib/gafferCatalogIntent.ts");
const { lookup } = load("convex/gafferCatalogue.ts");
let modelOptions;
setMock("@openrouter/ai-sdk-provider", { createOpenRouter: () => () => ({}) });
setMock("ai", { generateObject: async options => { modelOptions = options; return { object: { reply: "The Sony FX3 is in our catalogue; please check dates on the gear page.", handoff: false, offerCredit: false, offerHuman: false, resolved: false } }; } });
const { gafferReply } = load("convex/gaffer.ts");

(async () => {
  const db = { query(table) { let rows = [...(tables.get(table) ?? [])]; const range = { search(key, value) { rows = rows.filter(row => String(row[key] ?? "").toLowerCase().includes(value.toLowerCase())); return range; }, eq(key, value) { rows = rows.filter(row => row[key] === value); return range; } }; const query = { withSearchIndex(_name, fn) { fn(range); return query; }, withIndex(_name, fn) { fn(range); return query; }, order() { return query; }, async take(limit) { assert.equal(limit, 40, "Candidate reads stay bounded"); return rows.slice(0, limit); } }; return query; } };
  assert.deepEqual(gafferCatalogIntent("Do you have an FX3 camera to hire?"), { category: "Cameras", search: "fx3" });
  assert.deepEqual(gafferCatalogIntent("Do you have a Sony FX3 camera to hire?"), { category: "Cameras", search: "fx3" }, "Specific model beats the preceding brand");
  assert.deepEqual(gafferCatalogIntent("What lights do you rent?"), { category: "Lighting" });
  assert.equal(gafferCatalogIntent("My camera isn't working"), null, "A fault report does not trigger a catalogue lookup");
  assert.equal(gafferCatalogIntent("What is my refund status?"), null);
  put("listings", { _id: "listing", active: true, title: "Sony FX3 camera", category: "Cameras", slug: "sony-fx3", components: [{ inventoryUnitId: "unit", qty: 1 }], pricing: { daily: 48 }, gallery: ["https://images.example/sony-fx3.jpg"] });
  put("listings", { active: true, title: "Sony FX3 missing stock mapping", category: "Cameras", slug: "fx3-unmapped", stockMappingStatus: "pending", components: [{ inventoryUnitId: "unit", qty: 1 }], pricing: { daily: 1 } });
  put("listings", { active: true, title: "Sony FX3 unowned", category: "Cameras", slug: "fx3-unowned", inventoryFacts: { owned: false }, components: [{ inventoryUnitId: "unit", qty: 1 }] });
  put("listings", { active: true, title: "Sony FX3 display", category: "Cameras", slug: "fx3-display", suppressed: true, components: [{ inventoryUnitId: "unit", qty: 1 }] });
  put("listings", { active: false, title: "Sony FX3 inactive", category: "Cameras", slug: "fx3-inactive", components: [{ inventoryUnitId: "unit", qty: 1 }] });
  put("listings", { active: true, title: "Sony FX3 without components", category: "Cameras", slug: "fx3-unmapped-components", components: [] });
  const result = await lookup.handler({ db }, { category: "Cameras", search: "fx3" });
  assert.deepEqual(result, { listings: [{ listingId: "listing", title: "Sony FX3 camera", slug: "sony-fx3", category: "Cameras", daily: 48, pricing: { daily: 48 }, heroImage: "https://images.example/sony-fx3.jpg", imageSources: ["https://images.example/sony-fx3.jpg"] }], availability: "unchecked" });
  const categoryResult = await lookup.handler({ db }, { category: "Cameras" });
  assert.equal(categoryResult.listings.length, 1, "Category browsing excludes non-rentable rows");
  assert.equal((await lookup.handler({ db }, { search: "nonexistent" })).listings.length, 0);
  const start = Date.UTC(2030, 0, 1);
  const facts = { escalated: false, latestRenterId: "message", gafferGeneration: 0, messages: [{ sender: "renter", text: "Do you have an FX3 camera to hire?" }], booking: { summary: "Sony FX3", dates: "2030-01-01 → 2030-01-01", status: "confirmed", fulfilment: "pickup", pickupTime: "09:00", returnTime: "17:00", verification: { status: "verified" } }, catalogueWindow: { start, end: start, pickupTime: "09:00", returnTime: "17:00" }, accountRentals: [], accountCredit: {}, checkoutUi: {}, hours: "09:00–22:00", location: null };
  const calls = [];
  const ctx = { runQuery: async (ref, args) => { calls.push({ ref, args }); if (ref === "chat._gafferContext") return facts; if (ref === "gafferCatalogue.lookup") return result; if (args?.listingId === "listing") return { available: 1, owned: 1 }; throw Error("Unexpected query"); }, runMutation: async (ref, args) => { calls.push({ ref, args }); return true; }, scheduler: { runAfter: async () => {} } };
  const oldKey = process.env.OPENROUTER_API_KEY;
  const previousPolicy = Object.fromEntries(["SETUP_INTENT_SECURITY_POLICY_ENABLED", "CARD_HOLD_SECURITY_POLICY_ENABLED", "ASSESSMENT_SECURITY_POLICY_ENABLED", "REFUNDABLE_DEPOSIT_POLICY_ENABLED"].map(key => [key, process.env[key]]));
  process.env.OPENROUTER_API_KEY = "synthetic";
  process.env.SETUP_INTENT_SECURITY_POLICY_ENABLED = "true";
  delete process.env.CARD_HOLD_SECURITY_POLICY_ENABLED;
  delete process.env.ASSESSMENT_SECURITY_POLICY_ENABLED;
  delete process.env.REFUNDABLE_DEPOSIT_POLICY_ENABLED;
  try { await gafferReply.handler(ctx, { accountId: "account", messageId: "message" }); } finally {
    if (oldKey === undefined) delete process.env.OPENROUTER_API_KEY; else process.env.OPENROUTER_API_KEY = oldKey;
    for (const [key, value] of Object.entries(previousPolicy)) if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }
  assert(calls.some(call => call.ref === "gafferCatalogue.lookup" && call.args.search === "fx3"));
  assert(calls.some(call => call.args?.listingId === "listing" && call.args.start === start && call.args.pickupTime === "09:00"), "Gaffer checks real inventory against the selected rental window");
  assert.match(modelOptions.system, /Sony FX3 camera/);
  assert.match(modelOptions.system, /\"availability\":\"available\"/);
  assert.match(modelOptions.system, /empty or failed lookup does not prove an item is not stocked/i);
  assert.match(modelOptions.system, /CURRENT GENERAL CUSTOMER FAQ FACTS/);
  assert.match(modelOptions.system, /no upfront deposit and reserve no card funds/i);
  assert.match(modelOptions.system, /Pickups and returns: 09:00–22:00/);
  assert.match(modelOptions.system, /recorded status and signed policy facts below take precedence/i);
  const posted = calls.find(call => call.ref === "chat._postBot");
  assert(posted);
  assert.deepEqual(posted.args.meta.catalogueItems[0], { title: "Sony FX3 camera", slug: "sony-fx3", category: "Cameras", daily: 48, days: 1, perDay: 48, total: 48, availability: "available", dates: "2030-01-01 → 2030-01-01", heroImage: "https://images.example/sony-fx3.jpg", imageSources: ["https://images.example/sony-fx3.jpg"] });
  process.env.OPENROUTER_API_KEY = "synthetic";
  try { await gafferReply.handler({ ...ctx, runQuery: async ref => { if (ref === "chat._gafferContext") return facts; throw Error("Synthetic index failure"); } }, { accountId: "account", messageId: "message" }); }
  finally { if (oldKey === undefined) delete process.env.OPENROUTER_API_KEY; else process.env.OPENROUTER_API_KEY = oldKey; }
  assert.match(modelOptions.system, /"lookupUnavailable":true/);
  assert.match(modelOptions.system, /empty or failed lookup does not prove an item is not stocked/i);
  console.log("PASS rental Gaffer catalogue: indexed bounded examples, non-rentable exclusion, honest unknown availability and action wiring; synthetic data only.");
})().catch(error => { console.error(error); process.exitCode = 1; });
