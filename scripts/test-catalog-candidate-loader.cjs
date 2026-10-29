const assert = require("node:assert/strict");
const { load } = require("./lib/rentalTestHarness.cjs");
const { createTypeListingLoader } = load("src/lib/catalogCandidates.ts");

const catalogue = [
  { _id: "lens-1", itemType: "lens" },
  { _id: "camera-1", itemType: "camera-body" },
  { _id: "mic-1", itemType: "wireless-mic" },
];

(async () => {
  const calls = [];
  const loader = createTypeListingLoader({
    query: async (name, args) => {
      calls.push([name, args]);
      if (name === "catalog.byItemType") throw Error("BadConvexFunctionIdentifier");
      if (name === "catalog.listListings") return catalogue;
      throw Error(`Unexpected query ${name}`);
    },
  });
  assert.deepEqual(await loader(["lens", "camera-body"]), catalogue.slice(0, 2));
  assert.deepEqual(await loader(["lens"]), [catalogue[0]]);
  assert.equal(calls.filter(([name]) => name === "catalog.listListings").length, 1, "one legacy read is shared across category lookups");
  assert.equal(calls.find(([name]) => name === "catalog.listListings")[1].limit, 501, "the fallback reads one row beyond its safe cap");

  const overflow = createTypeListingLoader({
    query: async name => name === "catalog.byItemType"
      ? Promise.reject(Error("BadConvexFunctionIdentifier"))
      : Array.from({ length: 501 }, (_, index) => ({ _id: String(index), itemType: "lens" })),
  });
  await assert.rejects(overflow(["lens"]), /safe candidate limit/, "the fallback refuses a truncated catalogue instead of silently omitting matches");

  const outage = createTypeListingLoader({
    query: async name => {
      if (name === "catalog.byItemType") throw Error("Connection timed out");
      throw Error("The legacy endpoint must not hide a real outage");
    },
  });
  await assert.rejects(outage(["lens"]), /Connection timed out/);
  console.log("PASS bounded catalogue compatibility loader: legacy endpoint fallback, request-local reuse, overflow refusal, and non-missing backend errors.");
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
