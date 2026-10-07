const assert = require("node:assert/strict");
const { load, db, put } = require("./lib/rentalTestHarness.cjs");
const admin = load("convex/accountAdmin.ts");
process.env.ADMIN_TOKEN = "fixture-admin";
let scans = 0, avatarReads = 0;
const ctx = { db: { ...db, query(table) { scans++; return db.query(table); } }, storage: { getUrl: async () => { avatarReads++; return "https://example.invalid/avatar"; } } };
const old = put("accounts", { email: "older+camera@example.invalid", name: "Older Cinematographer", createdAt: 1, adminMembershipTier: "pro", avatarStorageId: "old-avatar", rentalVerification: { expiresAt: Date.now() + 100000 }, hash: "private-hash", stripeCustomerId: "private-provider" });
for (let i = 0; i < 220; i++) put("accounts", { email: `customer${i}@example.invalid`, name: `Customer ${i}`, createdAt: i + 2, idVerified: true, ...(i === 3 ? { rentalVerification: { expiresAt: 1 } } : {}) });
async function find(search, filter = "all", tier = "all") {
 let cursor = null, pageCount = 0; const rows = [];
 do {
  const result = await admin.directory.handler(ctx, { token: "fixture-admin", search, filter, tier, paginationOpts: { numItems: 100, cursor } });
  pageCount++; rows.push(...result.page);
  if (result.isDone) break;
  assert.notEqual(result.continueCursor, cursor); cursor = result.continueCursor;
  assert.ok(pageCount <= 3, "a sparse search must finish at the real end of the directory");
 } while (true);
 return { rows, pageCount };
}
(async () => {
 const denied = await admin.directory.handler(ctx, { token: "wrong", search: "", filter: "all", tier: "all", paginationOpts: { numItems: 100, cursor: null } });
 assert.deepEqual(denied, { page: [], isDone: true, continueCursor: "" }); assert.equal(scans, 0); assert.equal(avatarReads, 0);
 assert.equal(await admin.directoryAccess.handler(ctx, { token: "wrong" }), false);
 const all = await find(""); assert.equal(all.rows.length, 221); assert.equal(new Set(all.rows.map(a => a.id)).size, 221);
 assert.equal(all.rows.at(-1).id, old._id); assert.equal(all.pageCount, 3);
 const byName = await find("  CINEMATOGRAPHER  ", "members", "pro"); assert.equal(byName.pageCount, 3); assert.equal(byName.rows.length, 1); assert.equal(byName.rows[0].id, old._id);
 assert.deepEqual((await find("camera@EXAMPLE")).rows.map(a => a.id), [old._id]);
 assert.equal(JSON.stringify(byName.rows).includes("private-hash"), false); assert.equal(JSON.stringify(byName.rows).includes("private-provider"), false);
 assert.equal((await find("Cinematographer", "pending")).rows.length, 0);
 const pending = await find("", "pending"); assert.equal(pending.rows.length, 1); assert.equal(pending.rows[0].email, "customer3@example.invalid");
 for (const size of [0, 101, 1.5]) await assert.rejects(admin.directory.handler(ctx, { token: "fixture-admin", search: "", filter: "all", tier: "all", paginationOpts: { numItems: size, cursor: null } }), /page size/);
 console.log("PASS full customer directory: bounded cursors, older name/email matches, sparse pages, live membership/verification filters, no duplicate accounts and admin-only safe projection.");
})().catch(error => { console.error(error); process.exitCode = 1; });
