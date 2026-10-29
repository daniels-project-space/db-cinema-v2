// Public DB Cinema catalogue snapshot verified on 29 October 2026. Email and
// phone quote tests share these exact listings and rate ladders to catch drift.
const LIVE_FX3_BODY_KIT = Object.freeze({
  slug: "sony-fx-3-cinema-camera-full-frame-mirrorless-4k-sony-fx3-sa-948607",
  title: "Sony FX3 Body Kit with Cage and 320GB CFexpress Card",
  itemType: "camera-body",
  category: "Cameras",
  pricing: Object.freeze({ daily: 47, day3: 44, day7: 32 }),
  inventoryFacts: Object.freeze({
    owned: true,
    reviewRequired: false,
    contents: Object.freeze([
      "1 × Sony FX3",
      "1 × Lexar CFexpress Type A 320GB card",
      "Sony NP-FZ100 batteries (included)",
    ]),
    optionalContents: Object.freeze(["Sony XLR Handle Unit"]),
  }),
});

const LIVE_REMUS_45 = Object.freeze({
  slug: "anamorphic-blazar-remus-lens-45mm-1-5x-t2-0-pl-mount-neutral-987356",
  title: "Blazar Remus 45mm T2 1.5× PL Anamorphic Lens",
  itemType: "lens",
  category: "Lenses",
  pricing: Object.freeze({ daily: 37, day3: 36.666666666666664, day7: 30 }),
  inventoryFacts: Object.freeze({
    owned: true,
    reviewRequired: false,
    contents: Object.freeze(["1 × Anamorphic Blazar Remus 45mm"]),
    optionalContents: Object.freeze([]),
  }),
});

module.exports = { LIVE_FX3_BODY_KIT, LIVE_REMUS_45 };
