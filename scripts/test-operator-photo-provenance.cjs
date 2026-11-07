const assert = require("node:assert/strict");
const { load, db, put } = require("./lib/rentalTestHarness.cjs");
const operators = load("convex/operators.ts");
const legacy = put("operators", { firstName: "Legacy", active: true, order: 1, headshot: "https://private.invalid/file" });
put("collective_applications", { operatorId: legacy._id, status: "approved", email: "legacy@example.invalid", headshotStorageId: "private-id" });
const local = put("operators", { firstName: "Seed", active: true, order: 2, headshot: "/crew/headshots/seed.jpg" });
let reads = 0;
const ctx = { db: { ...db, query(table) { const query = db.query(table); const withIndex = query.withIndex; query.withIndex = (name, fn) => withIndex(name, fn ?? (builder => builder)); return query; } }, storage: { getUrl: async () => { reads++; return "https://private.invalid/file"; } } };
(async () => {
  const rows = await operators.list.handler(ctx, {});
  assert.equal(rows.find(row => row._id === legacy._id).headshot, null);
  assert.equal(rows.find(row => row._id === local._id).headshot, "/crew/headshots/seed.jpg");
  assert.equal(reads, 0, "unproven application files must not be resolved");
  console.log("PASS legacy collective photos are not resolved or published; local seed photos remain visible");
})().catch(error => { console.error(error); process.exitCode = 1; });
