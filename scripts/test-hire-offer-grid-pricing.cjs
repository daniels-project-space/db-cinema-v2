const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const esbuild = require("esbuild");
const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
const harness = require("./lib/rentalTestHarness.cjs");

const root = path.resolve(__dirname, "..");
const output = fs.mkdtempSync(path.join(root, ".tmp-hire-offer-price-"));

(async () => {
  const listing = harness.put("listings", {
    active: true,
    slug: "fractional-rate-camera",
    title: "Fractional rate camera",
    category: "Cameras",
    pricing: { daily: 22.22 },
    depositAmount: 50,
    minimumRentalDays: 1,
    components: [],
    stockMappingStatus: "complete",
  });
  const offers = await harness.load("convex/catalog.ts").discoveryOffers.handler(
    { db: harness.db },
    { slugs: [listing.slug] },
  );
  assert.equal(offers[0].daily, 22.22, "The discovery API keeps its precise numeric price");

  const entry = path.join(output, "hire-offer-grid.cjs");
  await esbuild.build({
    entryPoints: [path.join(root, "src/components/HireOfferGrid.tsx")],
    outfile: entry,
    bundle: true,
    platform: "node",
    format: "cjs",
    jsx: "automatic",
    external: ["react", "react-dom", "react-dom/server", "react/jsx-runtime"],
    plugins: [{
      name: "next-link-fixture",
      setup(build) {
        build.onResolve({ filter: /^next\/link$/ }, () => ({ path: "next/link", namespace: "fixture" }));
        build.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({
          loader: "tsx",
          contents: "export default function Link({ href, children, ...props }) { return <a href={href} {...props}>{children}</a>; }",
        }));
      },
    }],
  });
  const { HireOfferGrid } = require(entry);
  const html = renderToStaticMarkup(React.createElement(HireOfferGrid, { offers }));
  assert.match(html, /£23 per day/, "The public hire card rounds a seeded fractional listing price up to a whole pound");
  assert.doesNotMatch(html, /£22\.22/, "The public hire card never exposes pennies");
  assert.equal(listing.pricing.daily, 22.22, "Formatting does not mutate stored listing prices");
  console.log("PASS hire offer grid: precise discovery data renders as a whole-pound ceiling without mutating catalog prices.");
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
}).finally(() => fs.rmSync(output, { recursive: true, force: true }));
