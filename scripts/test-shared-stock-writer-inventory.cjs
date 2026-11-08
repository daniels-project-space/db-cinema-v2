const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");
const { load } = require("./lib/rentalTestHarness.cjs");
const { swapAuthorityAvailable } = load("convex/lib/rentalSwapAuthority.ts");

const root = path.resolve(__dirname, "..");
const expected = [
  "convex/bookings.ts:attachAddon",
  "convex/bookings.ts:confirm",
  "convex/bookings.ts:confirm",
  "convex/bookings.ts:placeHolds",
  "convex/changes.ts:_applyReschedule",
  "convex/lib/rentalSwapStock.ts:applySwapBasketStock",
  "convex/lib/rentalSwapStock.ts:applySwapStock",
  "convex/lib/rentalSwapStock.ts:reserveSwapBasketStock",
  "convex/lib/rentalSwapStock.ts:reserveSwapStock",
  "convex/rentalAdditionState.ts:prepare",
  "convex/rentalExtensions.ts:applyPaid",
  "convex/rentalExtensions.ts:prepare",
  "convex/rentalOperations.ts:changeHandoverTimes",
  "convex/rentalOperations.ts:changePickupTime",
  "convex/rentalOperations.ts:removeItem",
  "convex/rentalOperations.ts:reschedule",
  "convex/rentalReplacements.ts:accept",
  "convex/rentalReplacements.ts:acceptBasket",
  "convex/sync.ts:applySharedStock",
];

const gateKeys = ["SHARED_STOCK_AUTHORITY_READY", "SHARED_STOCK_BRIDGE_EXPERIMENTAL", "RMV2_WEBHOOK_URL", "SHARED_STOCK_WEBSITE_SECRET"];
const savedGate = Object.fromEntries(gateKeys.map(key => [key, process.env[key]]));
function restoreGate() {
  for (const key of gateKeys) savedGate[key] === undefined ? delete process.env[key] : process.env[key] = savedGate[key];
}

function inventory(directory) {
  const found = [];
  for (const entry of fs.readdirSync(path.join(root, directory), { withFileTypes: true })) {
    if (entry.name === "_generated") continue;
    const relative = path.posix.join(directory, entry.name);
    if (entry.isDirectory()) {
      found.push(...inventory(relative));
      continue;
    }
    if (!entry.name.endsWith(".ts")) continue;
    const source = ts.createSourceFile(relative, fs.readFileSync(path.join(root, relative), "utf8"), ts.ScriptTarget.Latest, true);
    function visit(node) {
      if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) &&
          node.expression.name.text === "insert" && node.expression.expression.getText(source).endsWith(".db")) {
        const table = node.arguments[0];
        assert.ok(table && ts.isStringLiteral(table), `${relative}: dynamic insert table requires a stock-writer review`);
        if (table.text === "reservations") {
          let owner = node.parent;
          while (owner && !ts.isVariableDeclaration(owner) && !ts.isFunctionDeclaration(owner)) owner = owner.parent;
          assert.ok(owner && owner.name && ts.isIdentifier(owner.name), `${relative}: unnamed reservation writer requires review`);
          found.push(`${relative}:${owner.name.text}`);
        }
      }
      ts.forEachChild(node, visit);
    }
    visit(source);
  }
  return found;
}

assert.deepEqual(inventory("convex").sort(), expected.sort(), "Reservation insertion sites changed: review every writer before changing the shared-stock gate.");
try {
  for (const key of gateKeys) delete process.env[key];
  assert.equal(swapAuthorityAvailable(), false, "No settings must keep swap authority closed.");
  process.env.SHARED_STOCK_AUTHORITY_READY = "enabled";
  assert.equal(swapAuthorityAvailable(), false, "Readiness alone cannot enable an incomplete bridge.");
  process.env.SHARED_STOCK_BRIDGE_EXPERIMENTAL = "true";
  process.env.RMV2_WEBHOOK_URL = "https://fixture-manager.convex.site/dbcinema/booking-sync";
  process.env.SHARED_STOCK_WEBSITE_SECRET = "synthetic-stock-secret-at-least-32-characters";
  assert.equal(swapAuthorityAvailable(), true, "A fully configured, explicitly enabled Manager bridge may be activated.");
  process.env.RMV2_WEBHOOK_URL = "https://fixture-manager.convex.site.evil.test/dbcinema/booking-sync";
  assert.equal(swapAuthorityAvailable(), false, "An untrusted Manager hostname must fail closed.");
} finally {
  restoreGate();
}
console.log("PASS shared stock writer inventory and explicit, fail-closed authority configuration.");
