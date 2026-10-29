const assert = require("node:assert/strict");
const fs = require("node:fs");
const ts = require("typescript");
const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");

const source = fs.readFileSync("src/components/cart/EmailedCart.tsx", "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: {
  module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX,
} }).outputText;
const fixtures = [
  { key: "one-day", title: "RØDE kit", start: "2030-11-20", end: "2030-11-20", pickupTime: "10:00", returnTime: "18:00", total: 42 },
  { key: "two-day", title: "DJI kit", start: "2030-11-20", end: "2030-11-21", pickupTime: "10:00", returnTime: "18:00", total: 30 },
  { key: "legacy", title: "Older cart", start: "2030-11-20", end: "2030-11-20", total: 10 },
];
const mocks = {
  "./CheckoutStatus": { useCheckoutStatus: () => ({ enabled: true }), CheckoutPauseNotice: () => null },
  "convex/react": { useQuery: () => ({ items: fixtures, available: true }) },
  "next/navigation": { useRouter: () => ({ push() {} }) },
  "@cvx/_generated/api": { api: { checkoutCartData: { get: "get" } } },
  "@/components/SiteHeader": { SiteHeader: () => null },
  "./CartProvider": { useCart: () => ({ replace() {}, setMembership() {}, setPromo() {} }) },
  "@/lib/pricing": { formatGbp: value => `£${value}` },
};
const mod = { exports: {} };
new Function("require", "module", "exports", compiled)(name => mocks[name] ?? require(name), mod, mod.exports);
const html = renderToStaticMarkup(React.createElement(mod.exports.EmailedCart, { shareKey: "fixture" }));
assert.match(html, /2030-11-20 at 10:00 → 2030-11-20 at 18:00/);
assert.match(html, /2030-11-20 at 10:00 → 2030-11-21 at 18:00/);
assert.match(html, /2030-11-20 → 2030-11-20/);
assert(!html.includes("undefined"));
process.stdout.write("PASS emailed basket renders each item's own dates and times.\n");
