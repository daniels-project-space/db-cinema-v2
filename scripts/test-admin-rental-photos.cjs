const assert = require("node:assert/strict");
const fs = require("node:fs");
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
const duplicatedItems = [...items, { listingId: "same-photo", title: "Repeated listing image", heroImage: items[0].heroImage }];
const html = renderToStaticMarkup(React.createElement(component.exports.RentalKit, { items: duplicatedItems, allPhotos: true }));
for (const item of items) assert.match(html, new RegExp(`alt="${item.title}"`));
assert.doesNotMatch(html, /alt="Repeated listing image"/, "All-item strips omit repeated listing photos");
assert.match(html, /×2/);
assert.match(html, /overflow-x-auto/);
assert.doesNotMatch(html, /\+2 more/);
const compactBundle = buildSync({ entryPoints: ["src/components/admin/CompactRentalImages.tsx"], bundle: true, platform: "node", format: "cjs", jsx: "automatic", packages: "external", write: false });
const compactModule = new Module(`${process.cwd()}/compact-rental-images-test.cjs`, module);
compactModule.filename = `${process.cwd()}/compact-rental-images-test.cjs`;
compactModule.paths = module.paths;
compactModule._compile(compactBundle.outputFiles[0].text, compactModule.filename);
const compact = renderToStaticMarkup(React.createElement(compactModule.exports.CompactRentalImages, { items: [...items, { listingId: "other", title: "Different item, shared photo", heroImage: items[0].heroImage }] }));
for (const item of items) assert.match(compact, new RegExp(`alt="${item.title}"`));
assert.doesNotMatch(compact, /alt="Different item, shared photo"/, "Compact booking strips omit duplicate photo URLs");
assert.match(compact, /aria-label="Booked equipment images"/);
assert.match(compact, /tabindex="0"/);
assert.match(compact, /×2/);
assert.equal(renderToStaticMarkup(React.createElement(compactModule.exports.CompactRentalImages, { items: [] })), "");
for (const file of ["src/components/admin/RentalInbox.tsx", "src/components/admin/RentalOrderTools.tsx"]) assert.match(fs.readFileSync(file, "utf8"), /<CompactRentalImages items=/);
console.log("Admin rental photo strip displays every booked item and quantity.");
