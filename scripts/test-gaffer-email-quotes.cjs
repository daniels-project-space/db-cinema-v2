const assert = require("node:assert/strict");
const { load, setMock, db, put } = require("./lib/rentalTestHarness.cjs");
const { LIVE_FX3_BODY_KIT, LIVE_REMUS_45 } = require("./lib/gafferLiveCatalogueFixtures.cjs");
const { explicitlyAllowsAlternatives, explicitlyRequestsOptionalAddOns, shouldSuggestOptionalAddOns, minimumRentalBasketLines } = load("shared/gafferEmailQuote.ts");
const { spokenRentalItem, spokenPackingReview } = load("src/lib/voiceQuoteFormatting.ts");
assert.equal(spokenRentalItem("wireless microphone kits", "4x RØDE Wireless PRO Transmitters with Two Receivers", 1, 2),
  "two wireless microphone kits from the RØDE Wireless PRO bundle", "spoken counts should describe the requested kits, not repeat the listing's transmitter count");
assert.equal(spokenPackingReview("DJI Mic 2 Wireless Kit with Two Transmitters", ["1 × DJI Mic 2 wireless", "2x transmitter", "1x receiver", "1x charging case"]),
  "DJI Mic 2 Wireless Kit with Two Transmitters includes two transmitters, one receiver, and one charging case. I can't yet confirm the other listed accessories.");
