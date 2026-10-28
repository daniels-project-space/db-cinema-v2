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
let intent, finalRace = false, stockFailure = false, finalReadFailures = 0, stockReads = 0, facts;
setMock("convex/browser", { ConvexHttpClient: class {
  async query(name, args) {
    if (name === "catalog.getListingBySlug") return listings.find(x => x.slug === args.slug) ?? null;
    if (name === "catalog.listListings") return listings;
    if (name === "catalog.byItemType") return listings.filter(x => args.types.includes(x.itemType));
    if (name === "catalog.listingsByIds") return listings.filter(x => args.ids.includes(x._id));
    if (name.startsWith("availability.")) {
      stockReads++;
      if (stockFailure) throw Error("Transient stock outage");
      if (["availability.forCart", "availability.forCheckoutTimeSlots"].includes(name) && finalReadFailures > 0) {
        finalReadFailures--;
        throw Error("Transient final stock outage");
      }
      if (["availability.forCart", "availability.forCheckoutTimeSlots"].includes(name) && finalRace) rode.quantityOwned = 0;
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
const { handleChat, unitsPerEnquiryOffer } = load("src/lib/gaffer.ts"), { formatGafferEmailReply } = load("src/lib/inboundEmail.ts"), { gafferEmailQuoteIntro } = load("shared/gafferEmailQuote.ts");
assert.equal(unitsPerEnquiryOffer({ title: "5x mics", itemType: "wireless-mic", inventoryFacts: { contents: ["1 × DJI Wireless Mics", "2x transmitter", "1x receiver"] } }, "wireless mic kits"), 1, "reviewed contents override inflated marketing-title counts");
const mixedLenses = { itemType: "lens", inventoryFacts: { contents: ["1 × Sony 24-70mm lens", "1 × Sony 70-200mm lens", "1 × Sony 35mm lens"] } };
assert.equal(unitsPerEnquiryOffer(mixedLenses, "lenses"), 3);
assert.equal(unitsPerEnquiryOffer(mixedLenses, "Sony 24-70mm"), 1, "different focal lengths cannot count as multiple copies of the requested lens");
assert.equal(unitsPerEnquiryOffer({ itemType: "lens", inventoryFacts: { contents: ["2 × Sony 24-70mm f/2.8 lens"] } }, "Sony 24-70mm f2.8"), 2, "model boundaries must preserve equivalent aperture notation");
const { equipmentOfferLabel } = load("shared/equipmentIdentity.ts");
assert.equal(equipmentOfferLabel("Sony FX 3 Cinema Camera Full Frame Mirrorless 4k Sony fx3 (same sensor as a7siii"), "Sony FX3 camera body");
assert.equal(equipmentOfferLabel("Sony FX3 with 24–70mm GM Lens and DJI RS3 Pro Gimbal"), "Sony FX3 with 24–70mm GM Lens and DJI RS3 Pro Gimbal", "shortening a label must retain actual package contents");
assert.equal(equipmentOfferLabel("Two Sony FX3 Bodies · Cards and Batteries"), "Two Sony FX3 Bodies · Cards and Batteries", "do not hide the advertised pack quantity");
const { rentalEnquiryWindow } = load("src/lib/rentalEnquiryWindow.ts");
const windowFor = (...texts) => rentalEnquiryWindow(texts.map(content => ({ role: "user", content })), "2026-10-28");
const actualEmail = "4 complete kits for 20 November 2026, pickup at 10am, returning 23 November 2026 at 10am";
const overnightEmail = "Please quote 1 Sony FX3 camera body, pickup 20 November 2026 at 5pm and return 21 November 2026 at 9am. Please use a single-camera offer if available and show the day rate and multi-day rate thresholds.";
for (const connector of ["until", "to", "through", "till"]) {
  const explicit = windowFor(`Please quote one Sony FX3 camera from 9 November 2026 at 10:00 ${connector} 10 November 2026 at 09:00. Gear hire only, exclude deposits and refundable money. Where do I collect?`);
  assert.equal(explicit.start, "2026-11-09"); assert.equal(explicit.end, "2026-11-10");
  assert.equal(explicit.pickupTime, "10:00"); assert.equal(explicit.returnTime, "09:00", `${connector} must preserve both explicitly dated clocks`);
}
const actualWindow = windowFor(actualEmail);
assert.equal(actualWindow.start, "2026-11-20"); assert.equal(actualWindow.end, "2026-11-23");
assert.equal(actualWindow.pickupTime, "10:00"); assert.equal(actualWindow.returnTime, "10:00");
assert.equal(windowFor("20–23 November 2026, pickup 10am and return 6pm").returnTime, "18:00");
assert.equal(windowFor("20/11/2026 to 23/11/2026, pickup 10:00 and return 17:00").end, "2026-11-23");
assert.equal(windowFor("Tomorrow, pickup at 9pm").start, "2026-10-29");
assert.equal(windowFor("Tomorrow, pickup at 9pm").pickupTime, "21:00");
assert.equal(windowFor("Tomorrow, pickup at 9").pickupTime, undefined, "ambiguous bare clock cannot become 9am");
assert.equal(windowFor(actualEmail, "Actually return at 9pm").returnTime, "21:00");
assert.equal(windowFor("20-23 November, return at 6pm and pickup at 10am").pickupTime, "10:00");
assert.equal(windowFor("20-23 November, return at 6pm and pickup at 10am").returnTime, "18:00");
assert.equal(windowFor("for 3 days from 20 November 2026, pickup 10am and return 10am").end, "2026-11-23");
assert.equal(windowFor("4x DJI Mic 2 kits").start, undefined, "product generation and quantity cannot become dates");
assert.equal(windowFor(overnightEmail).start, "2026-11-20");
assert.equal(windowFor(overnightEmail).end, "2026-11-21", "day-rate wording cannot become an extra date");
assert.equal(windowFor(overnightEmail).pickupTime, "17:00");
assert.equal(windowFor(overnightEmail).returnTime, "09:00");
assert.equal(windowFor("20-21 November 2026 or 24-26 November 2026").ambiguous, true);
async function run(quantity = 4, extra = {}, explicitText, channel = "email") {
  rode.quantityOwned = 2; djiOne.quantityOwned = 1; djiTwo.quantityOwned = 1; stockReads = 0;
  intent = { intent: "availability", subject: "Rode Mic Pro", itemTypes: ["wireless-mic"], cameraModel: "", pricePref: "any", start: "2030-11-20", end: "2030-11-23", pickupTime: "10:00", returnTime: "10:00", requests: [{ subject: "Rode Mic Pro", itemType: "wireless-mic", quantity }], ...extra };
  const period = intent.start ? `From ${intent.start}${intent.end ? ` to ${intent.end}` : ""}.` : "";
  const clocks = `${intent.pickupTime ? ` Pickup at ${intent.pickupTime}.` : ""}${intent.returnTime ? ` Return at ${intent.returnTime}.` : ""}`;
  const result = await handleChat({ messages: [{ role: "user", content: explicitText ?? `${quantity} mic kits please, alternatives welcome. ${period}${clocks}` }], channel });
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
  assert(result.email.includes("alternative to Rode Mic Pro; please confirm"));
  assert(result.email.includes("Gear hire total: £195.00"));
  assert.equal((result.email.match(/Rode Mic Pro Kit/g) || []).length, 1, "the proposed item must appear once, not repeat as an equipment-options section");
  assert(!result.email.includes("Multi-day rates per unit"), "do not append an irrelevant full rate ladder to every quote");
  assert(result.email.endsWith("DB Cinema Rentals team"));
  assert(result.email.includes("[Rode Mic Pro Kit](https://dbcinemarentals.com/gear/"), "equipment links should have readable labels");
  assert(facts.includes("RENTAL ENQUIRY EVIDENCE:"));
  a.title = "RØDE Mic Pro Kit"; duplicate.inventoryFacts.owned = false;
  result = await run(1, { requests: [{ subject: "Rode Mic Pro", itemType: "wireless-mic", quantity: 1, allowAlternatives: false }] });
  assert.equal(result.enquiry.requests[0].lines[0].listingId, a._id, "RØDE and Rode must resolve to the same exact model");
  a.title = "Rode Mic Pro Kit"; duplicate.inventoryFacts.owned = true;
  result = await run(1, { start: "2026-11-20", end: "2026-11-20", pickupTime: undefined, returnTime: undefined }, actualEmail);
  assert.equal(result.enquiry.end, "2026-11-23", "explicit email dates survive a model that drops the end date");
  assert.equal(result.enquiry.days, 3);
  assert.equal(result.enquiry.timed, true, "explicit times survive model omission");
  result = await run(5);
  assert.equal(result.enquiry.complete, false);
  assert.equal(result.enquiry.requests[0].fulfilled, 4);
  assert.equal(result.enquiry.total, 195);
  assert(result.email.includes("4 of 5 requested Rode Mic Pro"));
  assert(result.email.includes("Gear hire for the confirmed items: £195.00"));
  result = await run(1, { start: "2030-11-20", end: "2030-11-21", pickupTime: "17:00", returnTime: "09:00" });
  assert.equal(result.enquiry.days, 1, "overnight rentals under 24h use one daily charge");
  assert.equal(result.enquiry.total, 24);
  result = await run(2, { pickupTime: undefined, returnTime: undefined }, "Please quote 2 mic kits from 20 November 2030 to 23 November 2030.");
  assert.equal(result.enquiry.timed, false);
  assert.equal(result.enquiry.requests[0].fulfilled, 2);
  assert.equal(result.enquiry.stockVerified, true, "a date-only request checks for one common available pickup/return window");
  assert.equal(result.enquiry.complete, true);
  assert(result.enquiry.availabilityWindow?.suggested);
  assert(stockReads > 0, "a real date must trigger live availability checks even when times are omitted");
  assert(result.email.includes("suggested"));
  assert(result.reply.includes("suggested"), "the chat and phone quote intro states the concrete stock window");
  result = await run(1, {
    start: "2030-11-20", end: "2030-11-20", pickupTime: undefined, returnTime: undefined,
    requests: [{ subject: "Sony FX3 camera body", itemType: "camera", quantity: 1 }],
  }, "Please quote one Sony FX3 camera body for 20 November 2030.");
  assert.equal(result.enquiry.requests[0].fulfilled, 1, "a date-only FX3 request checks the full body quantity");
  assert.equal(result.enquiry.requests[0].lines[0].listingId, cameraListing._id, "date-only quotes keep a body-only request on the exact FX3 body");
  assert.equal(result.enquiry.complete, true);
  assert(result.email.includes("1 of 1 requested Sony FX3 camera body"));
  assert(!result.email.includes("Sony FX3 with lens and DJI RS3 Pro Gimbal"));
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
  const unwantedBundle = listing("Sony FX3 with lens and DJI RS3 Pro Gimbal", camera, 10, 8, "camera-body");
  unwantedBundle.specs = { includesLens: true };
  listings.push(unwantedBundle);
  result = await run(1, { requests: [{ subject: "FX 3", itemType: "camera", quantity: 1 }] });
  assert.equal(result.enquiry.requests[0].lines[0].listingId, cameraListing._id, "an exact camera-only request must prefer the body even if a lens/gimbal package is cheaper");
  listings.splice(listings.indexOf(unwantedBundle), 1);
  const pair = listing("Two Sony FX3 Bodies", camera, 90, 75, "camera-body");
  pair.components[0].qty = 2; pair.inventoryFacts.contents = ["2 × Sony FX3", "2 × Lexar CFexpress cards"];
  listings.push(pair);
  result = await run(1, { requests: [{ subject: "Sony FX 3 camera body", itemType: "camera", quantity: 1 }] });
  assert.equal(result.enquiry.requests[0].lines[0].listingId, cameraListing._id, "one body should prefer a single-body offer over a two-camera package");
  result = await run(2, { requests: [{ subject: "Sony FX3 camera bodies", itemType: "camera", quantity: 2 }] });
  assert.equal(result.enquiry.complete, true);
  assert.equal(result.enquiry.requests[0].lines[0].listingId, pair._id);
  assert.equal(result.enquiry.requests[0].lines[0].quantity, 1, "one advertised package contains two verified camera bodies");
  assert.equal(result.enquiry.requests[0].lines[0].providedUnits, 2);
  assert.equal(result.enquiry.total, 225, "the quote prices one whole package, not two packages");
  const fx30 = listing("Sony FX30 Body", unit("FX30 pool", 2), 20, 15, "camera-body");
  listings.push(fx30);
  result = await run(1, { requests: [{ subject: "Sony FX 3 camera body", itemType: "camera", quantity: 1 }] }, overnightEmail);
  assert.equal(result.enquiry.days, 1, "the exact production overnight enquiry must bill one day");
  assert.equal(result.enquiry.requests[0].lines[0].listingId, cameraListing._id, "FX3 cannot exactly match FX30 even when FX30 is cheaper");
  assert.equal(result.enquiry.total, 60);
  result = await run(1, { requests: [{ subject: "Sony fx 3 camera body", itemType: "camera", quantity: 1 }] }, overnightEmail);
  assert.equal(result.enquiry.requests[0].lines[0].listingId, cameraListing._id, "spaced FX 3 names preserve the same model boundary");
  for (const itemType of ["lens", "light", "tripod", "gimbal", "monitor", "nd-filter", "battery", "slider", "drone", "accessory", "recorder", "speaker", "dj-deck", "mixer", "headphones", "projector", "boom-mic"]) {
    const equipment = listing(`Zephyr ${itemType}`, unit(`Pool ${itemType}`, 2), 25, 20, itemType);
    listings.push(equipment);
    result = await run(2, { requests: [{ subject: equipment.title, itemType, quantity: 2 }] });
    assert.equal(result.enquiry.complete, true, `${itemType} quantities must use the same physical-stock checks`);
    assert.equal(result.enquiry.total, 120, `${itemType} must use the actual 3-day rate`);
  }
  result = await run(4, { requests: [{ subject: "wireless microphone kits", itemType: "wireless-mic", quantity: 4 }] });
  assert.equal(result.enquiry.complete, true, "all four distinct owned microphone kits must satisfy a generic four-kit request");
  assert.equal(result.enquiry.requests[0].fulfilled, 4);
  assert.equal(result.enquiry.total, 195, "the complete mixed-brand basket uses each listing's actual three-day rate");
  assert(result.email.includes("I can confirm 4 of 4 requested wireless microphone kits"));
  assert(result.enquiry.requests[0].lines.some(line => line.title === "DJI Mic 1 Set"));
  assert(result.enquiry.requests[0].lines.some(line => line.title === "DJI Mic 2 Set"));
  result = await run(4, { pickupTime: undefined, returnTime: undefined, requests: [{ subject: "wireless microphone kits", itemType: "wireless-mic", quantity: 4 }] }, "Please quote four wireless microphone kits for 20 November 2030.", "chat");
  assert.equal(result.enquiry.complete, true, "Gaffer chat quotes must also verify date-only quantities against one shared time window");
  assert.equal(result.enquiry.availabilityWindow.suggested, true);
  assert(result.reply.includes(`suggested ${result.enquiry.availabilityWindow.pickupTime} pickup and ${result.enquiry.availabilityWindow.returnTime} return`));
  finalReadFailures = 1;
  result = await run(4, { pickupTime: undefined, returnTime: undefined, requests: [{ subject: "wireless microphone kits", itemType: "wireless-mic", quantity: 4 }] }, "Please quote four wireless microphone kits for 20 November 2030.", "chat");
  assert.equal(finalReadFailures, 0, "one transient failure in the authoritative shared-window check is retried");
  assert.equal(result.enquiry.complete, true, "a successful retry confirms the exact mixed-brand quantity");
  assert.equal(result.enquiry.requests[0].fulfilled, 4);
  finalRace = true;
  result = await run();
  assert.equal(result.enquiry.stockVerified, false, "the final combined snapshot catches a booking arriving during planning");
  assert.equal(result.enquiry.total, null);
  assert.equal(result.enquiry.requests[0].fulfilled, 2, "the final check keeps the two alternative kits that still pass");
  assert(result.enquiry.requests[0].lines.every(x => x.listingId !== a._id), "the raced-out Rode set is removed from the confirmed proposal");
  assert(result.cards.some(x => x.item.listingId === a._id && x.item.available === null));
  assert(result.email.includes("final basket check"));
  assert(result.email.includes("2 of 4 requested Rode Mic Pro"), "the final check's exact surviving quantity must be stated");
  assert(!result.email.includes("Full requested quantity covered"));
  finalRace = false; stockFailure = true;
  result = await run(1);
  assert.equal(result.enquiry.complete, false, "stock outages must still produce an honest email reply");
  assert.equal(result.enquiry.total, null);
  assert(result.cards.every(x => x.item.available === null));
  assert(result.email.includes("live stock check"));
  const mixedReply = formatGafferEmailReply("", [], {
    start: "2030-11-20", end: "2030-11-20", pickupTime: "10:00", returnTime: "18:00", estimated: false, timed: true,
    days: 1, stockVerified: true, requirementsComplete: true, complete: false, total: 47,
    requests: [
      { subject: "FX3", quantity: 1, fulfilled: 1, lines: [{ listingId: "camera", title: "Sony FX3 Body", slug: "sony-fx3-body", quantity: 1, total: 47 }] },
      { subject: "Rode Wireless Mic Pro set", quantity: 1, fulfilled: null, availabilityIssue: "stock_check_failed", lines: [] },
    ],
  });
  assert(mixedReply.includes("I can confirm 1 of 1 requested FX3"), "email must preserve the verified camera quantity");
  assert(mixedReply.includes("live stock check failed for Rode Wireless Mic Pro"), "email must name the item whose stock check failed");
  assert(mixedReply.includes("Gear hire for the confirmed items: £47"), "partial verified quotes must price only confirmed gear");
  const unresolved = gafferEmailQuoteIntro({
    start: "2030-11-20", end: "2030-11-20", estimated: false, timed: true, stockVerified: false,
    requirementsComplete: true, complete: false, total: null, availabilityIssue: "stock_check_failed",
    requests: [
      { subject: "DJI Mic 1 set", quantity: 1, fulfilled: null, lines: [] },
      { subject: "Rode Wireless Mic Pro kits", quantity: 2, fulfilled: null, lines: [] },
    ],
  });
  assert(unresolved.includes("1 requested DJI Mic 1 set"), "failed stock responses must name the exact DJI quantity requested");
  assert(unresolved.includes("2 requested Rode Wireless Mic Pro kits"), "failed stock responses must name every requested item and quantity");
  assert(unresolved.includes("no quantity confirmed"), "a failed read must not claim the item is unavailable");
  assert(!unresolved.includes("full quantity"), "the broad full-quantity fallback must be removed");
  console.log("PASS Gaffer quotes: exact per-item confirmation and shortfalls, mixed-model fulfillment, transient final-read retry, 24-hour pricing and rate ladders, stock failures, final stock race. No live messages or reservations.");
})().catch(error => { console.error(error); process.exitCode = 1; });
