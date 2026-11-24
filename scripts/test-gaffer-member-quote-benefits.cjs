const assert = require("node:assert/strict");
const { load, setMock } = require("./lib/rentalTestHarness.cjs");
const RealDate = Date;
let nowMs = new RealDate("2026-11-01T12:00:00Z").getTime();
global.Date = class extends RealDate {
  constructor(...args) { super(...(args.length ? args : [nowMs])); }
  static now() { return nowMs; }
};

for (const [alias, file] of Object.entries({
  "@/lib/pricing": "src/lib/pricing.ts",
  "@/lib/membership": "src/lib/membership.ts",
  "@/lib/dates": "src/lib/dates.ts",
  "@/lib/mount": "src/lib/mount.ts",
  "@/lib/compat": "src/lib/compat.ts",
  "@/lib/kitRank": "src/lib/kitRank.ts",
  "@/lib/site": "src/lib/site.ts",
})) setMock(alias, load(file));

const listing = {
  _id: "fx3",
  slug: "sony-fx3",
  title: "Sony FX3 cinema camera",
  itemType: "camera-body",
  pricing: { daily: 100 },
  components: [{ inventoryUnitId: "fx3", qty: 1 }],
  specs: { mount: "E", coverage: "ff" },
  inventoryFacts: { owned: true, contents: ["Sony FX3 cinema camera"] },
};
let account = null;
let intent = {};
let narration = "";
const rows = [listing];

setMock("convex/browser", {
  ConvexHttpClient: class {
    async query(name, args) {
      if (name === "settings.get") return { openingHours: "", deliveryMaxKm: 20, checkoutEnabled: true };
      if (name === "accounts.me") return account;
      if (name === "accounts.myBookings") return [];
      if (name === "catalog.listListings") return rows;
      if (name === "catalog.byItemType") return rows.filter(row => args.types.includes(row.itemType));
      if (name === "catalog.listingsByIds") return rows.filter(row => args.ids.includes(row._id));
      if (name === "catalog.getListingBySlug") return rows.find(row => row.slug === args.slug) ?? null;
      if (name === "catalog.compatibilityKits") return [];
      if (name === "availability.forCheckoutTimeSlots") return { validPairs: [{ pickupTime: "10:00", returnTime: "17:00" }] };
      if (name === "availability.forCart") return Object.fromEntries(args.items.map(item => [item.listingId, { ok: true, available: 1 }]));
      if (name === "availability.forListing" || name === "availability.forTimeSlots") return { available: 1 };
      throw new Error(`Unexpected query ${name}`);
    }
  },
});

setMock("@/lib/ai", {
  generateBotObject: async ({ prompt }) => {
    if (prompt.startsWith("You parse")) return intent;
    narration = prompt;
    return { reply: "Grounded response", suggestions: [], humanRequested: false, resolvedInquiry: false };
  },
});
process.env.OPENROUTER_API_KEY = "isolated-fixture-no-provider-call";
process.env.NEXT_PUBLIC_CONVEX_URL = "https://fixture.invalid";
const { handleChat } = load("src/lib/gaffer.ts");

function accountFor({ membershipActive = false, membershipTier = null, loyaltyLevel = 0, loyaltyPercent = 0, loyaltyEligible = loyaltyLevel > 0, loyaltyCompleted = loyaltyLevel, loyaltyAdminAssigned = false, membershipStatus = "inactive", membershipFirstCleanRentalCompletedAt } = {}) {
  return {
    _id: "account-1",
    name: "Test renter",
    membershipActive,
    membershipTier,
    membershipStatus,
    membershipPaidThrough: membershipActive ? Date.now() + 86400000 : null,
    membershipTrialEnd: membershipStatus === "trialing" ? Date.now() + 7 * 86400000 : null,
    stripeSubscriptionId: membershipActive || membershipStatus === "trialing" ? "sub-test" : null,
    loyaltyLevel,
    loyaltyPercent,
    loyaltyEligible,
    loyaltyCompleted,
    loyaltyAdminAssigned,
    membershipFirstCleanRentalCompletedAt,
    storeCredit: membershipActive ? 58.8 : 0,
    favorites: [],
  };
}