assert.equal(explicitlyAllowsAlternatives("I'm open to a body-only alternative."), true);
assert.equal(explicitlyAllowsAlternatives("I'm not open to alternatives."), false);
assert.equal(explicitlyAllowsAlternatives("Don't suggest alternatives."), false);
assert.equal(explicitlyRequestsOptionalAddOns("What else should I add to my camera kit?"), true);
assert.equal(explicitlyRequestsOptionalAddOns("Could you recommend an ND filter for this lens?"), true);
assert.equal(explicitlyRequestsOptionalAddOns("Please quote the FX3 camera body for Friday."), false);
assert.equal(explicitlyRequestsOptionalAddOns("Please quote the FX3 camera body only, no lens or accessories."), false);
assert.equal(shouldSuggestOptionalAddOns("Please quote an FX3 for a low-light interview."), true);
assert.equal(shouldSuggestOptionalAddOns("Please quote an FX3 body only for a low-light interview."), false);
assert.equal(shouldSuggestOptionalAddOns("Is the FX3 available on Friday?"), false);
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
const b = listing("DJI Mic Wireless Kit with 2x Lavalier Microphones", djiOne, 12, 10), c = listing("DJI Mic 2 Wireless Kit with Two Transmitters", djiTwo, 18, 15);
b.inventoryFacts.contents = [
  "1 × DJI Wireless Mics", "2x transmitter", "1x receiver", "1x charging case",
  "2x DJI Mic transmitters", "1x DJI Mic receiver", "1x DJI audio cable",
  "1x DJI Mic charging case", "1x DJI Mic carrying case", "2x DJI Lavalier microphones",
];
b.inventoryFacts.reviewRequired = false;
const cameraListing = listing("Sony FX3 Body", camera, 60, 50, "camera-body");
cameraListing.specs = { mount: "Sony E", coverage: "full-frame" };
const lens = listing("Sony FE 24-70mm GM Lens", unit("Sony E lens pool", 1), 18, 14, "lens");
lens.specs = { mount: "Sony E", focalLength: "24-70mm", filterThreadMm: 82 };
const filter = listing("82mm Variable ND Filter", unit("82mm filter pool", 1), 12, 9, "nd-filter");
filter.specs = { filterThreadMm: 82 };
const listings = [a, duplicate, b, c, cameraListing, lens, filter];
const remusLens = listing("Blazar Remus 45mm T2 1.5× PL Anamorphic Lens", unit("Remus 45mm pool", 1), 37, 32, "lens");
remusLens.specs = { mount: "PL", lensClass: "cine" };
const twoRodeSetOffer = listing("4x RØDE Wireless PRO Transmitters with Two Receivers", rode, 42, 36, "recorder");
twoRodeSetOffer.components[0].qty = 2;
twoRodeSetOffer.inventoryFacts = { owned: true, reviewRequired: false, contents: [
  "2 × Rode Wireless Mic Pro set", "4x transmitter", "2x receiver", "4x lavalier mic", "2x smart charge case",
] };
let intent, finalRace = false, stockFailure = false, finalReadFailures = 0, stockReads = 0, sharedRefreshes = 0, facts, additionalAnswerForTest = "", suggestionsForTest = [];
let minimumStockMode = "available", minimumCombinedConflict = false, stockQueries = [];
let recommendationAvailable = true, recommendationEligible = true, legacyCatalogMode = false;
const recommendationCalls = [];
setMock("convex/browser", { ConvexHttpClient: class {
  async action() { sharedRefreshes++; return { checkedAt: Date.now(), cached: true }; }
  async query(name, args) {
    if (name === "catalog.getListingBySlug") return listings.find(x => x.slug === args.slug) ?? null;
    if (name === "catalog.listListings") return listings.slice(0, args.limit ?? 500);
    if (name === "catalog.byItemType") {
      if (legacyCatalogMode) throw Error("BadConvexFunctionIdentifier");
      return listings.filter(x => args.types.includes(x.itemType));
    }
    if (name === "catalog.listingsByIds") return listings.filter(x => args.ids.includes(x._id));
    if (name === "liveRecommendations.options") {
      recommendationCalls.push(args);
      const group = args.groups[0];
      const recommended = group.types.includes("lens") ? lens : group.types.includes("nd-filter") ? filter : null;
      const options = recommendationAvailable && recommended ? [{
        _id: recommended._id, listingId: recommended._id, slug: recommended.slug, title: recommended.title, itemType: recommended.itemType,
        pricing: recommended.pricing, specs: recommended.specs, inventoryFacts: recommended.inventoryFacts,
        image: null, imageSources: [], available: true, automaticEligible: recommendationEligible,
      }] : [];
      return { groups: { [group.key]: { options, ready: true } } };
    }
    if (name.startsWith("availability.")) {
      stockReads++;
      stockQueries.push({ name, args });
      if (stockFailure) throw Error("Transient stock outage");
      if (["availability.forListing", "availability.forTimeSlots"].includes(name) && args.listingId === b._id && args.end > args.start) {
        if (minimumStockMode === "failure") throw Error("Minimum-period stock outage");
        if (minimumStockMode === "unavailable") return { available: 0 };
      }
      if (["availability.forCart", "availability.forCheckoutTimeSlots"].includes(name) && finalReadFailures > 0) {
        finalReadFailures--;
        throw Error("Transient final stock outage");
      }
      if (["availability.forCart", "availability.forCheckoutTimeSlots"].includes(name) && finalRace) rode.quantityOwned = 0;
      const result = await availability[name.slice("availability.".length)].handler(ctx, args);
      if (minimumCombinedConflict && name === "availability.forCart" && args.items.some(item => item.listingId === b._id && item.end > item.start)) {
        const other = args.items.find(item => item.listingId !== b._id) ?? args.items[0];
        result[other.listingId] = { ...result[other.listingId], ok: false };
      }
      return result;
    }
    throw Error(`Unexpected query ${name}`);
  }
} });
setMock("@/lib/ai", { generateBotObject: async ({ prompt }) => {
  if (prompt.startsWith("You parse")) return intent;
  facts = prompt;
  return { reply: "Here is the checked proposal.", suggestions: suggestionsForTest, humanRequested: false, additionalAnswer: additionalAnswerForTest };
} });
process.env.OPENROUTER_API_KEY = "isolated-no-provider-calls";
const { handleChat, unitsPerEnquiryOffer } = load("src/lib/gaffer.ts"), { formatGafferEmailReply, hasSpecificModelQuoteMismatch } = load("src/lib/inboundEmail.ts"), { gafferEmailQuoteIntro } = load("shared/gafferEmailQuote.ts");
assert.equal(unitsPerEnquiryOffer({ title: "5x mics", itemType: "wireless-mic", inventoryFacts: { contents: ["1 × DJI Wireless Mics", "2x transmitter", "1x receiver"] } }, "wireless mic kits"), 1, "reviewed contents override inflated marketing-title counts");
assert.equal(unitsPerEnquiryOffer(b, "wireless microphone kits"), 1, "transmitters, receivers, cables and carrying cases must not inflate a complete-kit count");
assert.equal(unitsPerEnquiryOffer({ itemType: "wireless-mic", inventoryFacts: { contents: ["2 × Rode Wireless Mic Pro set", "2x transmitter", "1x receiver", "2x lavalier mic", "1x smart charge case"] } }, "wireless microphone kits"), 2, "an explicitly reviewed pack of two complete sets still supplies two kits");
const mixedLenses = { itemType: "lens", inventoryFacts: { contents: ["1 × Sony 24-70mm lens", "1 × Sony 70-200mm lens", "1 × Sony 35mm lens"] } };
assert.equal(unitsPerEnquiryOffer(mixedLenses, "lenses"), 3);
assert.equal(unitsPerEnquiryOffer(mixedLenses, "Sony 24-70mm"), 1, "different focal lengths cannot count as multiple copies of the requested lens");
assert.equal(unitsPerEnquiryOffer({ itemType: "lens", inventoryFacts: { contents: ["2 × Sony 24-70mm f/2.8 lens"] } }, "Sony 24-70mm f2.8"), 2, "model boundaries must preserve equivalent aperture notation");
const { equipmentOfferLabel, equipmentRequestLabel, equipmentModelsMatch } = load("shared/equipmentIdentity.ts");
assert.equal(equipmentModelsMatch("FX 3", "Sony FX3 camera body"), true, "the shared identity matcher accepts spaced FX3 spelling");
assert.equal(equipmentModelsMatch("FX 3", "Sony FX6 camera body"), false, "the shared identity matcher rejects a different camera model");
assert.equal(equipmentModelsMatch("Sony a7 III", "Sony a7 IV camera body"), false, "the shared identity matcher rejects adjacent A7 generations");
assert.equal(equipmentOfferLabel("Sony FX 3 Cinema Camera Full Frame Mirrorless 4k Sony fx3 (same sensor as a7siii"), "Sony FX3 camera body");
assert.equal(equipmentRequestLabel("Sony FX3 camera body", "camera-body"), "Sony FX3 camera body", "a plain body listing may use a concise label");
assert.equal(equipmentRequestLabel("Sony FX3 Body Kit with Cage and 320GB Card", "camera-body"), "Sony FX3 Body Kit with Cage and 320GB Card", "offer labels must disclose the actual kit contents");
assert.equal(equipmentRequestLabel("Sony a7 III with 24-70mm Lens and Gimbal", "camera-body"), "Sony a7 III with 24-70mm Lens and Gimbal", "a quoted bundle must keep its lens and gimbal visible");
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
const confirmedDateWindow = rentalEnquiryWindow([
  { role: "assistant", content: "Just to confirm, do you mean collection on Saturday 14 November and return on Wednesday 18 November 2026? What morning times would you like?" },
  { role: "user", content: "Yes, collection on SAT 14th AM - Say 10-12 noon and return the kit Weds 18th AM - say 10-12 noon." },
], "2026-10-29");
assert.equal(confirmedDateWindow.start, "2026-11-14", "a clear confirmation inherits the single date range proposed in the previous assistant turn");
assert.equal(confirmedDateWindow.end, "2026-11-18", "repeated weekday/day pairs must not roll to the next weekday in the current month");
assert.equal(confirmedDateWindow.pickupTime, "10:00", "a stated pickup interval checks from its earliest time");
assert.equal(confirmedDateWindow.returnTime, "12:00", "a stated return interval checks through its latest time");
assert.deepEqual(confirmedDateWindow.pickupTimeWindow, { from: "10:00", to: "12:00" });
assert.deepEqual(confirmedDateWindow.returnTimeWindow, { from: "10:00", to: "12:00" });
const correctedDateWindow = rentalEnquiryWindow([
  { role: "assistant", content: "Do you mean collection Saturday 14 November and return Wednesday 18 November 2026?" },
  { role: "user", content: "Yes, actually 21 to 23 November 2026, pickup at 10am and return at noon." },
], "2026-10-29");
assert.equal(correctedDateWindow.start, "2026-11-21", "explicit new dates in a confirmation take precedence over the earlier proposal");
assert.equal(correctedDateWindow.end, "2026-11-23");
const exactTimesAfterWindow = rentalEnquiryWindow([
  { role: "user", content: "Collection 14 November 2026 at 10-12 noon and return 18 November 2026 at 10-12 noon." },
  { role: "user", content: "Actually, pickup at 11am and return at 11am." },
], "2026-10-29");
assert.equal(exactTimesAfterWindow.pickupTime, "11:00");
assert.equal(exactTimesAfterWindow.returnTime, "11:00");
assert.equal(exactTimesAfterWindow.pickupTimeWindow, undefined, "a later exact pickup time clears the older range");
assert.equal(exactTimesAfterWindow.returnTimeWindow, undefined, "a later exact return time clears the older range");
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
const timeWindowQuote = {
  start: "2026-11-14", end: "2026-11-18", pickupTime: "10:00", returnTime: "12:00",
  pickupTimeWindow: { from: "10:00", to: "12:00" }, returnTimeWindow: { from: "10:00", to: "12:00" },
  timeWindowPricingConservative: true, days: 5, estimated: false, timed: true, stockVerified: true,
  requirementsComplete: true, complete: true, total: 100,
  requests: [{ subject: "Sony FX3 camera body", quantity: 1, fulfilled: 1, lines: [{ listingId: "fx3", title: "Sony FX3 camera body", slug: "sony-fx3", quantity: 1, perDay: 20, total: 100, alternative: false }] }],
};
const timeWindowIntro = gafferEmailQuoteIntro(timeWindowQuote);
assert.match(timeWindowIntro, /across your requested time windows/);
assert.match(timeWindowIntro, /maximum gear hire cost across those time windows/);
const timeWindowEmail = formatGafferEmailReply("", [], timeWindowQuote);
assert.match(timeWindowEmail, /pickup between 10:00 and 12:00/);
assert.match(timeWindowEmail, /maximum hire cost/);
const configurationConflictEmail = formatGafferEmailReply("", [], {
  start: "2026-11-03", end: "2026-11-03", days: 1, estimated: false, timed: false,
  stockVerified: true, requirementsComplete: true, complete: false, total: null,
  requests: [{
    subject: "FX3 camera body only", displaySubject: "Sony FX3 camera body", quantity: 1,
    fulfilled: 0, availabilityIssue: "configuration_conflict", lines: [],
    configurationConflict: {
      title: "Sony FX3 Body with DJI RS3 Pro Gimbal", slug: "fx3-with-rs3",
      perDay: 55, total: 55, availableUnits: 1,
      verifiedContents: ["Sony FX3 camera body", "DJI RS3 Pro Gimbal"],
    },
  }],
});
assert.match(configurationConflictEmail, /different package configuration/i);
assert.match(configurationConflictEmail, /DJI RS3 Pro Gimbal/);
assert.match(configurationConflictEmail, /£55\.00/);
assert.match(configurationConflictEmail, /Would you accept this package\?/);
assert(!/couldn't find .*available/i.test(configurationConflictEmail), "a package conflict must not be reported as a stock denial");
async function run(quantity = 4, extra = {}, explicitText, channel = "email") {
  rode.quantityOwned = 2; djiOne.quantityOwned = 1; djiTwo.quantityOwned = 1; stockReads = 0; stockQueries = []; sharedRefreshes = 0;
  intent = { intent: "availability", subject: "Rode Mic Pro", itemTypes: ["wireless-mic"], cameraModel: "", pricePref: "any", start: "2030-11-20", end: "2030-11-23", pickupTime: "10:00", returnTime: "10:00", requests: [{ subject: "Rode Mic Pro", itemType: "wireless-mic", quantity }], ...extra };
  const period = intent.start ? `From ${intent.start}${intent.end ? ` to ${intent.end}` : ""}.` : "";
  const clocks = `${intent.pickupTime ? ` Pickup at ${intent.pickupTime}.` : ""}${intent.returnTime ? ` Return at ${intent.returnTime}.` : ""}`;
  const customerText = explicitText ?? `${quantity} mic kits please, alternatives welcome. ${period}${clocks}`;
  const result = await handleChat({ messages: [{ role: "user", content: customerText }], channel });
  return { ...result, sharedRefreshes, email: formatGafferEmailReply(result.reply, result.cards, result.enquiry, undefined, result.additionalAnswer, undefined, customerText) };
}
(async () => {
  let result = await run();
  assert.equal(result.sharedRefreshes, 1, "Gaffer refreshes the Rental Manager stock mirror once before quote stock reads");
  assert.equal(result.enquiry.days, 3, "72 hours is three days, not four inclusive calendar dates");
  assert.equal(result.enquiry.complete, true);
  assert.equal(result.enquiry.total, 195, "3-day rates × billed days × allocated quantities");
  const lines = result.enquiry.requests[0].lines;
  assert.equal(lines.find(x => x.listingId === a._id).quantity, 2);
  assert(!lines.some(x => x.listingId === duplicate._id), "another account's advert cannot duplicate the physical Rode pool");
  assert.equal(lines.filter(x => x.alternative).reduce((sum, x) => sum + x.quantity, 0), 2);
  assert(result.email.includes("(alternative; please confirm)"));
  assert(result.email.includes("Total for this option: £195.00"));
  assert.equal((result.email.match(/Rode Mic Pro Kit/g) || []).length, 1, "the proposed item must appear once, not repeat as an equipment-options section");
  assert(!result.email.includes("Multi-day rates per unit"), "do not append an irrelevant full rate ladder to every quote");
  assert(result.email.startsWith("Hi there,\n\n"), "email replies should start like a concise personal note");
  assert(result.email.endsWith("DB Cinema Rentals Team"));
  assert(!result.email.includes("deposit"), "the rental quote must stay focused on gear hire");
  assert(result.email.includes("[Rode Mic Pro Kit](https://dbcinemarentals.com/gear/"), "equipment links should have readable labels");
  assert(facts.includes("RENTAL ENQUIRY EVIDENCE:"));
  legacyCatalogMode = true;
  result = await run(1, {
    subject: "Sony FX3", itemTypes: ["camera-body"],
    requests: [{ subject: "Sony FX3", itemType: "camera-body", quantity: 1, allowAlternatives: false }],
  }, "Please quote the Sony FX3 camera body for 20-23 November 2030, pickup at 10am and return at 10am.");
  assert.equal(result.enquiry.complete, true, "the exact quote still works when production is on the older catalogue API");
  assert.equal(result.enquiry.requests[0].lines[0].listingId, cameraListing._id, "legacy fallback must keep the requested FX3 listing exact");
  listings.push(remusLens);
  result = await run(1, {
    subject: "Blazar Remus 45mm T2 1.5x PL anamorphic lens", itemTypes: ["lens"],
    start: "2026-11-20", end: "2026-11-20", pickupTime: "10:00", returnTime: "18:00",
    requests: [{ subject: "Blazar Remus 45mm T2 1.5x PL anamorphic lens", itemType: "lens", quantity: 1, allowAlternatives: false }],
  }, "Please quote the Blazar Remus 45mm T2 1.5x PL anamorphic lens for 20 November 2026, pickup at 10am and return at 6pm.");
  assert.equal(result.enquiry.complete, true, "the catalogue multiplication sign must match the typed 1.5x model notation");
  assert.equal(result.enquiry.requests[0].lines[0].listingId, remusLens._id, "the exact Remus focal length must not be replaced by another lens");
  listings.splice(listings.indexOf(remusLens), 1);
  intent = {
    intent: "availability",
    subject: "Sony a7 III, 24-70mm GM Lens and DJI RS3 Pro Gimbal",
    itemTypes: ["camera-body", "lens", "gimbal"],
    cameraModel: "Sony a7 III",
    pricePref: "any",
    requests: [{
      subject: "Sony a7 III, 24-70mm GM Lens and DJI RS3 Pro Gimbal",
      itemType: "camera-body",
      quantity: 1,
      quantityIsListingUnits: true,
      allowAlternatives: true,
    }],
    requirementsComplete: true,
  };
  const fx3Email = await handleChat({
    messages: [{ role: "user", content: "Please quote one FX 3 camera body only for 3 November 2026." }],
    channel: "email",
    emailSubject: "Sony FX3 on 3 November",
  });
  assert.match(fx3Email.reply, /^I can quote Sony FX3 camera body for 3 November 2026\./i, "date-only chat quotes the exact requested model without claiming unselected times are available");
  assert(fx3Email.reply.includes("A possible window is pickup at 09:00 and return at 22:00."));
  assert(!/available on 3 November|times are available/i.test(fx3Email.reply));
  assert(!/1 of 1 requested|confirmed.*confirmed/i.test(fx3Email.reply), "the chat quote does not repeat robotic quantity confirmations");
  const fx3EmailBody = formatGafferEmailReply(fx3Email.reply, fx3Email.cards, fx3Email.enquiry, undefined, fx3Email.additionalAnswer, undefined, "Please quote one FX 3 camera body only for 3 November 2026.");
  assert.equal(fx3Email.enquiry.requests[0].lines[0].listingId, cameraListing._id, "a mistaken A7/gimbal parse must be corrected to the exact FX3 request");
  assert.equal(fx3Email.enquiry.requests[0].lines[0].alternative, false, "substitutions are suppressed unless the email explicitly welcomes them");
  assert.equal(fx3Email.enquiry.requests[0].lines[0].perDay, 60);
  assert.equal(fx3Email.enquiry.total, 60);
  assert.equal(fx3Email.enquiry.requests[0].lines[0].displayTitle, "Sony FX3 camera body", "body-only requests get a short body label even when the real listing contains standard kit extras");
  assert(!/a7 iii|gimbal/i.test(fx3EmailBody), "a camera-only FX3 email must not upsell a different body or an unrequested gimbal");
  assert(fx3EmailBody.includes("[Sony FX3 camera body](https://dbcinemarentals.com/gear/"), "the final email must link the exact requested body label rather than the full bundle title");
  assert(!fx3EmailBody.includes("Sony FX3 Body Kit"), "the email must not reframe a body-only quote as a bundle upsell");
  assert.equal(fx3Email.enquiry.timed, false, "a date-only request must remain untimed until the customer chooses a window");
  assert.match(fx3EmailBody, /possible window is pickup at .* and return at .*; I’ll confirm availability once you tell me those times suit/i);
  assert(!/is available on 3 November/i.test(fx3EmailBody), "a system-suggested window must not be presented as the customer's confirmed availability");
  assert(fx3EmailBody.startsWith("Hi there,\n\n") && fx3EmailBody.endsWith("DB Cinema Rentals Team"), "the email reply stays personal and uses the agreed team sign-off");
  assert(!fx3EmailBody.includes("Multi-day rates per unit"), "the email stays focused instead of appending a rate ladder");
  const fx3Chat = await handleChat({
    messages: [{ role: "user", content: "Please quote one FX3 camera body only for 3 November 2026." }],
    channel: "chat",
  });
  assert.equal(fx3Chat.enquiry.requests[0].lines[0].listingId, cameraListing._id, "chat retains the exact requested FX3 listing");
  assert.match(fx3Chat.reply, /possible window for Sony FX3 camera body on 3 November 2026/i, "chat offers the same suggested date-only window as email");
  assert(!/available on 3 November|a7 iii|gimbal/i.test(fx3Chat.reply), "chat does not claim stock at unselected times or substitute a bundle");
  legacyCatalogMode = false;
  listings.push(twoRodeSetOffer);
  result = await run(4, {
    subject: "wireless microphone kits", itemTypes: ["wireless-mic"], start: "2026-11-20", end: "2026-11-20",
    pickupTime: "10:00", returnTime: "18:00",
    requests: [{ subject: "wireless microphone kits", itemType: "wireless-mic", quantity: 4, quantityIsListingUnits: true }],
  }, "Please quote 4 complete wireless microphone kits for 20 November 2026, pickup at 10am and return at 6pm.");
  const twoSetLine = result.enquiry.requests[0].lines.find(line => line.listingId === twoRodeSetOffer._id);
  assert(twoSetLine, "a verified two-kit Rode pack typed as a recorder still answers a wireless-mic request");
  assert.equal(twoSetLine.quantity, 1, "the customer rents one two-kit offer");
  assert.equal(twoSetLine.providedUnits, 2, "only its owner-reviewed complete-set count fulfills microphone demand");
  assert.equal(result.enquiry.requests[0].fulfilled, 4);
  assert(result.email.includes("supplies 2 × wireless microphone kits"), "the email makes a multi-kit pack's fulfilled count explicit");
  listings.splice(listings.indexOf(twoRodeSetOffer), 1);
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
  assert(result.email.includes("4 of the 5 requested Rode Mic Pro"));
  assert(result.email.includes("Total for this option: £195.00"));
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
  assert(result.email.includes("The date-only check covers 2 ×"));
  assert(result.email.includes("A possible window is pickup at"));
  assert(result.email.includes("Would that suit?"), "a suggested pickup window must be offered for the renter to accept, not described as a confirmed booking");
  assert(result.reply.includes(`A possible window is pickup at ${result.enquiry.availabilityWindow.pickupTime} and return at ${result.enquiry.availabilityWindow.returnTime}`), "the chat and phone quote intro states the date-only window without promising availability");
  result = await run(1, {
    start: "2030-11-20", end: "2030-11-20", pickupTime: undefined, returnTime: undefined,
    requests: [{ subject: "Sony FX3 camera body", itemType: "camera", quantity: 1 }],
  }, "Please quote one Sony FX3 camera body only for 20 November 2030.");
  assert.equal(result.enquiry.requests[0].fulfilled, 1, "a date-only FX3 request checks the full body quantity");
  assert.equal(result.enquiry.requests[0].lines[0].listingId, cameraListing._id, "date-only quotes keep a body-only request on the exact FX3 body");
  assert.equal(result.enquiry.complete, true);
  assert(result.email.includes("[Sony FX3 camera body](https://dbcinemarentals.com/gear/"));
  additionalAnswerForTest = "We're based in Trafalgar Square, and collection is available from our London studio.";
  const locationQuestion = "Please quote one Sony FX3 camera body for 20 November 2030. Where are you based? Also, can you recommend a compatible lens?";
  result = await run(1, {
    start: "2030-11-20", end: "2030-11-20", pickupTime: "10:00", returnTime: "18:00",
    requests: [{ subject: "Sony FX3 camera body", itemType: "camera", quantity: 1 }],
  }, locationQuestion, "email");
  assert(result.email.includes("We're based in Trafalgar Square"), "the actual email narration answer must reach the final formatted quote");
  assert.equal((result.email.match(/We're based in Trafalgar Square/g) || []).length, 1, "the extra answer should not be duplicated from the generated prose");
  assert(result.email.endsWith("DB Cinema Rentals Team"));
  const locationQuoteResult = result;
  const locationRecommendationCall = recommendationCalls.at(-1);
  additionalAnswerForTest = "";
  const noisySupplement = [
    "Equipment options and stock checked by Gaffer",
    "Your rental enquiry",
    "Indicative proposal: 1 × Sony FX3 Body Kit for 20 November 2030",
    "Multi-day rates per unit: £47 for one day, £44 for three days, £32 for seven days",
    "The full quantity is not yet confirmed.",
    "What pickup and return times would work?",
    "Review your basket and continue to checkout.",
  ].join("\n");
  additionalAnswerForTest = noisySupplement;
  const plainFx3Question = "Please quote one Sony FX3 camera body only for 20 November 2030, pickup at 10am and return at 6pm.";
  result = await run(1, {
    start: "2030-11-20", end: "2030-11-20", pickupTime: "10:00", returnTime: "18:00",
    requests: [{ subject: "Sony FX3 camera body", itemType: "camera", quantity: 1 }],
  }, plainFx3Question, "email");
  assert(!result.reply.includes("Indicative proposal"), "quote narration drops generated duplicate proposal sections when no separate question was asked");
  assert(!result.email.includes("Equipment options and stock checked"));
  assert(!result.email.includes("Multi-day rates per unit"));
  assert(!result.email.includes("full quantity is not yet confirmed"));
  assert(!result.email.includes("continue to checkout."), "quote boilerplate only comes from the grounded formatter");
  const noisyChatReply = await run(1, {
    start: "2030-11-20", end: "2030-11-20", pickupTime: "10:00", returnTime: "18:00",
    requests: [{ subject: "Sony FX3 camera body", itemType: "camera", quantity: 1 }],
  }, plainFx3Question, "chat");
  assert(!noisyChatReply.reply.includes("Indicative proposal"), "chat and email share the same supplemental quote filter");
  assert(!noisyChatReply.reply.includes("Multi-day rates per unit"));
  const boundaryFilteredEmail = formatGafferEmailReply(result.reply, result.cards, result.enquiry, undefined, `${noisySupplement}\nWe're based in Trafalgar Square.`, undefined, "Where are you based?");
  assert(boundaryFilteredEmail.includes("We're based in Trafalgar Square."), "the final email boundary preserves a concise independent answer");
  assert(!boundaryFilteredEmail.includes("Indicative proposal"), "the final email boundary filters quote-shaped model text even when a separate answer is allowed");
  assert(!boundaryFilteredEmail.includes("Multi-day rates per unit"));
  additionalAnswerForTest = "";
  assert.equal(locationQuoteResult.enquiry.recommendedAddOn?.listingId, lens._id, "a native-mount lens is suggested only after the requested body is stock-checked");
  assert.equal(locationQuoteResult.enquiry.recommendedAddOn?.total, 18, "the suggested lens uses the same 24-hour rental period price");
  assert.equal(locationQuoteResult.enquiry.recommendedAddOn?.includedInTotal, false);
  assert.equal(locationQuoteResult.enquiry.total, 60, "the optional lens is not folded into the requested gear total");
  assert(locationQuoteResult.email.includes("If useful"));
  assert(locationQuoteResult.email.includes("fits the camera's mount"), "a suggested lens explains its verified fit in one brief sentence");
  assert(locationQuoteResult.email.includes("isn't included above"));
  assert(locationQuoteResult.cards.some(card => card.item?.listingId === lens._id), "chat receives a clickable listing card for the optional lens");
  const lensCheck = locationRecommendationCall;
  assert.deepEqual(lensCheck.groups[0].types, ["lens", "battery", "gimbal"]);
  assert.equal(lensCheck.groups[0].pickupTime, locationQuoteResult.enquiry.availabilityWindow.pickupTime);
  assert.equal(lensCheck.groups[0].returnTime, locationQuoteResult.enquiry.availabilityWindow.returnTime);
  assert(lensCheck.basket.some(item => String(item.listingId) === String(cameraListing._id)), "recommendation stock is checked together with the exact camera basket");
  assert(lensCheck.basket.every(item => item.pickupTime === lensCheck.groups[0].pickupTime && item.returnTime === lensCheck.groups[0].returnTime), "date-only suggestions carry their verified times into the combined stock check");
  assert(!locationQuoteResult.email.includes("Other listed options"), "a successful exact quote should not be buried under unrelated catalogue choices");
  assert(!locationQuoteResult.email.includes("Sony FX3 with lens and DJI RS3 Pro Gimbal"));
  recommendationCalls.length = 0;
  result = await run(1, {
    start: "2030-11-20", end: "2030-11-20", pickupTime: "10:00", returnTime: "18:00",
    requests: [{ subject: "Sony FX3 camera body", itemType: "camera", quantity: 1 }],
  }, "Please quote one Sony FX3 camera body for a low-light interview on 20 November 2030, pickup at 10:00 and return at 18:00.", "email");
  assert.equal(result.enquiry.recommendedAddOn?.listingId, lens._id, "a clear interview context can receive one live-checked, compatible extra");
  assert.equal(result.enquiry.total, 60, "contextual upsells stay outside the requested gear total");
  assert(result.email.includes("If useful") && result.email.includes("isn't included above"), "the email labels the extra optional and prices it separately");
  assert.equal(recommendationCalls.length, 1, "a contextual quote checks only one relevant add-on group");
  recommendationCalls.length = 0;
  result = await run(1, {
    requests: [{ subject: "Sony FX3 camera body", itemType: "camera", quantity: 1 }],
  }, "Please quote one Sony FX3 camera body only, no lens or accessories, for 20 November 2030.");
  assert.equal(result.enquiry.recommendedAddOn, undefined, "an explicit body-only request suppresses optional add-ons");
  assert.equal(recommendationCalls.length, 0, "a body-only request should not run the add-on recommendation query");
  result = await run(1, {
    subject: "Sony a7 III, 24-70mm GM Lens and DJI RS3 Pro Gimbal",
    itemTypes: ["camera"],
    requests: [{ subject: "Sony a7 III, 24-70mm GM Lens and DJI RS3 Pro Gimbal", itemType: "camera", quantity: 1 }],
  }, "Please quote an FX 3 camera body only, no lens or gimbal, for 3 November 2026.");
  assert.equal(result.enquiry.start, "2026-11-03", "an exact FX3 request keeps the actual November 3 date");
  assert.equal(result.enquiry.end, "2026-11-03");
  assert.equal(result.enquiry.requests[0].lines.length, 1, "a parser's bundled a7 III substitution must be replaced by the customer's exact FX3 request");
  assert.equal(result.enquiry.requests[0].lines[0].listingId, cameraListing._id);
  assert.equal(result.enquiry.requests[0].lines[0].alternative, false);
  assert.equal(result.enquiry.recommendedAddOn, undefined);
  assert(!result.email.includes("a7 III"));
  assert(!result.email.includes("24-70"));
  assert(!result.email.includes("Gimbal"));
  assert(result.email.includes("Sony FX3 camera body"), "an abbreviated model request should be answered using the exact catalogue name");
  assert(!result.email.includes("× fx3"), "email text should not expose the parser's raw lowercase model token");
  assert(result.email.endsWith("DB Cinema Rentals Team"));
  result = await run(1, {
    subject: "Sony a7 III, 24-70mm GM Lens and DJI RS3 Pro Gimbal",
    itemTypes: ["camera"], start: "2026-11-03", end: "2026-11-03", pickupTime: "10:00", returnTime: "18:00",
    requests: [{ subject: "Sony a7 III, 24-70mm GM Lens and DJI RS3 Pro Gimbal", itemType: "camera", quantity: 1 }],
  }, "Please quote an FX 3 camera body only, no lens or gimbal, for 3 November 2026, pickup at 10am and return at 6pm.", "chat");
  assert.equal(result.enquiry.requests[0].lines[0].listingId, cameraListing._id, "chat must use the same exact-model fallback as email");
  assert.equal(result.enquiry.complete, true);
  assert.equal(result.enquiry.recommendedAddOn, undefined);
  assert(!result.cards.some(card => /a7 III|Gimbal|24-70/.test(card.item.title)));
  recommendationAvailable = false;
  result = await run(1, { requests: [{ subject: "Sony FX3 camera body", itemType: "camera", quantity: 1 }] },
    "Please quote one Sony FX3 camera body for 20 November 2030.");
  assert.equal(result.enquiry.recommendedAddOn, undefined, "an unavailable lens cannot be offered as an available add-on");
  recommendationAvailable = true;
  recommendationEligible = false;
  result = await run(1, { requests: [{ subject: "Sony FX3 camera body", itemType: "camera", quantity: 1 }] },
    "Please quote one Sony FX3 camera body for 20 November 2030.");
  assert.equal(result.enquiry.recommendedAddOn, undefined, "a lens that fails the automatic compatibility policy is not offered");
  recommendationEligible = true;
  result = await run(1, {
    subject: lens.title, itemTypes: ["lens"],
    requests: [{ subject: lens.title, itemType: "lens", quantity: 1 }],
  }, `Please quote one ${lens.title} for 20 November 2030. Can you recommend an ND filter?`);
  assert.equal(result.enquiry.requests[0].lines[0].listingId, lens._id);
  assert.equal(result.enquiry.recommendedAddOn?.listingId, filter._id, "a lens can receive an optional filter only when its thread size fits");
  assert.equal(result.enquiry.recommendedAddOn?.label, "compatible ND filter");
  assert.equal(result.enquiry.recommendedAddOn?.fitNote, "matches the lens's filter thread");
  assert(!result.email.includes("82mm Variable ND Filter: £"), "the filter is not folded into the requested lens quote");
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
  const a7GimbalBundle = listing("Sony a7 III, 24-70mm GM Lens and DJI RS3 Pro Gimbal", camera, 10, 8, "camera-body");
  listings.push(a7GimbalBundle);
  const a7BodyPool = unit("a7 III body pool", 1);
  const a7BodyAlternative = listing("Sony a7 III Camera Body", a7BodyPool, 30, 24, "camera-body");
  listings.push(a7BodyAlternative);
  const fx3AccessoryKitPool = unit("FX3 body kit with cage and media card", 1);
  const liveBodyQuote = listing(LIVE_FX3_BODY_KIT.title, fx3AccessoryKitPool, LIVE_FX3_BODY_KIT.pricing.daily, LIVE_FX3_BODY_KIT.pricing.day3, "camera-body");
  liveBodyQuote.slug = LIVE_FX3_BODY_KIT.slug;
  liveBodyQuote.pricing = { ...LIVE_FX3_BODY_KIT.pricing };
  liveBodyQuote.specs = { mount: "Sony E", coverage: "full-frame" };
  liveBodyQuote.inventoryFacts = {
    ...LIVE_FX3_BODY_KIT.inventoryFacts,
    contents: [...LIVE_FX3_BODY_KIT.inventoryFacts.contents],
    optionalContents: [...LIVE_FX3_BODY_KIT.inventoryFacts.optionalContents],
  };
  listings.push(liveBodyQuote);
  result = await run(1, {
    subject: "FX 3", itemTypes: ["camera"], start: "2026-11-03", end: "2026-11-03",
    pickupTime: undefined, returnTime: undefined,
    requests: [{ subject: a7GimbalBundle.title, itemType: "camera", quantity: 1, quantityIsListingUnits: true, allowAlternatives: true }],
  }, "Please quote one FX 3 camera body for 3 November 2026, camera only and no gimbal.");
  assert.equal(result.enquiry.requests.length, 1, "a parser's substituted model must not replace the customer's single named camera");
  assert.equal(result.enquiry.requests[0].subject, "FX 3");
  assert.equal(result.enquiry.requests[0].fulfilled, 1);
  assert.equal(result.enquiry.requests[0].lines[0].listingId, liveBodyQuote._id, "a body-only request may use the exact owned FX3 body kit when the renter has not excluded its documented cage and recording card");
  assert.equal(result.enquiry.requests[0].lines[0].alternative, false);
  assert(result.email.includes(`[${liveBodyQuote.title}](https://dbcinemarentals.com/gear/`), "a quote links using the actual FX3 listing title");
  assert(result.email.includes("Cage") && result.email.includes("320GB"), "the camera offer discloses its included cage and recording card");
  assert.equal(result.enquiry.complete, true, "a date-only FX3 request should confirm when a shared pickup/return window is available");
  assert.equal(result.enquiry.availabilityWindow?.suggested, true, "the reply should offer a real available pickup/return window");
  assert(result.email.includes(`A possible window is pickup at ${result.enquiry.availabilityWindow.pickupTime} and return at ${result.enquiry.availabilityWindow.returnTime}; I’ll confirm availability once you tell me those times suit.`));
  assert(!/is available on 3 November/i.test(result.email), "date-only emails must not say the customer's availability is confirmed before their times are chosen");
  assert(result.email.startsWith("Hi there,\n\n"), "the email reply opens like a short human business reply");
  assert(!result.email.includes("Sony a7 III") && !result.email.includes("DJI RS3 Pro Gimbal"), "a named FX3 request cannot be replaced with the classifier's cheaper camera/gimbal bundle");
  assert(!/provisional|quantity not yet confirmed|proposed alternative|multi-day rates per unit|security payments/i.test(result.email), "the customer-facing quote leaves out internal status clutter and irrelevant rate ladders");
  assert(result.email.endsWith("DB Cinema Rentals Team"), "Gaffer emails use the agreed team signature");
  result = await run(1, {
    subject: a7GimbalBundle.title, itemTypes: ["camera"], start: "2026-11-03", end: "2026-11-03",
    requests: [{ subject: a7GimbalBundle.title, itemType: "camera", quantity: 1, allowAlternatives: true }],
  }, "Please quote one FX 3 camera body for 3 November 2026, camera only and no gimbal.", "chat");
  assert.equal(result.enquiry.start, "2026-11-03", "chat uses the customer's written rental date instead of the classifier's stale date");
  assert.equal(result.enquiry.end, "2026-11-03");
  assert.equal(result.enquiry.requests[0].lines[0].listingId, liveBodyQuote._id, "chat uses the customer's named FX3 even when the parser proposes an a7/gimbal bundle");
  assert.equal(result.enquiry.requests[0].lines[0].alternative, false, "a parser-suggested substitute cannot become an alternative without customer consent");
  assert(!result.reply.includes("Sony a7 III") && !result.reply.includes("gimbal"), "chat does not repeat the rejected substitute in its prose");
  assert.equal(result.enquiry.recommendedAddOn, undefined, "camera-only chat does not add unsolicited optional gear");
  assert.equal(result.enquiry.total, 47, "the exact FX3 body kit uses its own catalogue rate");
  assert(result.email.includes("£47.00 for the day"));
  assert(result.email.includes(`https://dbcinemarentals.com/gear/${liveBodyQuote.slug}`), "the quote links to the exact listed FX3 configuration used to fulfill it");
  assert.equal(result.email, [
    "Hi there,",
    "",
    `The [${liveBodyQuote.title}](https://dbcinemarentals.com/gear/${liveBodyQuote.slug}) would be £47.00 for the day on 3 November 2026. A possible window is pickup at ${result.enquiry.availabilityWindow.pickupTime} and return at ${result.enquiry.availabilityWindow.returnTime}; I’ll confirm availability once you tell me those times suit.`,
    "",
    "DB Cinema Rentals Team",
  ].join("\n"), "the real-catalogue quote stays short, readable, correctly linked, and team-signed");
  assert(!result.email.includes("Sony a7 III"));
  assert(!result.email.includes("DJI RS3 Pro Gimbal"));
  assert(!result.email.includes("Optional compatible lens"), "a camera-only request should not trigger an unsolicited lens upsell");
  assert(!result.email.includes("Multi-day rates per unit"));
  assert(result.email.endsWith("DB Cinema Rentals Team"));
  const bodyQuantity = camera.quantityOwned, alternateBodyQuantity = a7BodyPool.quantityOwned;
  camera.quantityOwned = 0; a7BodyPool.quantityOwned = 0;
  result = await run(1, {
    subject: "FX3", itemTypes: ["camera"], start: "2026-11-03", end: "2026-11-03",
    requests: [{ subject: "FX3 camera body", itemType: "camera", quantity: 1 }],
  }, "Please quote one FX3 camera body only, no accessories, for 3 November 2026.");
  assert.equal(result.enquiry.requests[0].lines.length, 0, "a bundled body kit cannot be presented as a body-only match when the bare body is out of stock");
  assert.equal(result.enquiry.complete, false);
  assert.equal(result.enquiry.total, null);
  assert(result.email.includes("FX3 Body Kit") && result.email.includes("different package configuration"));
  assert(/couldn't find this package in stock|need your pickup and return times/i.test(result.email), "a package conflict must either report known date stock or ask for times before confirming it");
  assert(result.email.includes("£47.00") && result.email.includes("Would you accept this package?"), "a differently configured FX3 listing is priced clearly and requires the customer's consent");
  assert(!/is available on 3 November/i.test(result.email), "a package configuration must not be presented as the exact body-only request");
  assert(result.email.includes("Sony FX3 camera body"), "the unavailable exact configuration should retain a clear model name");
  camera.quantityOwned = bodyQuantity; a7BodyPool.quantityOwned = alternateBodyQuantity;
  suggestionsForTest = ["Add XLR handle unit", "Confirm 09:00 pickup and 22:00 return", "Proceed to online checkout"];
  result = await run(1, {
    subject: "FX 3", itemTypes: ["camera"], start: "2026-11-03", end: "2026-11-03",
    pickupTime: undefined, returnTime: undefined,
    requests: [{ subject: "FX 3 camera body", itemType: "camera", quantity: 1 }],
  }, "Please quote one FX 3 camera body for 3 November 2026, camera only and no gimbal.", "chat");
  assert(!result.suggestions.some(value => /XLR|handle/i.test(value)), "a camera-only request must suppress accessory upsell chips");
  assert(result.suggestions.includes("Confirm 09:00 pickup and 22:00 return"), "useful pickup and return suggestions should remain");
  suggestionsForTest = [];
  const cameraPoolQuantity = camera.quantityOwned;
  camera.quantityOwned = 0;
  fx3AccessoryKitPool.quantityOwned = 0;
  result = await run(1, {
    subject: "FX 3", itemTypes: ["camera"], start: "2026-11-03", end: "2026-11-03",
    requests: [{ subject: a7GimbalBundle.title, itemType: "camera", quantity: 1, quantityIsListingUnits: true, allowAlternatives: true }],
  }, "Please quote one FX 3 camera body for 3 November 2026, camera only and no gimbal. If that exact body is unavailable, body-only alternatives are welcome.");
  assert.equal(result.enquiry.requests[0].lines[0].listingId, a7BodyAlternative._id, "when the exact body is unavailable, a body-only alternative may be offered with consent");
  assert.equal(result.enquiry.requests[0].lines[0].alternative, true);
  assert(!result.email.includes("DJI RS3 Pro Gimbal"), "camera-only requests must not silently regain a gimbal in the alternative");
  a7BodyPool.quantityOwned = 0;
  result = await run(1, {
    subject: "FX 3", itemTypes: ["camera"], start: "2026-11-03", end: "2026-11-03",
    requests: [{ subject: a7GimbalBundle.title, itemType: "camera", quantity: 1, quantityIsListingUnits: true, allowAlternatives: true }],
  }, "Please quote one FX 3 camera body for 3 November 2026, camera only and no gimbal.");
  assert.equal(result.enquiry.requests[0].lines.length, 0, "if no body-only option is in stock, do not substitute an accessory bundle");
  assert(!result.email.includes("DJI RS3 Pro Gimbal"));
  camera.quantityOwned = cameraPoolQuantity;
  a7BodyPool.quantityOwned = 1;
  listings.splice(listings.indexOf(a7BodyAlternative), 1);
  const liveRemus = listing(LIVE_REMUS_45.title, unit("Remus 45mm pool", 1), LIVE_REMUS_45.pricing.daily, LIVE_REMUS_45.pricing.day3, "lens");
  liveRemus.slug = LIVE_REMUS_45.slug;
  liveRemus.pricing = { ...LIVE_REMUS_45.pricing };
  liveRemus.inventoryFacts = {
    ...LIVE_REMUS_45.inventoryFacts,
    contents: [...LIVE_REMUS_45.inventoryFacts.contents],
    optionalContents: [...LIVE_REMUS_45.inventoryFacts.optionalContents],
  };
  listings.push(liveRemus);
  result = await run(1, {
    subject: "Blazar Remus 45mm", itemTypes: ["lens"], start: "2026-11-03", end: "2026-11-03",
    pickupTime: undefined, returnTime: undefined, requests: [],
  }, "Please quote one Blazar Remus 45mm lens for 3 November 2026.");
  assert.equal(result.enquiry.requests[0].subject, "Blazar Remus 45mm", "a specific Remus lens must survive when the model omits structured requests");
  assert.equal(result.enquiry.requests[0].fulfilled, 1);
  assert.equal(result.enquiry.requests[0].lines[0].listingId, liveRemus._id);
  assert.equal(result.enquiry.total, 37);
  assert(result.email.includes("Blazar Remus 45mm"));
  listings.splice(listings.indexOf(liveRemus), 1);
  listings.splice(listings.indexOf(liveBodyQuote), 1);
  result = await run(1, { requests: [{ subject: "Sony FX3 camera body", itemType: "camera", quantity: 1 }] },
    "Please quote one Sony FX3 camera body for 20 November 2030, pickup at 10am and return at 6pm.");
  assert.equal(result.enquiry.requests[0].lines[0].listingId, cameraListing._id, "an available requested FX3 must beat a cheaper a7 III kit");
  assert(!result.email.includes("Sony a7 III"));
  assert(!result.email.includes("DJI RS3 Pro Gimbal"));
  listings.splice(listings.indexOf(a7GimbalBundle), 1);
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
  assert(result.email.includes("Total gear hire: £195.00 for 3 days"), "the concise email shows the exact mixed-kit total once");
  assert(result.enquiry.requests[0].lines.some(line => line.title === b.title), "the exact owner-listed DJI Mic Wireless offer counts as one complete kit despite its two lavaliers");
  assert(result.enquiry.requests[0].lines.some(line => line.title === c.title && !line.alternative), "a generic four-kit request should include Mic 2 as another matching kit, not a substitution");
  assert.equal(result.enquiry.requests[0].lines.reduce((sum, line) => sum + (line.providedUnits ?? line.quantity), 0), 4, "the confirmed total must sum owner-reviewed complete kit units, not microphone components");
  const liveMicOffers = [a, duplicate, b, c];
  const savedDailyPrices = liveMicOffers.map(item => item.pricing.daily);
  a.pricing.daily = 26; duplicate.pricing.daily = 26; b.pricing.daily = 15; c.pricing.daily = 22;
  result = await run(4, {
    start: "2026-11-20", end: "2026-11-20", pickupTime: "10:00", returnTime: "18:00",
    requests: [{ subject: "wireless microphone kits", itemType: "wireless-mic", quantity: 4 }],
  }, "Please quote four complete wireless microphone kits for 20 November 2026, pickup at 10am and return at 6pm.");
  assert.equal(result.enquiry.days, 1, "the live four-kit example is an eight-hour rental day");
  assert.equal(result.enquiry.stockVerified, true);
  assert.equal(result.enquiry.complete, true);
  assert.equal(result.enquiry.total, 89, "one first-gen DJI (£15), one Mic 2 (£22) and two Rode PRO kits (£26 each) quote at £89 gear hire");
  assert.equal(result.enquiry.requests[0].lines.reduce((sum, line) => sum + (line.providedUnits ?? line.quantity), 0), 4);
  liveMicOffers.forEach((item, index) => { item.pricing.daily = savedDailyPrices[index]; });
  result = await run(4, { pickupTime: undefined, returnTime: undefined, requests: [{ subject: "wireless microphone kits", itemType: "wireless-mic", quantity: 4 }] }, "Please quote four wireless microphone kits for 20 November 2030.", "chat");
  assert.equal(result.enquiry.complete, true, "Gaffer chat quotes must also verify date-only quantities against one shared time window");
  assert.equal(result.enquiry.availabilityWindow.suggested, true);
  assert(result.reply.includes(`A possible window is pickup at ${result.enquiry.availabilityWindow.pickupTime} and return at ${result.enquiry.availabilityWindow.returnTime}`));
  assert(!/available on 20 November|times are available/i.test(result.reply));
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
  assert(result.email.includes("final stock check"));
  assert(result.email.includes("2 of the 4 requested Rode Mic Pro"), "the final check's exact surviving quantity must be stated");
  assert(!result.email.includes("Full requested quantity covered"));
  finalRace = false; stockFailure = true;
  result = await run(1);
  assert.equal(result.enquiry.complete, false, "stock outages must still produce an honest email reply");
  assert.equal(result.enquiry.total, null);
  assert(result.cards.every(x => x.item.available === null));
  assert(result.email.includes("couldn't verify stock"));
  const mixedReply = formatGafferEmailReply("", [], {
    start: "2030-11-20", end: "2030-11-20", pickupTime: "10:00", returnTime: "18:00", estimated: false, timed: true,
    days: 1, stockVerified: true, requirementsComplete: true, complete: false, total: 47,
    requests: [
      { subject: "FX3", quantity: 1, fulfilled: 1, lines: [{ listingId: "camera", title: "Sony FX3 Body", slug: "sony-fx3-body", quantity: 1, total: 47 }] },
      { subject: "Rode Wireless Mic Pro set", quantity: 1, fulfilled: null, availabilityIssue: "stock_check_failed", lines: [] },
    ],
  });
  assert(mixedReply.includes("I can supply 1 × FX3."), "email must preserve the verified camera quantity");
  assert(mixedReply.includes("couldn't verify stock for 1 × Rode Wireless Mic Pro"), "email must name the item whose stock check failed");
  assert(mixedReply.includes("Confirmed gear hire: £47"), "partial verified quotes must price only confirmed gear");
  const reviewNote = formatGafferEmailReply("", [], {
    start: "2030-11-20", end: "2030-11-20", pickupTime: "10:00", returnTime: "18:00", estimated: false, timed: true,
    days: 1, stockVerified: true, requirementsComplete: true, complete: true, total: 22,
    requests: [{ subject: "DJI Mic 2", quantity: 1, fulfilled: 1, lines: [{
      listingId: "mic2", title: "DJI Mic 2 Wireless Kit", slug: "dji-mic-2", quantity: 1, total: 22,
      inventoryReviewRequired: true, verifiedContents: ["1 × DJI Mic 2 wireless", "2x transmitter", "1x receiver", "1x charging case"],
    }] }],
  });
  assert(reviewNote.includes("Owner-confirmed contents: 1 × DJI Mic 2 wireless, 2x transmitter, 1x receiver, 1x charging case"), "quotes must list the exact owner-verified kit contents");
  assert(reviewNote.includes("I can't yet confirm the other listed accessories"), "quotes must not imply unreviewed seller extras are included");
  const unresolved = gafferEmailQuoteIntro({
    start: "2030-11-20", end: "2030-11-20", estimated: false, timed: true, stockVerified: false,
    requirementsComplete: true, complete: false, total: null, availabilityIssue: "stock_check_failed",
    requests: [
      { subject: "DJI Mic 1 set", quantity: 1, fulfilled: null, lines: [] },
      { subject: "Rode Wireless Mic Pro kits", quantity: 2, fulfilled: null, lines: [] },
    ],
  });
  assert(unresolved.includes("1 × DJI Mic 1 set"), "failed stock responses must name the exact DJI quantity requested");
  assert(unresolved.includes("2 × Rode Wireless Mic Pro kits"), "failed stock responses must name every requested item and quantity");
  assert(/no quantity is confirmed/i.test(unresolved), "a failed read must not claim the item is unavailable");
  assert(!unresolved.includes("full quantity"), "the broad full-quantity fallback must be removed");
  const conciseChatQuote = gafferEmailQuoteIntro({
    start: "2026-11-03", end: "2026-11-03", pickupTime: "10:00", returnTime: "18:00", estimated: false, timed: false,
    stockVerified: true, availabilityWindow: { pickupTime: "10:00", returnTime: "18:00", suggested: true },
    requirementsComplete: true, complete: true, total: 47, days: 1,
    requests: [{ subject: "fx3", displaySubject: "Sony FX3 camera body", quantity: 1, fulfilled: 1, lines: [] }],
  });
  assert(conciseChatQuote.includes("I can quote Sony FX3 camera body for 3 November 2026."));
  assert(conciseChatQuote.includes("Indicative gear hire is £47.00 for 1 rental day."));
  assert(conciseChatQuote.includes("A possible window is pickup at 10:00 and return at 18:00."));
  assert(conciseChatQuote.includes("I'll confirm availability once you confirm those times."));
  assert(!conciseChatQuote.includes("available on"), "date-only chat must not present suggested times as confirmed availability");
  assert(!conciseChatQuote.includes("1 of 1"), "the chat summary should avoid repeating the same quantity in two formats");
  const conciseDateOnlyEmail = formatGafferEmailReply("", [], {
    start: "2026-11-03", end: "2026-11-03", estimated: false, timed: false, stockVerified: true,
    availabilityWindow: { pickupTime: "09:00", returnTime: "22:00", suggested: true },
    requirementsComplete: true, complete: true, total: 47, days: 1,
    requests: [{ subject: "FX 3", displaySubject: "Sony FX3 camera body", quantity: 1, fulfilled: 1,
      lines: [{ listingId: "fx3", title: "Sony FX3 Body Kit with Cage and 320GB CFexpress Card",
        displayTitle: "Sony FX3 Body Kit with Cage and 320GB CFexpress Card", slug: "sony-fx3", quantity: 1,
        perDay: 47, total: 47, alternative: false }] }],
  }, undefined, undefined, "Alex", "FX3 rental, 3 November 2026. Camera body only, no lens or gimbal.");
  assert(conciseDateOnlyEmail.includes("would be £47.00 for the day on 3 November 2026"));
  assert(conciseDateOnlyEmail.includes("A possible window is pickup at 09:00 and return at 22:00"));
  assert(conciseDateOnlyEmail.includes("I’ll confirm availability once you tell me those times suit."));
  assert(conciseDateOnlyEmail.endsWith("DB Cinema Rentals Team"));
  assert(!/Sony a7 III|gimbal|Multi-day rates per unit|\b(?:3|7|14|30)\+ days\b|deposit|What dates/.test(conciseDateOnlyEmail), "a body-only date quote must stay focused and not repeat questions or upsell");
  const emailWithExtraAnswer = formatGafferEmailReply("This generated quote intro is replaced by the grounded email summary.", [], {
    start: "2026-11-03", end: "2026-11-03", pickupTime: "10:00", returnTime: "18:00", estimated: false, timed: true,
    stockVerified: true, requirementsComplete: true, complete: true, total: 47, days: 1,
    requests: [{ subject: "FX3", displaySubject: "Sony FX3 camera body", quantity: 1, fulfilled: 1,
      lines: [{ listingId: "camera", title: "Sony FX3 Body", slug: "sony-fx3-body", quantity: 1, total: 47, alternative: false }] }],
  }, undefined, "We're based in Trafalgar Square, and collection is available from our London studio.", undefined, "Where are you based?");
  assert(emailWithExtraAnswer.includes("We're based in Trafalgar Square"), "an answer to the customer's extra question must survive quote formatting");
  assert(!emailWithExtraAnswer.includes("This generated quote intro"), "the generated quote prose must not duplicate the grounded quote");
  assert(emailWithExtraAnswer.includes("£47.00 for the day"));
  assert(emailWithExtraAnswer.endsWith("DB Cinema Rentals Team"));
  const personalizedReply = formatGafferEmailReply("", [], undefined, undefined, undefined, "Amira Patel");
  assert(personalizedReply.startsWith("Hi Amira,"), "the email should use a verified sender display name without repeating their full address");
  assert(personalizedReply.endsWith("DB Cinema Rentals Team"));
  const ungroundedFx3Email = formatGafferEmailReply(
    "I’ve listed a provisional gear quote for your dates. What are your pickup and return times? Those determine the billed duration and let me check the required quantities.\nYour rental enquiry: 2026-11-03 to 2026-11-03.\nIndicative proposal — combined availability unconfirmed.\nRequested: 1 × fx 3. Quantity not yet confirmed.\n1 × Sony a7 III, 24–70mm GM Lens and DJI RS3 Pro Gimbal [PROPOSED ALTERNATIVE — please confirm]: £45.00 for the period.\nMulti-day rates per unit: 1+ days £45.00/day · 3+ days £36.67/day.",
    [{ item: { listingId: "wrong-bundle", slug: "sony-a7iii-bundle", title: "Sony a7 III, 24–70mm GM Lens and DJI RS3 Pro Gimbal", perDay: 45, availableUnits: 1 } }],
    undefined,
    undefined,
    undefined,
    "Daniel",
    "Please quote one FX 3 camera only for 3 November 2026.",
  );
  assert(ungroundedFx3Email.includes("Hi Daniel,"));
  assert(ungroundedFx3Email.includes("request for the FX3"));
  assert(ungroundedFx3Email.includes("What pickup and return times should I check for that date?"));
  assert(!ungroundedFx3Email.includes("Sony a7 III") && !ungroundedFx3Email.includes("DJI RS3 Pro Gimbal"), "an unstructured quote cannot substitute another camera or package");
  assert(!ungroundedFx3Email.includes("£45") && !ungroundedFx3Email.includes("Multi-day rates per unit"), "an unstructured email cannot send unverified pricing or a rate ladder");
  assert(ungroundedFx3Email.endsWith("DB Cinema Rentals Team"));
  const mismatchedStructuredFx3Quote = {
    start: "2026-11-03", end: "2026-11-03", days: 1, timed: false, estimated: false,
    stockVerified: false, requirementsComplete: true, complete: false, total: 45,
    requests: [{ subject: "FX3 camera body only", displaySubject: "Sony FX3 camera body", quantity: 1, fulfilled: 0,
      lines: [{ listingId: "wrong-bundle", title: "Sony a7 III, 24–70mm GM Lens and DJI RS3 Pro Gimbal", slug: "sony-a7iii-bundle", quantity: 1, total: 45, alternative: true }] }],
  };
  const fx3EmailContext = "FX3 rental, 3 November 2026\nCamera only, no lens or gimbal.";
  assert.equal(hasSpecificModelQuoteMismatch(fx3EmailContext, mismatchedStructuredFx3Quote), true);
  assert.equal(hasSpecificModelQuoteMismatch(fx3EmailContext, { ...mismatchedStructuredFx3Quote, requests: [{ ...mismatchedStructuredFx3Quote.requests[0], subject: "Sony a7 III camera body", displaySubject: "Sony a7 III camera body", lines: [] }] }), true,
    "a wrong-model request must also be stopped when the planner returned no item lines");
  const mismatchedStructuredFx3Email = formatGafferEmailReply("A different camera may work.", [], mismatchedStructuredFx3Quote,
    undefined, undefined, "Daniel", fx3EmailContext);
  assert(mismatchedStructuredFx3Email.includes("request for the FX3"));
  assert(mismatchedStructuredFx3Email.includes("I won't send a different camera or bundle."));
  assert(!mismatchedStructuredFx3Email.includes("Sony a7 III") && !mismatchedStructuredFx3Email.includes("£45"), "a structured but mismatched quote must be stopped at the outbound email boundary");
  assert(mismatchedStructuredFx3Email.endsWith("DB Cinema Rentals Team"));
  stockFailure = false;
  b.minimumRentalDays = 2;
  const partialMinimumPeriod = await run(4, {
    start: "2030-11-20", end: "2030-11-20", pickupTime: "10:00", returnTime: "18:00",
    itemTypes: ["wireless-mic"],
    requests: [{ subject: "wireless microphone kits", itemType: "wireless-mic", quantity: 4 }],
  }, "Please quote four wireless microphone kits for 20 November 2030, pickup at 10am and return at 6pm.", "email");
  assert.equal(partialMinimumPeriod.enquiry.requests[0].fulfilled, 3, "a one-day minimum mismatch must not inflate the confirmed mic-kit quantity");
  assert.equal(partialMinimumPeriod.enquiry.requests[0].minimumRentalOffer?.title, b.title, "the one remaining owner-listed DJI kit should be surfaced as a two-day option");
  assert.equal(partialMinimumPeriod.enquiry.complete, false);
  assert(partialMinimumPeriod.email.includes("3 of 4 wireless microphone kits"), "email must make the confirmed quantity and shortfall explicit");
  assert(partialMinimumPeriod.email.includes("2-day minimum"));
  assert.equal(partialMinimumPeriod.enquiry.requests[0].minimumRentalOffer.availability, "available");
  assert.equal(partialMinimumPeriod.enquiry.requests[0].minimumRentalOffer.end, "2030-11-21");
  assert.equal(partialMinimumPeriod.enquiry.requests[0].minimumRentalOffer.providedUnits, 1);
  assert.equal(partialMinimumPeriod.enquiry.requests[0].minimumRentalOffer.total, 24);
  assert(partialMinimumPeriod.email.includes("available with return at 18:00 on 21 November 2030"));
  assert(partialMinimumPeriod.email.includes(`Together, gear hire would be £${(partialMinimumPeriod.enquiry.total + 24).toFixed(2)}`));
  assert(stockQueries.some(call => call.name === "availability.forCart" && call.args.items.some(item => item.listingId === b._id && item.end > item.start) && call.args.items.some(item => item.listingId !== b._id)), "the longer option must be checked alongside the original basket");
  const minimumBasket = minimumRentalBasketLines(partialMinimumPeriod.enquiry);
  assert.equal(minimumBasket.length, partialMinimumPeriod.enquiry.requests[0].lines.reduce((sum, line) => sum + line.quantity, 0) + 1);
  assert.equal(minimumBasket.find(line => line.listingId === b._id).end, Date.parse("2030-11-21T00:00:00Z"));
  assert.equal(minimumBasket.find(line => line.listingId === b._id).returnTime, "18:00");
  assert(minimumBasket.filter(line => line.listingId !== b._id).every(line => line.end === Date.parse("2030-11-20T00:00:00Z")), "the original items retain the customer's requested return");
  const linkEmail = formatGafferEmailReply(partialMinimumPeriod.reply, partialMinimumPeriod.cards, partialMinimumPeriod.enquiry, "https://dbcinemarentals.com/cart/quote/example", undefined, "Daniel", "Four wireless microphone kits on 20 November 2030, 10am to 6pm");
  assert(linkEmail.includes("Review this option and its later return"));
  const unconfirmedBasket = structuredClone(partialMinimumPeriod.enquiry);
  unconfirmedBasket.requests[0].minimumRentalOffer.availability = "unverified";
  assert.equal(minimumRentalBasketLines(unconfirmedBasket), null, "unverified suggestions must never create a full proposed basket");
  const alternativeBasket = structuredClone(partialMinimumPeriod.enquiry);
  alternativeBasket.requests[0].minimumRentalOffer.alternative = true;
  assert.equal(minimumRentalBasketLines(alternativeBasket), null, "unaccepted substitutions must not be added to a proposed full basket");
  assert(partialMinimumPeriod.email.includes("Would that later return work for you?"));
  assert(partialMinimumPeriod.email.includes("Gear hire for the confirmed items is"), "the one-day total must cover only confirmed kits");
  const partialMinimumChat = await run(4, {
    start: "2030-11-20", end: "2030-11-20", pickupTime: "10:00", returnTime: "18:00",
    itemTypes: ["wireless-mic"],
    requests: [{ subject: "wireless microphone kits", itemType: "wireless-mic", quantity: 4 }],
  }, "Please quote four wireless microphone kits for 20 November 2030, pickup at 10am and return at 6pm.", "chat");
  assert(partialMinimumChat.reply.includes("3 of 4 wireless microphone kits"), "chat must explain the partial confirmed count");
  assert(partialMinimumChat.reply.includes("2-day minimum"), "chat must surface the checked minimum-period option");
  assert(partialMinimumChat.reply.includes("available with return at 18:00 on 21 November 2030"));
  const priorMic2Facts = structuredClone(c.inventoryFacts);
  c.inventoryFacts = { owned: true, reviewRequired: true, contents: ["1 × DJI Mic 2 wireless", "2x transmitter", "1x receiver", "1x charging case"] };
  const reviewedMicReply = await run(4, { start: "2030-11-20", end: "2030-11-20", pickupTime: "10:00", returnTime: "18:00", itemTypes: ["wireless-mic"], requests: [{ subject: "wireless microphone kits", itemType: "wireless-mic", quantity: 4 }] }, "Four wireless microphone kits, 20 November 2030 10am to 6pm", "email");
  assert(reviewedMicReply.email.includes("two transmitters, one receiver, and one charging case"));
  assert(reviewedMicReply.email.includes("I can't yet confirm the other listed accessories"));
  assert(!reviewedMicReply.email.includes("included contents of DJI Mic 2 Wireless Kit with Two Transmitters still need a manual check"));
  assert(!reviewedMicReply.email.includes("Owner-confirmed contents:"), "do not repeat the same packing details below the checked minimum-period option");
  assert(!reviewedMicReply.email.includes("Confirmed gear hire:"), "the confirmed total is already stated in the opening quote");
  c.inventoryFacts = priorMic2Facts;
  const minimumPeriod = await run(1, {
    start: "2030-11-20", end: "2030-11-20", pickupTime: "10:00", returnTime: "18:00",
    itemTypes: ["wireless-mic"],
    requests: [{ subject: "DJI Mic 1", itemType: "wireless-mic", quantity: 1 }],
  }, "Please quote one DJI Mic 1 set for 20 November 2030, pickup at 10am and return at 6pm.", "email");
  assert.equal(minimumPeriod.enquiry.requests[0].fulfilled, 0);
  assert.equal(minimumPeriod.enquiry.requests[0].minimumRentalOffer?.minimumDays, 2);
  assert.equal(minimumPeriod.enquiry.stockVerified, false, "a one-day stock check cannot confirm a listing with a two-day minimum");
  assert.equal(minimumPeriod.enquiry.total, null, "the minimum-period estimate is not counted as a quote for the requested one-day period");
  assert(minimumPeriod.email.includes("2-day minimum"));
  assert.equal(minimumPeriod.enquiry.requests[0].minimumRentalOffer.availability, "available");
  assert(minimumPeriod.email.includes("available with return at 18:00 on 21 November 2030"));
  assert(minimumPeriod.email.includes("Would that later return work for you?"));
  assert(minimumPeriod.email.endsWith("DB Cinema Rentals Team"));
  assert(stockQueries.some(call => call.name === "availability.forListing" && call.args.listingId === b._id && call.args.end > call.args.start), "only a valid longer window is checked for the minimum-period item");
  const minimumChat = await run(1, {
    start: "2030-11-20", end: "2030-11-20", pickupTime: "10:00", returnTime: "18:00",
    itemTypes: ["wireless-mic"], requests: [{ subject: "DJI Mic 1", itemType: "wireless-mic", quantity: 1 }],
  }, "Please quote one DJI Mic 1 set for 20 November 2030, pickup at 10am and return at 6pm.", "chat");
  assert(minimumChat.reply.includes("2-day minimum"), "chat and email must explain the same minimum period");
  assert(!minimumChat.reply.includes("couldn't find"), "a minimum-period mismatch is not a stock denial");
  const dateOnlyMinimum = await run(1, { start: "2030-11-20", end: "2030-11-20", pickupTime: undefined, returnTime: undefined, itemTypes: ["wireless-mic"], requests: [{ subject: "DJI Mic 1", itemType: "wireless-mic", quantity: 1 }] }, "DJI Mic 1 on 20 November 2030", "email");
  assert.equal(dateOnlyMinimum.enquiry.requests[0].minimumRentalOffer.availability, "unverified");
  assert(!dateOnlyMinimum.email.includes("It's available with return"));
  assert(dateOnlyMinimum.email.includes("pickup and return times"));
  minimumStockMode = "unavailable";
  const unavailableMinimum = await run(1, { start: "2030-11-20", end: "2030-11-20", pickupTime: "10:00", returnTime: "18:00", itemTypes: ["wireless-mic"], requests: [{ subject: "DJI Mic 1", itemType: "wireless-mic", quantity: 1 }] }, "DJI Mic 1, 20 November 2030 10am to 6pm", "email");
  assert.equal(unavailableMinimum.enquiry.requests[0].minimumRentalOffer.availability, "unavailable");
  assert(unavailableMinimum.email.includes("isn't available"));
  assert(!unavailableMinimum.email.includes("It's available with return"));
  minimumStockMode = "failure";
  const failedMinimum = await run(1, { start: "2030-11-20", end: "2030-11-20", pickupTime: "10:00", returnTime: "18:00", itemTypes: ["wireless-mic"], requests: [{ subject: "DJI Mic 1", itemType: "wireless-mic", quantity: 1 }] }, "DJI Mic 1, 20 November 2030 10am to 6pm", "email");
  assert.equal(failedMinimum.enquiry.requests[0].minimumRentalOffer.availability, "unverified");
  assert(failedMinimum.email.includes("couldn't confirm stock"));
  assert(!failedMinimum.email.includes("isn't available"));
  minimumStockMode = "available";
  minimumCombinedConflict = true;
  const conflictingMinimum = await run(4, { start: "2030-11-20", end: "2030-11-20", pickupTime: "10:00", returnTime: "18:00", itemTypes: ["wireless-mic"], requests: [{ subject: "wireless microphone kits", itemType: "wireless-mic", quantity: 4 }] }, "Four wireless microphone kits, 20 November 2030 10am to 6pm", "email");
  assert.equal(conflictingMinimum.enquiry.requests[0].minimumRentalOffer.availability, "unavailable", "a candidate must fit alongside every other proposed item");
  assert(!conflictingMinimum.email.includes("Together, gear hire would be"));
  minimumCombinedConflict = false;
  console.log("PASS Gaffer quotes: exact per-item confirmation and shortfalls, mixed-model fulfillment, transient final-read retry, 24-hour pricing and rate ladders, minimum-period handling, stock failures, final stock race. No live messages or reservations.");
})().catch(error => { console.error(error); process.exitCode = 1; });
