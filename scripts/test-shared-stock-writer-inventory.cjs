const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");

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
const gate = fs.readFileSync(path.join(root, "convex/lib/rentalSwapAuthority.ts"), "utf8");
const source = ts.createSourceFile("rentalSwapAuthority.ts", gate, ts.ScriptTarget.Latest, true);
const available = source.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === "swapAuthorityAvailable");
assert.ok(available && available.body && available.body.statements.length === 1 && ts.isReturnStatement(available.body.statements[0]) && available.body.statements[0].expression?.kind === ts.SyntaxKind.FalseKeyword, "Do not enable the swap gate until all stock writers and external sources are integrated and the gate tests are replaced with end-to-end evidence.");
console.log("PASS shared stock writer inventory: direct reservation inserts are reviewed and swap authority stays disabled.");
