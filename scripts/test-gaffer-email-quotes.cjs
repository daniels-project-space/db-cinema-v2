const assert = require("node:assert/strict");
const { load, setMock, db, put } = require("./lib/rentalTestHarness.cjs");
for (const [alias, file] of Object.entries({
  "@/lib/pricing": "src/lib/pricing.ts", "@/lib/membership": "src/lib/membership.ts",
  "@/lib/dates": "src/lib/dates.ts", "@/lib/mount": "src/lib/mount.ts",
  "@/lib/compat": "src/lib/compat.ts", "@/lib/kitRank": "src/lib/kitRank.ts", "@/lib/site": "src/lib/site.ts",
})) setMock(alias, load(file));
const availability = load("convex/availability.ts"), ctx = { db };
put("rmv2_sync_state", { key: "shared-stock-v1", status: "ok", cursor: JSON.stringify({ version: 2, turnaroundBufferMinutes: 60, checkedAt: Date.now() }) });
const unit = (name, quantityOwned) => put("inventory_units", { name, quantityOwned, active: true });
const rode = unit("Rode pool", 2), djiOne = unit("DJI 1 pool", 1), djiTwo = unit("DJI 2 pool", 1), camera = unit("Camera pool", 2);
function listing(title, pool, daily, day3, itemType = "wireless-mic") {
  return put("listings", { title, slug: title.toLowerCase().replace(/\W+/g, "-"), itemType, active: true, pricing: { daily, day3 }, components: [{ inventoryUnitId: pool._id, qty: 1 }], inventoryFacts: { owned: true, contents: [title] } });
}
const a = listing("Rode Mic Pro Kit", rode, 24, 20);
const duplicate = listing("Rode Mic Pro Kit alternative account", rode, 24, 20);
const b = listing("DJI Mic 1 Set", djiOne, 12, 10), c = listing("DJI Mic 2 Set", djiTwo, 18, 15);
const cameraListing = listing("Sony FX3 Body", camera, 60, 50, "camera-body");
const listings = [a, duplicate, b, c, cameraListing];
let intent, finalRace = false, stockFailure = false, stockReads = 0, facts;
setMock("convex/browser", { ConvexHttpClient: class {
  async query(name, args) {
    if (name === "catalog.getListingBySlug") return listings.find(x => x.slug === args.slug) ?? null;
    if (name === "catalog.listListings") return listings;
    if (name === "catalog.byItemType") return listings.filter(x => args.types.includes(x.itemType));
    if (name === "catalog.listingsByIds") return listings.filter(x => args.ids.includes(x._id));
    if (name.startsWith("availability.")) {
      stockReads++;
      if (stockFailure) throw Error("Transient stock outage");
      if (name === "availability.forCart" && finalRace) rode.quantityOwned = 0;
      return availability[name.slice("availability.".length)].handler(ctx, args);
    }
    throw Error(`Unexpected query ${name}`);
  }
} });
setMock("@/lib/ai", { generateBotObject: async ({ prompt }) => {
  if (prompt.startsWith("You parse")) return intent;
  facts = prompt;
  return { reply: "Here is the checked proposal.", suggestions: [], humanRequested: false };
} });
process.env.OPENROUTER_API_KEY = "isolated-no-provider-calls";
const { handleChat } = load("src/lib/gaffer.ts"), { formatGafferEmailReply } = load("src/lib/inboundEmail.ts");
async function run(quantity = 4, extra = {}) {
  rode.quantityOwned = 2; djiOne.quantityOwned = 1; djiTwo.quantityOwned = 1; stockReads = 0;
  intent = { intent: "availability", subject: "Rode Mic Pro", itemTypes: ["wireless-mic"], cameraModel: "", pricePref: "any", start: "2030-11-20", end: "2030-11-23", pickupTime: "10:00", returnTime: "10:00", requests: [{ subject: "Rode Mic Pro", itemType: "wireless-mic", quantity }], ...extra };
  const result = await handleChat({ messages: [{ role: "user", content: `${quantity} mic kits please, alternatives welcome` }], channel: "email" });
  return { ...result, email: formatGafferEmailReply(result.reply, result.cards, result.enquiry) };
}
(async () => {
  let result = await run();
  assert.equal(result.enquiry.days, 3, "72 hours is three days, not four inclusive calendar dates");
  assert.equal(result.enquiry.complete, true);
  assert.equal(result.enquiry.total, 195, "3-day rates × billed days × allocated quantities");
  const lines = result.enquiry.requests[0].lines;
  assert.equal(lines.find(x => x.listingId === a._id).quantity, 2);
  assert(!lines.some(x => x.listingId === duplicate._id), "another account's advert cannot duplicate the physical Rode pool");
  assert.equal(lines.filter(x => x.alternative).reduce((sum, x) => sum + x.quantity, 0), 2);
  assert(result.email.includes("PROPOSED ALTERNATIVE"));
  assert(result.email.includes("Gear-hire total: £195.00"));
  assert(result.email.includes("Multi-day rates per unit: 1+ days £24.00/day · 3+ days £20.00/day"));
  assert(facts.includes("EMAIL ENQUIRY EVIDENCE:"));
  result = await run(5);
  assert.equal(result.enquiry.complete, false);
  assert.equal(result.enquiry.requests[0].fulfilled, 4);
  assert.equal(result.enquiry.total, 195);
  assert(result.email.includes("4 covered; 1 outstanding"));
  assert(result.email.includes("Total for the covered items only: £195.00"));
  result = await run(1, { start: "2030-11-20", end: "2030-11-21", pickupTime: "17:00", returnTime: "09:00" });
  assert.equal(result.enquiry.days, 1, "overnight rentals under 24h use one daily charge");
  assert.equal(result.enquiry.total, 24);
  result = await run(2, { pickupTime: undefined, returnTime: undefined });
  assert.equal(result.enquiry.timed, false);
  assert.equal(result.enquiry.requests[0].fulfilled, null);
  assert.equal(stockReads, 0, "missing times cannot trigger a confident stock claim");
  assert(result.email.includes("date-only estimate"));
  result = await run(2, { requests: [{ subject: "Sony FX3", itemType: "camera", quantity: 2 }, { subject: "DJI Mic 1", itemType: "wireless-mic", quantity: 2 }] });
  assert.equal(result.enquiry.requests.length, 2, "all distinct requirements survive into the proposal");
  assert.equal(result.enquiry.complete, true);
  assert.equal(result.enquiry.requests[0].fulfilled, 2, "quantities work for camera bodies too");
  const micRequest = result.enquiry.requests[1];
  assert.equal(micRequest.lines.find(x => !x.alternative).listingId, b._id, "DJI Mic 1 must not be silently replaced by another generation");
  assert(micRequest.lines.filter(x => x.listingId !== b._id).every(x => x.alternative));
  result = await run(4, { requests: [{ subject: "Rode Mic Pro", itemType: "wireless-mic", quantity: 4, allowAlternatives: false }] });
  assert.equal(result.enquiry.requests[0].fulfilled, 2, "exact-model-only requests cannot be silently substituted");
  assert(result.enquiry.requests[0].lines.every(x => !x.alternative));
  result = await run(4, { requests: [{ subject: "Rode Mic Pro", itemType: "wireless-mic", quantity: 4, quantityIsListingUnits: false }] });
  assert.equal(result.enquiry.requests[0].fulfilled, null, "individual microphones must not become complete-kit quantities");
  assert.equal(result.enquiry.complete, false);
  assert.equal(result.enquiry.total, null);
  assert(result.email.includes("individual components"));
  result = await run(4, { requirementsComplete: false });
  assert.equal(result.enquiry.complete, false, "an incomplete parse cannot claim the whole enquiry is covered");
  result = await run(1, { start: undefined, end: undefined });
  assert.equal(result.enquiry.days, result.cards[0].item.days, "example-window and item prices must use the same duration basis");
  for (const itemType of ["lens", "light", "tripod", "gimbal", "monitor", "nd-filter", "battery", "slider", "drone", "accessory", "recorder", "speaker", "dj-deck", "mixer", "headphones", "projector", "boom-mic"]) {
    const equipment = listing(`Zephyr ${itemType}`, unit(`Pool ${itemType}`, 2), 25, 20, itemType);
    listings.push(equipment);
    result = await run(2, { requests: [{ subject: equipment.title, itemType, quantity: 2 }] });
    assert.equal(result.enquiry.complete, true, `${itemType} quantities must use the same physical-stock checks`);
    assert.equal(result.enquiry.total, 120, `${itemType} must use the actual 3-day rate`);
  }
  finalRace = true;
  result = await run();
  assert.equal(result.enquiry.stockVerified, false, "the final combined snapshot catches a booking arriving during planning");
  assert.equal(result.enquiry.total, null);
  assert.equal(result.enquiry.requests[0].fulfilled, null);
  assert(result.cards.every(x => x.item.available !== true));
  assert(!result.email.includes("Full requested quantity covered"));
  finalRace = false; stockFailure = true;
  result = await run(1);
  assert.equal(result.enquiry.complete, false, "stock outages must still produce an honest email reply");
  assert.equal(result.enquiry.total, null);
  assert(result.cards.every(x => x.item.available === null));
  assert(result.email.includes("availability could not be confirmed"));
  assert(result.email.includes("£60.00 per unit for 3 billed days"), "a failed stock read must not distort the known period price");
  console.log("PASS Gaffer email quotes: real shared-stock handlers, mixed-model quantities, cross-account duplicate pools, partial fulfillment, exact 24h pricing and rate ladders, date-only uncertainty, multiple item types, final stock race. No live messages or reservations.");
})().catch(error => { console.error(error); process.exitCode = 1; });