async function recommend({ nextAccount = null, token = null, start = "2035-11-20", end = start } = {}) {
  account = nextAccount;
  intent = {
    intent: "recommend",
    subject: "camera",
    itemTypes: ["camera"],
    cameraModel: "",
    pricePref: "any",
    start,
    end,
    requests: [],
    requirementsComplete: true,
  };
  narration = "";
  return handleChat({ token, messages: [{ role: "user", content: "Recommend a camera" }] });
}

async function exactQuote(nextAccount, start = "2035-11-23", end = "2035-11-25") {
  account = nextAccount;
  intent = {
    intent: "price",
    subject: "Sony FX3",
    itemTypes: ["camera-body"],
    cameraModel: "",
    pricePref: "any",
    start,
    end,
    pickupTime: "10:00",
    returnTime: "17:00",
    requests: [{ subject: "Sony FX3", itemType: "camera-body", quantity: 1, quantityIsListingUnits: true, allowAlternatives: false }],
    requirementsComplete: true,
  };
  narration = "";
  return handleChat({ token: "signed-session", messages: [{ role: "user", content: `Quote the Sony FX3 for ${start} to ${end}, 10am to 5pm` }] });
}

(async () => {
  let result = await recommend();
  assert.equal(result.cards[0].item.memberTotal, undefined, "guests get the regular price only");

  result = await recommend({
    token: "signed-session",
    nextAccount: accountFor({ membershipTier: "pro", membershipStatus: "trialing" }),
  });
  assert.equal(result.cards[0].item.memberTotal, undefined, "an unactivated first-rental trial gets no member price");

  result = await recommend({
    token: "signed-session",
    nextAccount: accountFor({ membershipActive: true, membershipTier: "pro", membershipStatus: "active" }),
  });
  assert.equal(result.cards[0].item.memberTotal, undefined, "paid Pro does not invent a gear-rate percentage on a weekday");
  assert.equal(result.cards[0].item.total, 100, "monthly plan credit is not silently subtracted from the gear quote");

  result = await recommend({
    token: "signed-session",
    nextAccount: accountFor({ loyaltyLevel: 3, loyaltyPercent: 10 }),
  });
  assert.equal(result.cards[0].item.memberBenefitKind, undefined, "stale loyalty flags without a trusted admin assignment or earned-rental marker cannot grant a benefit");

  result = await recommend({
    token: "signed-session",
    nextAccount: accountFor({ loyaltyLevel: 3, loyaltyPercent: 10, loyaltyCompleted: 0, loyaltyAdminAssigned: true }),
  });
  assert.equal(result.cards[0].item.memberBenefitKind, "loyalty", "Gaffer recognizes the trusted immediate admin-assigned Encore benefit");
  assert.equal(result.cards[0].item.memberPct, 10);
  assert.equal(result.cards[0].item.memberTotal, 90, "Gaffer shows the same assigned percentage as checkout before a completed rental");

  for (const [level, percent] of [[1, 2], [2, 4], [3, 10]]) {
    result = await recommend({
      token: "signed-session",
      nextAccount: accountFor({ loyaltyLevel: level, loyaltyPercent: percent, membershipFirstCleanRentalCompletedAt: Date.now() - 86400000 }),
    });
    assert.equal(result.cards[0].item.memberBenefitKind, "loyalty", `Encore ${level} uses the canonical loyalty benefit`);
    assert.equal(result.cards[0].item.memberPct, percent);
    assert.equal(result.cards[0].item.memberTotal, 100 - percent, `Encore ${level} applies exactly ${percent}%`);
  }

  result = await recommend({
    token: "signed-session",
    nextAccount: accountFor({ membershipActive: true, membershipTier: "pro", membershipStatus: "active", loyaltyLevel: 3, loyaltyPercent: 10, membershipFirstCleanRentalCompletedAt: Date.now() - 86400000 }),
    start: "2035-11-23",
    end: "2035-11-25",
  });
  assert.equal(result.cards[0].item.memberBenefitKind, "weekend", "the stronger member weekend deal beats Encore III without stacking");
  assert.equal(result.cards[0].item.memberSaving, 70);
  assert.equal(result.cards[0].item.memberTotal, 200);

  result = await exactQuote(accountFor({ membershipActive: true, membershipTier: "pro", membershipStatus: "active", loyaltyLevel: 3, loyaltyPercent: 10, membershipFirstCleanRentalCompletedAt: Date.now() - 86400000 }));
  assert.equal(result.enquiry.total, 270, "structured quote retains the undiscounted gear subtotal as evidence");
  assert.deepEqual(result.enquiry.memberBenefit, { kind: "weekend", label: "Member weekend deal · £100 cap", saving: 70, total: 200 });
  assert.equal(result.cards[0].item.memberTotal, undefined, "a basket-level benefit is not duplicated as a per-item discount");
  assert.match(result.reply, /£200\.00/);
  assert.match(result.reply, /£70\.00/);
  assert.match(narration, /single best eligible member benefit/);
  assert.match(narration, /never add another member discount/);

  result = await exactQuote(null, "2026-11-01", "2026-11-01");
  assert.equal(result.enquiry.equipmentTotal, 100, "same-day quote retains the equipment amount separately");
  assert.equal(result.enquiry.sameDayFee, 10, "pickup today in London adds 10% after equipment pricing");
  assert.equal(result.enquiry.total, 110, "the renter-facing total includes the same-day fee");
  assert.match(result.reply, /£100\.00 equipment \+ £10\.00 same-day fee = £110\.00/, "Gaffer itemizes today's fee in its quote text");

  result = await exactQuote(null, "2026-11-02", "2026-11-02");
  assert.equal(result.enquiry.sameDayFee, 0, "tomorrow's pickup does not get the same-day fee");
  assert.equal(result.enquiry.total, 100, "tomorrow's price remains the equipment total");

  nowMs = new RealDate("2026-06-01T23:30:00Z").getTime();
  result = await exactQuote(null, "2026-06-02", "2026-06-02");
  assert.equal(result.enquiry.sameDayFee, 10, "late UTC on June 1 is already June 2 in London, so the London-today pickup fee applies");
  result = await exactQuote(null, "2026-06-03", "2026-06-03");
  assert.equal(result.enquiry.sameDayFee, 0, "the day after the London-local date has no same-day fee");
  nowMs = new RealDate("2026-11-01T12:00:00Z").getTime();

  result = await exactQuote(
    accountFor({ membershipActive: true, membershipTier: "pro", membershipStatus: "active", loyaltyLevel: 3, loyaltyPercent: 10, membershipFirstCleanRentalCompletedAt: Date.now() - 86400000 }),
    "2026-11-01",
    "2026-11-01",
  );
  assert.equal(result.enquiry.total, 110, "the standard same-day total remains the un-discounted comparison");
  assert.deepEqual(result.enquiry.memberBenefit, {
    kind: "loyalty", label: "Encore · 10% rental saving", saving: 10, total: 99, equipmentTotal: 90, sameDayFee: 9,
  }, "one best eligible member rate applies before the same-day fee; discounts do not stack");
  assert.match(result.reply, /£90\.00 equipment after Encore · 10% rental saving \(£10\.00\) \+ £9\.00 same-day fee = £99\.00/);

  result = await exactQuote(
    accountFor({ membershipActive: true, membershipTier: "pro", membershipStatus: "active", loyaltyLevel: 3, loyaltyPercent: 10, membershipFirstCleanRentalCompletedAt: Date.now() - 86400000 }),
    "2026-11-02",
    "2026-11-02",
  );
  assert.equal(result.enquiry.sameDayFee, 0, "a member does not receive a short-notice fee for tomorrow's pickup");
  assert.equal(result.enquiry.total, 100);
  assert.equal(result.enquiry.memberBenefit.total, 90, "the single eligible member saving applies without stacking a fee or a second discount");

  console.log("PASS Gaffer member quote parity: guest, first-trial, paid subscription, Encore I–III, strongest single benefit, and structured basket total. No provider writes.");
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
