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
const duplicatedItems = [...items, { listingId: "item-0", title: "Equipment 0 duplicate row", heroImage: items[0].heroImage }, { listingId: "item-0", title: "Equipment 0 later rental period", start: 100, end: 200, heroImage: items[0].heroImage }, { listingId: "same-photo", title: "Different listing, shared photo", heroImage: items[0].heroImage }];
const html = renderToStaticMarkup(React.createElement(component.exports.RentalKit, { items: duplicatedItems, allPhotos: true }));
for (const item of items) assert.match(html, new RegExp(`alt="${item.title}"`));
assert.match(html, /alt="Different listing, shared photo"/, "Distinct listings remain visible even when catalogue photos are shared");
assert.equal((html.match(/alt="Equipment 0"/g) ?? []).length, 1, "Duplicate copies of the same listing collapse to one image");
assert.match(html, /title="Equipment 0"[^]*?<span class="absolute right-2 top-2[^>]*>×2<\/span>/, "The collapsed duplicate is represented by its quantity");
assert.equal((html.match(/<img /g) ?? []).length, 6, "All distinct listings render once even if a listing has multiple rental periods");
assert.match(html, /×2/);
assert.match(html, /overflow-x-auto/);
assert.doesNotMatch(html, /\+2 more/);
const compactBundle = buildSync({ entryPoints: ["src/components/admin/CompactRentalImages.tsx"], bundle: true, platform: "node", format: "cjs", jsx: "automatic", packages: "external", write: false });
const compactModule = new Module(`${process.cwd()}/compact-rental-images-test.cjs`, module);
compactModule.filename = `${process.cwd()}/compact-rental-images-test.cjs`;
compactModule.paths = module.paths;
compactModule._compile(compactBundle.outputFiles[0].text, compactModule.filename);
const compact = renderToStaticMarkup(React.createElement(compactModule.exports.CompactRentalImages, { items: [...items, { listingId: "item-0", title: "Equipment 0 duplicate row", heroImage: items[0].heroImage }, { listingId: "item-0", title: "Equipment 0 later rental period", start: 100, end: 200, heroImage: items[0].heroImage }, { listingId: "other", title: "Different item, shared photo", heroImage: items[0].heroImage }] }));
for (const item of items) assert.match(compact, new RegExp(`alt="${item.title}"`));
assert.match(compact, /alt="Different item, shared photo"/, "Compact booking strips retain distinct listings with shared photos");
assert.equal((compact.match(/alt="Equipment 0"/g) ?? []).length, 1, "Compact booking strips collapse duplicate rows by listing identity");
assert.match(compact, /title="Equipment 0 ×2"/, "Compact strips retain the combined quantity for duplicate rows");
assert.equal((compact.match(/<img /g) ?? []).length, 6, "Compact booking strips show each distinct listing once across rental periods");
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
const adminDashboard = fs.readFileSync("src/components/admin/AdminDashboard.tsx", "utf8");
assert.match(adminDashboard, /groupRentalKitPhotos\(rental\.kit\)/, "Dashboard cards show one actual catalogue photo per listing across separate rental periods");
const operationsCalendar = fs.readFileSync("src/components/admin/OperationsCalendar.tsx", "utf8");
assert.match(operationsCalendar, /groupCalendarLinesByPeriod\(rental\.calendarLines\)/, "The operations calendar renders one event per booking and shared rental period");
console.log("Rental photos use each listing's real catalogue images in the inbox, account workspace, and renter chat.");
