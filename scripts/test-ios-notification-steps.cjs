const assert = require("node:assert/strict");
const Module = require("node:module");
const path = require("node:path");
const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
const { buildSync } = require("esbuild");

const filename = path.resolve("src/components/account/IosNotificationSteps.tsx");
const result = buildSync({ entryPoints: [filename], bundle: true, platform: "node", format: "cjs", external: ["react"], loader: { ".module.css": "empty" }, write: false });
const fixture = new Module(filename, module);
fixture.filename = filename;
fixture.paths = Module._nodeModulePaths(path.dirname(filename));
fixture._compile(result.outputFiles[0].text, filename);
const { IosNotificationSteps } = fixture.exports;
const renter = renderToStaticMarkup(React.createElement(IosNotificationSteps));
const admin = renderToStaticMarkup(React.createElement(IosNotificationSteps, { admin: true }));
for (const html of [renter, admin]) {
  for (const phrase of ["Safari", "Share", "Add to Home Screen", "Edit Actions", "Open as Web App", "Allow"]) assert.ok(html.includes(phrase), phrase);
  assert.equal((html.match(/<li>/g) || []).length, 4);
  assert.equal((html.match(/<svg/g) || []).length, 2);
}
assert.ok(renter.includes("Enable notifications"));
assert.ok(admin.includes("Phone alerts"));
console.log("PASS iPhone notification setup: shared visual steps, Safari variations, permission, renter and admin directions.");
