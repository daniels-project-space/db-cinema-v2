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
assert.match(fs.readFileSync("src/components/admin/RentalInbox.tsx", "utf8"), /<CompactRentalImages items=/);
const accountWorkspace = fs.readFileSync("src/components/admin/AccountAdmin.tsx", "utf8");
assert.match(accountWorkspace, /rental\.items\?\.length \? rental\.items\.map/);
assert.match(accountWorkspace, /<SmartImage fit="contain" src=\{imageSources\[0\]\}/);
const rentalConversation = fs.readFileSync("src/components/rentals/RentalConversation.tsx", "utf8");
assert.match(rentalConversation, /data-testid="rental-items-in-chat"/);
assert.match(rentalConversation, /bookingSummary\.items\.map/);
assert.match(rentalConversation, /<SmartImage fit="contain" src=\{imageSources\[0\]\}/);
const adminRentalData = fs.readFileSync("convex/accountAdmin.ts", "utf8");
assert.match(adminRentalData, /imageSources = listingRentalImages\(/);
const renterChatData = fs.readFileSync("convex/rentalChat.ts", "utf8");
assert.match(renterChatData, /imageSources: listingRentalImages\(l\)/);
console.log("Rental photos use each listing's real catalogue images in the inbox, account workspace, and renter chat.");
