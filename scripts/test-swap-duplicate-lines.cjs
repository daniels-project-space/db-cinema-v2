const assert = require("node:assert/strict");
const { load, db, put, tables, setMock } = require("./lib/rentalTestHarness.cjs");

process.env.ADMIN_TOKEN = "duplicate-swap-owner";
process.env.RENTAL_ITEM_SWAP_ENABLED = "true";
process.env.SHARED_STOCK_BRIDGE_EXPERIMENTAL = "true";
setMock("./lib/rentalChat", { ...load("convex/lib/rentalChat.ts"), postRentalMessage: async () => {} });
setMock("./lib/rentalSwapAuthority", { assertSwapAuthorityAvailable: () => {}, swapAuthorityAvailable: () => true });
const state = load("convex/rentalSwapState.ts");
const ctx = { db, scheduler: { runAfter: async () => {} } };
const account = put("accounts", { email: "duplicate-swap@example.invalid" });
put("sessions", { accountId: account._id, token: "duplicate-renter", expiresAt: Date.now() + 86400000 });
put("rmv2_sync_state", { key: "shared-stock-v1", status: "ok", lastSyncedAt: Date.now(), cursor: JSON.stringify({ checkedAt: Date.now() }) });
const originalUnit = put("inventory_units", { name: "Camera", quantityOwned: 2 });
const replacementUnit = put("inventory_units", { name: "Lens", quantityOwned: 1 });
const original = put("listings", { title: "Camera", active: true, depositAmount: 100, pricing: { daily: 20 }, components: [{ inventoryUnitId: originalUnit._id, qty: 1 }] });
const replacement = put("listings", { title: "Lens", active: true, depositAmount: 100, pricing: { daily: 20 }, components: [{ inventoryUnitId: replacementUnit._id, qty: 1 }] });
const start = Date.UTC(2030, 1, 1), end = start;
const line = { listingId: original._id, title: original.title, start, end, qty: 1, lineTotal: 20 };
const credit = put("credits", { accountId: account._id, kind: "earned", currency: "GBP", amount: 10, remaining: 0 });
const booking = put("bookings", {
  accountId: account._id, guestEmail: account.email, status: "confirmed", subtotal: 40, discount: 0, total: 30, depositAmount: 0,
  pricingVersion: "single-benefit-v1", benefitKind: "earned_credit", lineItems: [{ ...line }, { ...line }],
  creditApplied: 10, membershipCreditApplied: 0, refundCreditApplied: 0, earnedCreditApplied: 10,
  creditAllocations: [{ creditId: credit._id, amount: 10, kind: "earned" }],
  checkoutLineCreditSources: [{ lineIndex: 0, creditId: credit._id, amount: 10, kind: "earned" }],
  checkoutLineFunding: [
    { ...line, gross: 20, discount: 0, membershipCredit: 0, accountCredit: 10, card: 10 },
    { ...line, gross: 20, discount: 0, membershipCredit: 0, accountCredit: 0, card: 20 },
  ],
  replacementValues: [{ listingId: original._id, unitPence: 10000 }],
});
put("reservations", { bookingId: booking._id, listingId: original._id, inventoryUnitId: originalUnit._id, start, end, qty: 2, source: "site", status: "confirmed" });

(async () => {
  const args = { token: process.env.ADMIN_TOKEN, bookingId: booking._id, lineIndex: 1, newListingId: replacement._id };
  const preview = await state.preview.handler(ctx, args);
  assert.equal(preview.quote.deltaPence, 0);
  assert.equal(preview.quote.nextFunding.accountCredit, 0);
  assert.deepEqual(preview.quote.nextAllCreditSources, [{ lineIndex: 0, creditId: credit._id, amount: 10, kind: "earned" }]);
  const id = await state.propose.handler(ctx, { ...args, requestId: "duplicate-unit-swap-123456", quoteSnapshot: preview.quoteSnapshot, confirmed: true });
  await state.accept.handler(ctx, { token: "duplicate-renter", id, expectedDeltaPence: 0 });
  require('./lib/rentalTestHarness.cjs').confirmSyntheticSwapStock(id);
  assert((await state.apply.handler(ctx, { id })).applied);
  assert.deepEqual(booking.lineItems.map(item => item.listingId), [original._id, replacement._id]);
  assert.deepEqual(booking.checkoutLineFunding.map(item => [item.listingId, item.accountCredit, item.card]), [[original._id, 10, 10], [replacement._id, 0, 20]]);
  assert.deepEqual(booking.checkoutLineCreditSources, [{ lineIndex: 0, creditId: credit._id, amount: 10, kind: "earned" }]);
  const confirmed = tables.get("reservations").filter(row => row.bookingId === booking._id && row.status === "confirmed");
  assert.deepEqual(confirmed.map(row => [row.inventoryUnitId, row.qty]).sort(), [[originalUnit._id, 1], [replacementUnit._id, 1]].sort());
  const receipt = tables.get("swap_stock_applied_receipts").find(row => row.swapId === id);
  assert.equal(receipt.bookingId, booking._id);
  assert.equal(receipt.bookingRevision, booking.rmv2Revision);
  assert.equal(receipt.executionKey, `swap_execution_${id}`);
  assert.deepEqual(receipt.windows.map(row => [row.reservationId, row.inventoryUnitId, row.quantity]).sort(), confirmed.map(row => [row._id, row.inventoryUnitId, row.qty]).sort());
  assert((await state.apply.handler(ctx, { id })).already);
  assert.equal(tables.get("swap_stock_applied_receipts").filter(row => row.swapId === id).length, 1);
  console.log("PASS duplicate checkout lines: one-unit replacement, exact member credit and stock preserved with retry");
})().catch(error => { console.error(error); process.exitCode = 1; });
