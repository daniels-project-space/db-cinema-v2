const assert = require("node:assert/strict");
require("./test-shared-stock-writer-inventory.cjs");
const { load, db, tables } = require("./lib/rentalTestHarness.cjs");

process.env.ADMIN_TOKEN = "swap-authority-fixture";
process.env.RENTAL_ITEM_SWAP_ENABLED = "true";
const state = load("convex/rentalSwapState.ts");
const ctx = { db, scheduler: { runAfter: async () => {} } };
const args = { token: process.env.ADMIN_TOKEN, bookingId: "booking-fixture", lineIndex: 0, newListingId: "listing-fixture" };

(async () => {
  assert.equal(await state.readiness.handler(ctx,{token:process.env.ADMIN_TOKEN}),false,'A feature flag cannot expose the selector without shared authority');
  assert.equal(await state.readiness.handler(ctx,{token:'foreign'}),false,'The readiness check is admin-scoped');
  assert.equal((await state.previewForAdmin.handler(ctx,args)).ok,false,'The selector quote fails closed without shared authority');
  await assert.rejects(state.preview.handler(ctx, args), /temporarily unavailable.*stock coordination/);
  await assert.rejects(state.propose.handler(ctx, { ...args, requestId: "swap-fixture-123456", quoteSnapshot: "fixture", confirmed: true }), /temporarily unavailable.*stock coordination/);
  assert.equal((tables.get("rental_item_swaps") ?? []).length, 0);
  assert.equal((tables.get("reservations") ?? []).length, 0);
  console.log("PASS swap authority: enabling the feature flag alone cannot create a proposal or reservation.");
})().catch(error => { console.error(error); process.exitCode = 1; });
