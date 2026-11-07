const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");

const sourcePath = path.join(__dirname, "../shared/gafferBookingContext.ts");
const sourceText = fs.readFileSync(sourcePath, "utf8");
const compiled = ts.transpileModule(sourceText, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText;
const loadedModule = { exports: {} };
new Function("exports", "module", compiled)(loadedModule.exports, loadedModule);

const { buildGafferRenterBookingFacts, gafferNeedsRenterBookingContext } = loadedModule.exports;
const renterFacts = buildGafferRenterBookingFacts([
  {
    _id: "private-internal-id",
    at: 2,
    status: "pending_verification",
    idVerifyStatus: "pending",
    address: "PRIVATE HOME ADDRESS",
    total: 900,
    depositHoldAmount: 200,
    pickupTime: "10:00",
    returnTime: "18:00",
    lineItems: [{ title: "Sony FX3", qty: 1, start: "2026-11-07", end: "2026-11-08" }],
  },
  { at: 1, status: "returned", idVerifyStatus: "verified", lineItems: [{ title: "Sony 24-70mm", start: "2026-10-01", end: "2026-10-02" }] },
]);

assert.equal(renterFacts.length, 2);
assert.match(renterFacts[0], /awaiting verification and not confirmed/);
assert.match(renterFacts[0], /Sony FX3/);
assert.match(renterFacts[0], /2026-11-07 to 2026-11-08/);
assert.match(renterFacts[0], /pickup 10:00; return 18:00/);
assert.match(renterFacts[0], /Verification state: in progress/);
assert.doesNotMatch(renterFacts.join("\n"), /private-internal-id|PRIVATE HOME ADDRESS|900|200/);
assert.equal(gafferNeedsRenterBookingContext([{ role: "user", content: "Can you check my booking status?" }]), true);
assert.equal(gafferNeedsRenterBookingContext([{ role: "assistant", content: "Your rental is confirmed." }]), false);
assert.equal(gafferNeedsRenterBookingContext([{ role: "user", content: "What camera should I use for a night shoot?" }]), false);
assert.equal(buildGafferRenterBookingFacts(null).length, 0);

const contactSource = fs.readFileSync(path.join(__dirname, "../src/components/gaffer/OpenGafferChat.tsx"), "utf8");
const chatSource = fs.readFileSync(path.join(__dirname, "../src/components/BotBubble.tsx"), "utf8");
assert.match(contactSource, /label: "Build a kit"/);
assert.match(contactSource, /label: "Check dates"/);
assert.match(contactSource, /label: "Get a quote"/);
assert.match(contactSource, /label: "My booking"/);
assert.match(contactSource, /openGaffer\(action\.prompt\)/);
assert.match(contactSource, /detail: \{ prompt \}/);
assert.match(chatSource, /detail\?\.prompt/);
assert.match(chatSource, /setText\(\(current\) => current\.trim\(\) \? current : prompt\.trim\(\)\)/);

console.log("PASS Gaffer booking facts stay account-scoped and exclude payment/address/internal IDs; contact quick starts open editable, wired chat prompts.");
