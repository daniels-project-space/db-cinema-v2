const assert = require("node:assert/strict");
const Module = require("node:module");
const { buildSync } = require("esbuild");
const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");

const bundled = buildSync({
  entryPoints: ["src/components/rentals/RentalKit.tsx"],
  bundle: true,
  platform: "node",
  format: "cjs",
  jsx: "automatic",
  packages: "external",
  write: false,
});
const component = new Module(`${process.cwd()}/rental-kit-test.cjs`, module);
component.filename = `${process.cwd()}/rental-kit-test.cjs`;
component.paths = module.paths;
component._compile(bundled.outputFiles[0].text, component.filename);

const items = Array.from({ length: 5 }, (_, index) => ({
  listingId: `item-${index}`,
  title: `Equipment ${index}`,
  heroImage: `/equipment-${index}.jpg`,
  qty: index === 1 ? 2 : 1,
}));
const html = renderToStaticMarkup(React.createElement(component.exports.RentalKit, { items, allPhotos: true }));
for (const item of items) assert.match(html, new RegExp(`alt="${item.title}"`));
assert.match(html, /×2/);
assert.match(html, /overflow-x-auto/);
assert.doesNotMatch(html, /\+2 more/);
console.log("Admin rental photo strip displays every booked item and quantity.");
