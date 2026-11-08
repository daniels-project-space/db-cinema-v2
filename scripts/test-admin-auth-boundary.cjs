const assert = require("node:assert/strict");
const { load } = require("./lib/rentalTestHarness.cjs");
const { checkAdminToken, assertAdmin } = load("convex/adminAuth.ts");

(async () => {
  process.env.ADMIN_TOKEN = "fixture-admin";
  assert.equal(checkAdminToken("fixture-admin"), true);
  for (const token of ["", "fixture-admi", "fixture-adminx", "x".repeat(100000)])
    assert.equal(checkAdminToken(token), false);
  const events = [];
  const ctx = { db: { insert: async (...args) => events.push(args) } };
  await assert.rejects(assertAdmin(ctx, "wrong", "fixture"), /unauthorized/);
  assert.equal(events.length, 0, "A failed transaction cannot provide durable audit or throttling");
  await assertAdmin(ctx, "fixture-admin", "fixture");
  assert.equal(events.length, 1);
  process.env.ADMIN_TOKEN = "x".repeat(4097);
  assert.equal(checkAdminToken("x".repeat(4097)), true, "Long configured secrets remain usable");
  delete process.env.ADMIN_TOKEN;
  assert.equal(checkAdminToken(""), false);
  console.log("PASS admin authentication boundary: rejection, successful audit and oversized input handling; no claim of failed-attempt throttling.");
})().catch(error => { console.error(error); process.exitCode = 1; });
