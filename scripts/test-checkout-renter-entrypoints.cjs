const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");

const root = path.resolve(__dirname, "..");
const read = file => fs.readFileSync(path.join(root, file), "utf8");
const checkout = read("src/app/checkout/page.tsx");
const bookingPanel = read("src/components/booking/BookingPanel.tsx");
const cartPage = read("src/app/cart/page.tsx");
const cartDrawer = read("src/components/cart/CartDrawer.tsx");
const cartDates = read("src/components/cart/CartItemDates.tsx");
const cartStockNotice = read("src/components/cart/CartStockNotice.tsx");
const cartProvider = read("src/components/cart/CartProvider.tsx");
const recommendations = read("src/components/Recommendations.tsx");
const kitCompatibility = read("src/components/cart/KitCompatibility.tsx");
const assemblyPage = read("src/app/assemble/page.tsx");
const gafferTools = read("src/components/gaffer/useGafferTools.ts");
const botBubble = read("src/components/BotBubble.tsx");

function sourceFilesUnder(directory) {
  return fs.readdirSync(path.join(root, directory), { withFileTypes: true }).flatMap(entry => {
    const relative = path.join(directory, entry.name);
    if (entry.isDirectory()) return sourceFilesUnder(relative);
    return /\.(?:tsx?|jsx?)$/.test(entry.name) ? [relative] : [];
  });
}

const renterCheckoutSurfaces = [
  ...sourceFilesUnder("src/components/cart"),
  ...sourceFilesUnder("src/components/checkout"),
  ...sourceFilesUnder("src/app/cart"),
  ...sourceFilesUnder("src/app/checkout"),
  ...sourceFilesUnder("src/app/plan"),
  "src/components/booking/BookingPanel.tsx",
  "src/components/plans/RecoveryBasket.tsx",
];
const obsoleteCheckoutCopy = [
  "Stock matching for this item isn't confirmed yet. Add it as a request; checkout blocks payment until the live stock check passes.",
  "Date-based estimate. Confirm exact times and final price at checkout; delivery is quoted separately.",
  "Saved-card future-claim ceiling. No cash deposit or card hold. Stripe saves your card for itemised late-return charges and severe, permanent cosmetic damage or loss, with a £50, £100 or £200 combined ceiling based on equipment replacement value. No charge on an on-time return without a reported issue; insurance is separate. The saved-card ceiling is not charged or held. Stripe or your bank may decline a later payment or require authentication; checkout shows the exact amount and terms.",
];
for (const file of renterCheckoutSurfaces) {
  const source = read(file);
  for (const copy of obsoleteCheckoutCopy) {
    assert.ok(!source.includes(copy), `${file} does not render obsolete checkout copy: ${copy.slice(0, 72)}`);
  }
}

const addToKit = bookingPanel.slice(bookingPanel.indexOf("function addToKit()"), bookingPanel.indexOf("return (", bookingPanel.indexOf("function addToKit()")));
assert.match(addToKit, /cart\.add\(/, "Listing booking adds the item to the basket");
assert.doesNotMatch(addToKit, /pickupTime|returnTime/, "Adding an item does not request or persist exact handover times");
assert.match(bookingPanel, /Exact pickup and return times are chosen at checkout\./, "Listing page tells renters when exact times are selected");
assert.doesNotMatch(bookingPanel, /Date-based estimate\. Confirm exact times and final price at checkout; delivery is quoted separately\./, "Listing panel avoids duplicated date-estimate copy");
assert.doesNotMatch(bookingPanel, /Saved-card future-claim ceiling|No cash deposit or hold is taken/, "Listing panel leaves long security terms for the accepted checkout agreement");
assert.match(bookingPanel, /The exact amount and terms are shown in checkout before you pay\./, "Listing panel points renters to the authoritative security terms");
assert.doesNotMatch(bookingPanel, /Stock matching for this item isn't confirmed yet/, "Listing panel uses short availability guidance rather than the obsolete full paragraph");
assert.match(cartStockNotice, /Exact pickup and return times are set at checkout\./, "Basket explains where times are chosen without item-by-item prompts");
assert.doesNotMatch(cartStockNotice, /Choose pickup and return times for|availability checks automatically/, "Basket does not repeat the removed item-specific time prompt");

for (const [name, source] of [["cart page", cartPage], ["cart drawer", cartDrawer], ["date editor", cartDates]]) {
  assert.doesNotMatch(source, /CartItemTimes|TimeSlotPicker|data-checkout-item-times/, `${name} does not render exact time controls`);
}
assert.match(checkout, /import \{ CartItemTimes \} from "@\/components\/cart\/CartItemTimes"/, "Checkout owns the exact time controls");
assert.match(checkout, /<CartItemTimes\b/, "Checkout renders the exact time controls for basket items");
assert.match(cartProvider, /dateOnlyCartEntry\(item\)/, "The shared cart-add boundary strips clocks from every add source");
assert.match(cartProvider, /\.\.\.dateOnlyItem, key/, "New basket rows persist dates only, even if a caller supplies times");
for (const [name, source] of [["recommendation add", recommendations], ["kit-compatibility add", kitCompatibility], ["assembly add", assemblyPage], ["Gaffer add", gafferTools]]) {
  assert.match(source, /cart\.add\(/, `${name} is included in the cart-entry audit`);
}
const cartEntrySource = read("shared/cartEntry.ts");
assert.match(cartEntrySource, /delete entry\.pickupTime;[\s\S]*delete entry\.returnTime;/, "The shared entry normalizer removes both exact handover clocks");
const cartEntryModule = { exports: {} };
new Function("module", "exports", ts.transpileModule(cartEntrySource, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText)(cartEntryModule, cartEntryModule.exports);
const normalizedEntry = cartEntryModule.exports.dateOnlyCartEntry({ listingId: "sony-fx3", start: "2030-11-06", end: "2030-11-06", pickupTime: "10:00", returnTime: "18:00" });
assert.deepEqual(normalizedEntry, { listingId: "sony-fx3", start: "2030-11-06", end: "2030-11-06" }, "Even recommendation/Gaffer callers with suggested clocks create an untimed cart row");
assert.match(botBubble, /checkoutTimeCheckPending/, "Gaffer can add a dated item without exact clocks and defers its stock check to checkout");
assert.doesNotMatch(botBubble, /Choose dates and times/, "Gaffer does not ask renters for exact times before checkout");
assert.match(checkout, /Pick up in Trafalgar Square/, "Checkout exposes the pickup location to assistive technology");
assert.match(checkout, /In Trafalgar Square/, "Checkout visibly names the pickup area");
assert.match(checkout, /Delivery, quoted by distance/, "Delivery remains a distinct fulfilment choice");

process.stdout.write("PASS checkout renter entrypoints: add-to-kit and basket stay date-only; exact times and fulfilment controls are selected in checkout.\n");
