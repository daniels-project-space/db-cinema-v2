const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");
const { inventory } = require("./admin-auth-inventory.cjs");

const root = path.resolve(__dirname, "..");
const expected = fs.readFileSync(path.join(__dirname, "admin-auth-inventory.txt"), "utf8").trimEnd().split("\n");
const actual = inventory();
const expectedSet = new Set(expected);
const actualSet = new Set(actual);
const added = actual.filter(entry => !expectedSet.has(entry));
const removed = expected.filter(entry => !actualSet.has(entry));
assert.deepEqual({ added, removed }, { added: [], removed: [] }, "Admin migration inventory changed; review and update its baseline before any cutover.");
for (const required of [
  "export convex/adminAuth.ts:verify",
  "export convex/adminAuth.ts:assertAdmin",
  "export convex/accountAdmin.ts:directory",
  "call src/app/api/admin/gaffer-calls/route.ts:adminAuth.verify",
  "route src/app/api/admin/gaffer-calls/route.ts",
]) assert(actualSet.has(required), `Inventory missed ${required}`);
const file = "convex/adminAccountSessionV2.ts";
const source = ts.createSourceFile(file, fs.readFileSync(path.join(root, file), "utf8"), ts.ScriptTarget.Latest, true);
const gate = source.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === "adminSessionMigrationReady");
assert.ok(gate?.body?.statements.length === 1 && ts.isReturnStatement(gate.body.statements[0]) &&
  gate.body.statements[0].expression?.kind === ts.SyntaxKind.FalseKeyword,
  "Do not enable the admin session cutover until every legacy path, identity boundary and external action is migrated and independently verified.");
console.log(`PASS admin migration inventory (${actual.length} entries); the incomplete session cutover remains disabled.`);
