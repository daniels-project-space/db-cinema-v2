const assert = require("node:assert/strict");
const { load, setMock } = require("./lib/rentalTestHarness.cjs");

for (const [alias, file] of Object.entries({
  "@/lib/pricing": "src/lib/pricing.ts",
  "@/lib/membership": "src/lib/membership.ts",
  "@/lib/dates": "src/lib/dates.ts",
  "@/lib/mount": "src/lib/mount.ts",
  "@/lib/compat": "src/lib/compat.ts",
  "@/lib/kitRank": "src/lib/kitRank.ts",
  "@/lib/site": "src/lib/site.ts",
})) setMock(alias, load(file));

const listings = [
  { _id: "rode-pro", slug: "rode-mic-pro", title: "Rode Mic Pro Kit", itemType: "wireless-mic", pricing: { daily: 24 }, components: [{ inventoryUnitId: "rode-pro", qty: 1 }], inventoryFacts: { owned: true, contents: ["Rode Mic Pro Kit"] } },
  { _id: "dji-mic-2", slug: "dji-mic-2", title: "DJI Mic 2 Set", itemType: "wireless-mic", pricing: { daily: 18 }, components: [{ inventoryUnitId: "dji-mic-2", qty: 1 }], inventoryFacts: { owned: true, contents: ["DJI Mic 2 Set"] } },
  { _id: "dji-mic-1", slug: "dji-mic-1", title: "DJI Mic 1 Set", itemType: "wireless-mic", pricing: { daily: 12 }, components: [{ inventoryUnitId: "dji-mic-1", qty: 1 }], inventoryFacts: { owned: true, contents: ["DJI Mic 1 Set"] } },
];
let intent;
let availability = new Map(listings.map((item) => [item._id, 1]));
let availabilityChecks = [];
let narration = "";

setMock("convex/browser", {
  ConvexHttpClient: class {
    async query(name, args = {}) {
      if (name === "catalog.getListingBySlug") return listings.find((item) => item.slug === args.slug) ?? null;
      if (name === "catalog.listListings") return listings;
      if (name === "catalog.byItemType") return listings.filter((item) => args.types.includes(item.itemType));
      if (name === "catalog.listingsByIds") return listings.filter((item) => args.ids.includes(item._id));
      if (name === "availability.forListing" || name === "availability.forTimeSlots") {
        assert.equal(args.start, Date.UTC(2026, 10, 20), "availability must use the requested date");
        assert.equal(args.end, Date.UTC(2026, 10, 20), "availability must use the requested date");
        assert.equal(args.pickupTime, "10:00");
        assert.equal(args.returnTime, "17:00");
        availabilityChecks.push(args.listingId);
        return { available: availability.get(String(args.listingId)) ?? 0 };
      }
      throw new Error(`Unexpected Gaffer query: ${name}`);
    }
  },
});
setMock("@/lib/ai", {
  generateBotObject: async ({ prompt }) => {
    if (prompt.startsWith("You parse")) return intent;
    narration = prompt;
    return { reply: "Grounded response", suggestions: [] };
  },
});
process.env.OPENROUTER_API_KEY = "isolated-fixture-no-provider-call";

const { handleChat, requestedMicKitCount, shouldOfferMoreMicOptions } = load("src/lib/gaffer.ts");
const { formatGafferEmailReply } = load("src/lib/inboundEmail.ts");
assert(shouldOfferMoreMicOptions("4x mic kits for a weekend shoot", "wireless microphones", []), "the exact four-kit phrasing must enable the full mic-options path");
assert.equal(requestedMicKitCount("4x mic kits for a weekend shoot"), 4);
assert.equal(requestedMicKitCount("four DJI Mic 1 sets"), 4);
assert.equal(requestedMicKitCount("4 mics total"), null, "microphone count must not be mistaken for a rental-kit count");
assert.equal(requestedMicKitCount("2 x Rode Mic Pro kits plus 1 x DJI Mic 2 set"), null, "separate product quantities must not be misreported as one model's requested quantity");
const request = "2 x Rode Mic Pro kits (4 mics total) plus 1 x DJI Mic 2 set for 20 November, pickup 10:00 and return 17:00";
async function run(availabilityById = new Map(listings.map((item) => [item._id, 1])), requestText = request, channel = "chat") {
  availability = availabilityById;
  availabilityChecks = [];
  narration = "";
  intent = {
    intent: "availability",
    subject: "Rode Mic Pro",
    itemTypes: ["wireless-mic"],
    cameraModel: "",
    pricePref: "any",
    start: "2026-11-20",
    end: "2026-11-20",
    pickupTime: "10:00",
    returnTime: "17:00",
  };
  return handleChat({ messages: [{ role: "user", content: requestText }], channel });
}

(async () => {
  let result = await run();
  const shown = result.cards.map((card) => card.item.listingId);
  assert.deepEqual([...shown].sort(), ["dji-mic-1", "dji-mic-2", "rode-pro"]);
  assert.equal(new Set(shown).size, shown.length, "named and recommended options must not create duplicate cards");
  assert(availabilityChecks.includes("dji-mic-2"), "the second named product must be checked against the same date and times");
  assert(availabilityChecks.includes("dji-mic-1"), "the additional DJI Mic 1 option must be checked against the same date and times");
  assert(narration.includes("REQUESTED MICROPHONE MODELS AVAILABLE"));
  assert(narration.includes("MICROPHONE OPTIONS VERIFIED AVAILABLE"));
  assert(narration.includes("DJI Mic 1 Set"));
  assert(narration.includes("available for selected dates/times"));

  const unavailable = new Map([["rode-pro", 1], ["dji-mic-2", 0], ["dji-mic-1", 1]]);
  result = await run(unavailable);
  assert(!result.cards.some((card) => card.item.listingId === "dji-mic-2"), "a named set with no available units must not be presented as an available choice");
  assert(result.cards.some((card) => card.item.listingId === "dji-mic-1"), "another available mic option remains visible");
  assert(narration.includes("REQUESTED MICROPHONE MODELS NOT FREE"));

  const fourKitAvailability = new Map([["rode-pro", 0], ["dji-mic-2", 0], ["dji-mic-1", 2]]);
  result = await run(fourKitAvailability, "4x mic kits for 20 November, pickup 10:00 and return 17:00", "email");
  const djiOne = result.cards.find((card) => card.item.listingId === "dji-mic-1");
  assert(djiOne, "an available compatible kit must remain visible when the requested quantity exceeds one listing's stock");
  assert.equal(djiOne.item.availableUnits, 2, "the card must preserve the exact listing-unit availability count");
  assert.equal(djiOne.item.requestedMicKitCount, 4);
  assert(narration.includes("EXPLICIT MIC-KIT REQUEST: 4 complete microphone kits"));
  assert(narration.includes("short by 2"));
  const emailReply = formatGafferEmailReply("I found a possible option.", result.cards);
  assert(emailReply.includes("DJI Mic 1 Set"), "email must include product options that otherwise exist only as Gaffer cards");
  assert(emailReply.includes("2 available; 4 kits requested, so this listing is short by 2"));
  assert(narration.includes("EMAIL RESPONSE:"), "email narration must account for the deterministic inventory section");
  assert.equal(availabilityChecks.filter((id) => id === "dji-mic-1").length, 1, "rank and card rendering must reuse the same availability read");

  process.stdout.write("Gaffer multi-mic request, named model, and date/time availability checks passed.\n");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
