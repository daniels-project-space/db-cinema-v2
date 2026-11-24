const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");
const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");

const root = path.resolve(__dirname, "..");
function loadTs(filename) {
  const resolved = path.resolve(filename.endsWith(".ts") || filename.endsWith(".tsx") ? filename : `${filename}.ts`);
  const module = { exports: {} };
  const code = ts.transpileModule(fs.readFileSync(resolved, "utf8"), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX,
      esModuleInterop: true,
    },
  }).outputText;
  const localRequire = name => name.startsWith(".")
    ? loadTs(path.resolve(path.dirname(resolved), name))
    : require(name);
  new Function("require", "module", "exports", code)(localRequire, module, module.exports);
  return module.exports;
}

const { AdminHandoverSummary } = loadTs(path.join(root, "src/components/admin/AdminHandoverSummary.tsx"));
const rental = {
  fulfilment: "delivery",
  deliveryLegs: "round_trip",
  address: "12 North Road, London, WC2N 5EJ",
  pickupTime: "09:00",
  returnTime: "18:00",
  lineItems: [{ start: Date.UTC(2027, 0, 4), end: Date.UTC(2027, 0, 5), pickupTime: "09:00", returnTime: "18:00" }],
};
let html = renderToStaticMarkup(React.createElement(AdminHandoverSummary, { booking: rental }));
assert.match(html, /Delivery \+ return collection/);
assert.match(html, /12 North Road/);
assert.match(html, /WC2N 5EJ/);
assert.match(html, /Delivery time/);
assert.match(html, /Return collection/);
assert.match(html, /09:00/);
assert.match(html, /18:00/);

html = renderToStaticMarkup(React.createElement(AdminHandoverSummary, {
  booking: { fulfilment: "delivery", deliveryLegs: "one_way", address: "12 North Road, London, WC2N 5EJ", lineItems: rental.lineItems },
}));
assert.match(html, /One-way delivery/);
assert.match(html, /Return to The Grand Building, Trafalgar Square, London, WC2N 5EJ · 18:00/);

html = renderToStaticMarkup(React.createElement(AdminHandoverSummary, {
  booking: { fulfilment: "delivery", address: "12 North Road, London, WC2N 5EJ", lineItems: rental.lineItems },
}));
assert.match(html, /Delivery plan not recorded/, "legacy delivery must not be silently presented as round-trip");

html = renderToStaticMarkup(React.createElement(AdminHandoverSummary, {
  booking: { fulfilment: "delivery", address: "", lineItems: rental.lineItems },
}));
assert.match(html, /Address not recorded/);
assert.match(html, /Not recorded/);

html = renderToStaticMarkup(React.createElement(AdminHandoverSummary, {
  booking: { fulfilment: "pickup", lineItems: rental.lineItems },
}));
assert.match(html, /Trafalgar Square/);
assert.match(html, /Waterstones bookstore/);
assert.doesNotMatch(html, /Delivery address/);

console.log("Admin handover summary: delivery mode, full address/postcode, per-leg times, one-way return and pickup display passed.");
