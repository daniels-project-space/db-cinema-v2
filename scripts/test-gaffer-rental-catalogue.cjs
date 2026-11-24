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
  let memberAccount = null;
  const ctx = { runQuery: async (ref, args) => { calls.push({ ref, args }); if (ref === "chat._gafferContext") return facts; if (ref === "chat._gafferRentalBenefitAccount") return memberAccount; if (ref === "gafferCatalogue.lookup") return result; if (args?.listingId === "listing") return { available: 1, owned: 1 }; throw Error("Unexpected query"); }, runMutation: async (ref, args) => { calls.push({ ref, args }); return true; }, scheduler: { runAfter: async () => {} } };
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
  assert.match(modelOptions.system, /For "unchecked", if a total is supplied, you may give it as an indicative hire-rate quote/i);
  assert.match(modelOptions.system, /say stock could not be verified/i);
  assert.match(modelOptions.system, /CURRENT GENERAL CUSTOMER FAQ FACTS/);
  assert.match(modelOptions.system, /New rentals take no deposit or card hold/i);
  assert.match(modelOptions.system, /rises by £100 per extra £1,000 proportionally to the penny/i);
  assert.match(modelOptions.system, /Pickups and returns: 09:00–22:00/);
  assert.match(modelOptions.system, /recorded status and signed policy facts below take precedence/i);
  const posted = calls.find(call => call.ref === "chat._postBot");
  assert(posted);
  assert.deepEqual(posted.args.meta.catalogueItems[0], { title: "Sony FX3 camera", slug: "sony-fx3", category: "Cameras", daily: 48, days: 1, perDay: 48, equipmentTotal: 48, sameDayFee: 0, total: 48, availability: "available", dates: "2030-01-01 → 2030-01-01", heroImage: "https://images.example/sony-fx3.jpg", imageSources: ["https://images.example/sony-fx3.jpg"] });

  facts.messages = [{ sender: "renter", text: "Do you have an FX3 available on 5 January 2030?" }];
  calls.length = 0;
  process.env.OPENROUTER_API_KEY = "synthetic";
  await gafferReply.handler(ctx, { accountId: "account", messageId: "message" });
  const changedDatePost = calls.find(call => call.ref === "chat._postBot");
  assert(changedDatePost, JSON.stringify(calls.map(call => call.ref)));
  const changedDateCard = changedDatePost.args.meta?.catalogueItems?.[0];
  assert(changedDateCard, JSON.stringify(changedDatePost.args));
  assert.equal(changedDateCard.dates, "2030-01-05 → 2030-01-05", "an explicit customer date replaces the unrelated rental window");
  assert.equal(changedDateCard.availability, "times_required", "a different date never inherits pickup/return times from the existing rental");
  assert.equal(changedDateCard.total, undefined, "Gaffer does not quote a price against dates the customer did not select times for");
  assert(!calls.some(call => call.ref === "availability.forListing"), "Gaffer does not check stock against the wrong rental dates");

  facts.messages = [
    { sender: "renter", text: "Do you have an FX3 for 5 January 2030?" },
    { sender: "bot", text: "What pickup and return times would you like for that date?" },
    { sender: "renter", text: "Could you check the Sony FX3 for those dates, pickup at 10:00 and return at 17:00?" },
  ];
  calls.length = 0;
  process.env.OPENROUTER_API_KEY = "synthetic";
  await gafferReply.handler(ctx, { accountId: "account", messageId: "message" });
  const followUpStockCheck = calls.find(call => call.ref === "availability.forListing");
  assert(followUpStockCheck, "a multi-turn follow-up checks live stock after the renter supplies requested times");
  assert.equal(followUpStockCheck.args.start, Date.UTC(2030, 0, 5), "the follow-up retains the date asked for, not the booking date");
  assert.equal(followUpStockCheck.args.pickupTime, "10:00");
  assert.equal(followUpStockCheck.args.returnTime, "17:00");
  facts.messages = [{ sender: "renter", text: "Do you have an FX3 camera to hire?" }];

  memberAccount = { loyaltyEligible: true, loyaltyLevel: 3, loyaltyPercent: 10 };
  calls.length = 0;
  process.env.OPENROUTER_API_KEY = "synthetic";
  await gafferReply.handler(ctx, { accountId: "account", messageId: "message" });
  const unearnedEncore = calls.find(call => call.ref === "chat._postBot").args.meta.catalogueItems[0];
  assert.equal(unearnedEncore.memberTotal, undefined, "an Encore assignment without a clean completed rental does not discount chat quotes");

  memberAccount.firstCleanRentalCompletedAt = Date.now() - 86400000;
  calls.length = 0;
  await gafferReply.handler(ctx, { accountId: "account", messageId: "message" });
  const memberPosted = calls.find(call => call.ref === "chat._postBot");
  assert(memberPosted, JSON.stringify(calls.map(call => ({ ref: call.ref, hasMeta: !!call.args?.meta }))));
  const memberCard = memberPosted.args.meta.catalogueItems[0];
  assert.equal(memberCard.total, 48, "standard catalogue amount remains available for comparison");
  assert.equal(memberCard.memberTotal, 43.2, "signed-in renter chat shows the exact canonical Encore price");
  assert.equal(memberCard.memberSaving, 4.8);
  assert.match(modelOptions.system, /Use memberTotal for this signed-in renter and never stack another member discount/);
  assert(!modelOptions.system.includes('"loyaltyPercent":10'), "private entitlement inputs are not sent to the language model");
  assert(!calls.some(call => /reservation|checkout|payment/i.test(call.ref)), "a quote does not reserve stock or initiate payment");

  const realNow = Date.now;
  const today = Date.UTC(2030, 0, 1);
  try {
    Date.now = () => Date.UTC(2030, 0, 1, 8);
    facts.catalogueWindow = { start: today, end: today, pickupTime: "09:00", returnTime: "17:00" };
    calls.length = 0;
    await gafferReply.handler(ctx, { accountId: "account", messageId: "message" });
    const sameDayCard = calls.find(call => call.ref === "chat._postBot").args.meta.catalogueItems[0];
    assert.equal(sameDayCard.equipmentTotal, 48);
    assert.equal(sameDayCard.sameDayFee, 4.8, "Gaffer quotes the exact 10% same-day fee");
    assert.equal(sameDayCard.total, 52.8, "Gaffer includes the exact same-day fee");
    assert.equal(sameDayCard.memberEquipmentTotal, 43.2);
    assert.equal(sameDayCard.memberSameDayFee, 4.32, "the same-day fee is calculated after Encore");
    assert.equal(sameDayCard.memberTotal, 47.52);
    assert.equal(sameDayCard.memberSaving, 5.28, "member savings include the lower fee and never stack another member benefit");
    assert.match(modelOptions.system, /Explicitly disclose the same-day booking fee whenever sameDayFee is greater than zero/);

    facts.catalogueWindow = { start: today + 86400000, end: today + 86400000, pickupTime: "09:00", returnTime: "17:00" };
    calls.length = 0;
    await gafferReply.handler(ctx, { accountId: "account", messageId: "message" });
    const nextDayCard = calls.find(call => call.ref === "chat._postBot").args.meta.catalogueItems[0];
    assert.equal(nextDayCard.sameDayFee, 0, "tomorrow's pickup does not receive the same-day fee");
    assert.equal(nextDayCard.total, 48);
    assert.equal(nextDayCard.memberSameDayFee, 0);
    assert.equal(nextDayCard.memberTotal, 43.2);
  } finally {
    Date.now = realNow;
  }

  memberAccount = {
    membershipActive: true,
    membershipStatus: "active",
    membershipPaidThrough: Date.now() + 86400000,
    stripeSubscriptionId: "sub_eligible_fixture",
    membershipTier: "pro",
    firstCleanRentalCompletedAt: Date.now() - 86400000,
    loyaltyEligible: true,
    loyaltyLevel: 3,
    loyaltyPercent: 10,
  };
  facts.catalogueWindow = { start: Date.UTC(2030, 0, 4), end: Date.UTC(2030, 0, 6), pickupTime: "09:00", returnTime: "17:00" };
  calls.length = 0;
  await gafferReply.handler(ctx, { accountId: "account", messageId: "message" });
  const bestMemberCard = calls.find(call => call.ref === "chat._postBot").args.meta.catalogueItems[0];
  assert.equal(bestMemberCard.total, 130);
  assert.equal(bestMemberCard.memberSaving, 34, "the larger eligible Pro weekend benefit wins over Encore III against the corrected rental subtotal");
  assert.equal(bestMemberCard.memberTotal, 96, "chat applies one benefit, never stacks Pro weekend and Encore III");

  memberAccount = null;
  facts.catalogueWindow = { start, end: start, pickupTime: "09:00", returnTime: "17:00" };
  calls.length = 0;
  process.env.OPENROUTER_API_KEY = "synthetic";
  await gafferReply.handler(ctx, { accountId: "account", messageId: "message" });
  const standardCard = calls.find(call => call.ref === "chat._postBot").args.meta.catalogueItems[0];
  assert.equal(standardCard.total, 48);
  assert.equal(standardCard.memberTotal, undefined, "a missing/failed entitlement lookup never invents member pricing");

  process.env.OPENROUTER_API_KEY = "synthetic";
  for (const window of [
    { start, end: start, pickupTime: null, returnTime: null },
    { start, end: start, pickupTime: "not-a-time", returnTime: "17:00" },
  ]) {
    facts.catalogueWindow = window;
    calls.length = 0;
    await gafferReply.handler(ctx, { accountId: "account", messageId: "message" });
    assert(!calls.some(call => call.ref === "availability.forListing"), "availability is not queried without two valid exact clock times");
    const item = calls.find(call => call.ref === "chat._postBot").args.meta.catalogueItems[0];
    assert.equal(item.availability, "times_required");
    assert.equal(item.daily, 48, "the published day rate may still be shown without a quote window");
    assert(!Object.hasOwn(item, "days") && !Object.hasOwn(item, "perDay") && !Object.hasOwn(item, "total"), "no rental total is emitted until the exact time window is valid");
  }

  facts.catalogueWindow = { start, end: start, pickupTime: "23:00", returnTime: "17:00" };
  calls.length = 0;
  await gafferReply.handler(ctx, { accountId: "account", messageId: "message" });
  assert(!calls.some(call => call.ref === "availability.forListing"), "a syntactically valid but impossible pickup/return order does not reach stock lookup");
  const invalidOrderItem = calls.find(call => call.ref === "chat._postBot").args.meta.catalogueItems[0];
  assert.equal(invalidOrderItem.availability, "times_required");
  assert(!Object.hasOwn(invalidOrderItem, "total"), "an invalid rental window cannot produce a quoted total");

  facts.catalogueWindow = { start, end: start, pickupTime: "09:00", returnTime: "17:00" };
  calls.length = 0;
  process.env.OPENROUTER_API_KEY = "synthetic";
  try { await gafferReply.handler({ ...ctx, runQuery: async ref => { if (ref === "chat._gafferContext") return facts; throw Error("Synthetic index failure"); } }, { accountId: "account", messageId: "message" }); }
  finally { if (oldKey === undefined) delete process.env.OPENROUTER_API_KEY; else process.env.OPENROUTER_API_KEY = oldKey; }
  assert.match(modelOptions.system, /"lookupUnavailable":true/);
  assert.match(modelOptions.system, /empty or failed lookup does not prove an item is not stocked/i);
  facts.catalogueWindow = { start, end: start, pickupTime: "09:00", returnTime: "17:00" };
  calls.length = 0;
  const stockFailureCtx = {
    ...ctx,
    runQuery: async (ref, args) => {
      calls.push({ ref, args });
      if (ref === "chat._gafferContext") return facts;
      if (ref === "gafferCatalogue.lookup") return result;
      if (args?.listingId === "listing") throw Error("Synthetic availability index failure");
      throw Error("Unexpected query");
    },
  };
  process.env.OPENROUTER_API_KEY = "synthetic";
  try { await gafferReply.handler(stockFailureCtx, { accountId: "account", messageId: "message" }); }
  finally { if (oldKey === undefined) delete process.env.OPENROUTER_API_KEY; else process.env.OPENROUTER_API_KEY = oldKey; }
  const stockFailureItem = calls.find(call => call.ref === "chat._postBot").args.meta.catalogueItems[0];
  assert.equal(stockFailureItem.availability, "unchecked");
  assert.equal(stockFailureItem.total, 48, "Published rate can still produce a date-specific quote when only the stock check fails");
  assert.match(modelOptions.system, /"availability":"unchecked"/);
  assert.match(modelOptions.system, /\"total\":48/);
  assert.match(modelOptions.system, /stock could not be verified/i);
  console.log("PASS rental Gaffer catalogue: indexed bounded examples, non-rentable exclusion, honest unknown availability and action wiring; synthetic data only.");
})().catch(error => { console.error(error); process.exitCode = 1; });
