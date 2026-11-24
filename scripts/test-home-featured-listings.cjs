const assert = require("node:assert/strict");
const { load } = require("./lib/rentalTestHarness.cjs");

const { selectHomeFeaturedListings } = load("shared/homeFeaturedListings.ts");
const ranked = [
  { slug: "popular-sony", title: "Sony FX3 Camera", category: "Cameras", itemType: "camera-body" },
  { slug: "venice-one", title: "Sony Venice Cinema Camera", category: "Cameras", itemType: "camera-body" },
  { slug: "red-one", title: "RED Komodo Camera Set", category: "Packages", itemType: "camera-body" },
  { slug: "audio", title: "Wireless interview microphone", category: "Audio", itemType: "wireless-mic" },
  { slug: "orion-one", title: "Atlas Orion 32mm Lens", category: "Lenses", itemType: "lens" },
  { slug: "venice-two", title: "Sony Venice 2 Camera Kit", category: "Packages", itemType: "camera-body" },
  { slug: "red-two", title: "RED V-Raptor Camera Package", category: "Packages", itemType: "camera-body" },
  { slug: "orion-two", title: "Atlas Orion 50mm Lens", category: "Lenses", itemType: "lens" },
  { slug: "popular-blackmagic", title: "Blackmagic Cinema Camera", category: "Cameras", itemType: "camera-body" },
];

const featured = selectHomeFeaturedListings(ranked, 8);
assert.equal(featured.length, 8);
assert.deepEqual(featured.slice(0, 6).map(listing => listing.slug), [
  "venice-one", "orion-one", "red-one", "venice-two", "orion-two", "red-two",
]);
assert.deepEqual(featured.slice(6).map(listing => listing.slug), ["popular-sony", "audio"]);
assert.deepEqual(selectHomeFeaturedListings(ranked, 0), []);
assert.deepEqual(selectHomeFeaturedListings(ranked, 3).map(listing => listing.slug), ["venice-one", "orion-one", "red-one"]);
assert.deepEqual(selectHomeFeaturedListings(ranked.slice(0, 1), 8).map(listing => listing.slug), ["popular-sony"]);
console.log("PASS homepage showcase prioritizes existing Venice, Orion and RED listings while preserving ranked fillers");
