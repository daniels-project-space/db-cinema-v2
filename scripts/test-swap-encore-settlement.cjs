const assert = require("node:assert/strict");
const { load, db, put, setMock } = require("./lib/rentalTestHarness.cjs");
process.env.ADMIN_TOKEN = "encore-swap-owner";
process.env.RENTAL_ITEM_SWAP_ENABLED = "true";
process.env.SHARED_STOCK_BRIDGE_EXPERIMENTAL = "true";
setMock("./lib/rentalChat", { ...load("convex/lib/rentalChat.ts"), postRentalMessage: async () => {} });
setMock("./lib/rentalSwapAuthority", { assertSwapAuthorityAvailable: () => {}, swapAuthorityAvailable: () => true });
const state = load("convex/rentalSwapState.ts");
const ctx = { db, scheduler: { runAfter: async () => {} } };
async function markRefundSucceeded(swapId, refund, amountPence = refund.amountPence) {
  const paymentIntentId = `pi_refund_${swapId}`;
  await db.patch(refund._id, { amountPence, allocations: [{ paymentIntentId, amountPence }], parts: [{ paymentIntentId, stripeRefundId: `re_${swapId}`, amountPence, status: "succeeded" }], status: "succeeded" });
}
const account = put("accounts", { email: "encore-swap@example.invalid" });
put("sessions", { accountId: account._id, token: "encore-renter", expiresAt: Date.now() + 86400000 });
put("rmv2_sync_state", { key: "shared-stock-v1", status: "ok", lastSyncedAt: Date.now(), cursor: JSON.stringify({ checkedAt: Date.now() }) });
const oldUnit = put("inventory_units", { name: "Old camera", quantityOwned: 1 });
const newUnit = put("inventory_units", { name: "New camera", quantityOwned: 1 });
const old = put("listings", { title: "Old camera", active: true, depositAmount: 100, pricing: { daily: 100 }, components: [{ inventoryUnitId: oldUnit._id, qty: 1 }] });
const next = put("listings", { title: "New camera", active: true, depositAmount: 100, pricing: { daily: 50 }, components: [{ inventoryUnitId: newUnit._id, qty: 1 }] });
const start = Date.UTC(2030, 1, 1), line = { listingId: old._id, title: old.title, start, end: start, qty: 1, lineTotal: 100 };
const booking = put("bookings", { accountId: account._id, guestEmail: account.email, status: "confirmed", subtotal: 100, discount: 10, total: 90, depositAmount: 0,
  pricingVersion: "single-benefit-v1", benefitKind: "loyalty", swapBenefitRule: { version: "encore-percent-v1", percent: 10 },
  lineItems: [line], checkoutLineFunding: [{ listingId: old._id, start, end: start, qty: 1, gross: 100, discount: 10, membershipCredit: 0, accountCredit: 0, card: 90 }],
  checkoutLineCreditSources: [], creditAllocations: [], replacementValues: [{ listingId: old._id, unitPence: 10000 }] });
put("reservations", { bookingId: booking._id, listingId: old._id, inventoryUnitId: oldUnit._id, start, end: start, qty: 1, source: "site", status: "confirmed" });

(async () => {
  const args = { token: process.env.ADMIN_TOKEN, bookingId: booking._id, lineIndex: 0, newListingId: next._id };
  const preview = await state.preview.handler(ctx, args);
  assert.equal(preview.quote.deltaPence, -4500);
  const id = await state.propose.handler(ctx, { ...args, requestId: "encore-swap-settlement-12345", quoteSnapshot: preview.quoteSnapshot, confirmed: true });
  const swap = await db.get(id);
  swap.quote = Object.fromEntries(Object.entries(swap.quote).reverse());
  swap.quote.nextFunding = Object.fromEntries(Object.entries(swap.quote.nextFunding).reverse());
  swap.oldLine = Object.fromEntries(Object.entries(swap.oldLine).reverse());
  await state.accept.handler(ctx, { token: "encore-renter", id, confirmed:true,expectedDeltaPence: -4500 });
  require('./lib/rentalTestHarness.cjs').confirmSyntheticSwapStock(id);
  const refund = await state.prepareRefund.handler(ctx, { id });
  const refundAmountPence = refund.amountPence;
  assert.equal(refundAmountPence, 4500);
  await assert.rejects(state.apply.handler(ctx, { id, stageRefund: true }), /cannot be applied before its refund succeeds/);
  assert.equal(booking.lineItems[0].listingId, old._id);
  assert.equal(booking.subtotal, 100);
  await markRefundSucceeded(id, refund, refundAmountPence);
  await db.patch(refund._id, { amountPence: refund.amountPence - 1 });
  await assert.rejects(state.apply.handler(ctx, { id }), /exact equipment refund must succeed/);
  assert.equal(booking.lineItems[0].listingId, old._id, "an inexact Stripe refund receipt cannot commit the downgrade");
  assert.equal(booking.total, 90);
  await markRefundSucceeded(id, refund, refundAmountPence);
  // The renter accepted the exact discounted plan before the provider refund.
  // Later membership-rule changes must not reprice that accepted settlement.
  booking.swapBenefitRule.percent = 4;
  assert.equal(swap.settlementPlan.nextDiscountPence, 500);
  const originalBookingLine=booking.lineItems[0];
  booking.lineItems[0]={...originalBookingLine,title:'Changed original'};
  await assert.rejects(state.apply.handler(ctx, { id }), /accepted equipment settlement plan or original rental changed/);
  booking.lineItems[0]=originalBookingLine;
  assert((await state.apply.handler(ctx, { id })).applied);
  assert.equal(booking.subtotal, 50);
  assert.equal(booking.discount, 5);
  assert.equal(booking.total, 90, "The original charged total remains immutable; its downgrade refund is recorded separately");
  assert.equal(booking.checkoutLineFunding[0].card, 45);
  assert.equal(booking.checkoutLineFunding[0].discount, 5);
  assert.equal(booking.lineItems[0].listingId, next._id);
  assert((await state.apply.handler(ctx, { id })).already);
  assert.equal(booking.discount, 5, "Retry does not apply the discount change twice");
  const unitA = put("inventory_units", { name: "Small item", quantityOwned: 1 });
  const unitB = put("inventory_units", { name: "Camera body", quantityOwned: 1 });
  const unitC = put("inventory_units", { name: "Replacement", quantityOwned: 1 });
  const itemA = put("listings", { title: "Small item", active: true, depositAmount: 100, pricing: { daily: 1 }, components: [{ inventoryUnitId: unitA._id, qty: 1 }] });
  const itemB = put("listings", { title: "Camera body", active: true, depositAmount: 100, pricing: { daily: 99 }, components: [{ inventoryUnitId: unitB._id, qty: 1 }] });
  const itemC = put("listings", { title: "Replacement", active: true, depositAmount: 100, pricing: { daily: 2 }, components: [{ inventoryUnitId: unitC._id, qty: 1 }] });
  const itemLine = (item, amount) => ({ listingId: item._id, title: item.title, start, end: start, qty: 1, lineTotal: amount });
  const refundCredit=put("credits",{accountId:account._id,kind:"refund",currency:"GBP",amount:20,remaining:0});
  const multi = put("bookings", { accountId: account._id, guestEmail: account.email, status: "confirmed", subtotal: 100, discount: 10, total: 70, depositAmount: 0, creditApplied: 20, membershipCreditApplied: 0, refundCreditApplied: 20, earnedCreditApplied: 0,
    pricingVersion: "single-benefit-v1", benefitKind: "loyalty", swapBenefitRule: { version: "encore-percent-v1", percent: 10 },
    lineItems: [itemLine(itemA, 1), itemLine(itemB, 99)], checkoutLineFunding: [
      { listingId: itemA._id, start, end: start, qty: 1, gross: 1, discount: 1, membershipCredit: 0, accountCredit: 0, card: 0 },
      { listingId: itemB._id, start, end: start, qty: 1, gross: 99, discount: 9, membershipCredit: 0, accountCredit: 20, card: 70 },
    ], checkoutLineCreditSources: [{lineIndex:1,creditId:refundCredit._id,kind:"refund",amount:20}], creditAllocations: [{creditId:refundCredit._id,kind:"refund",amount:20}], replacementValues: [{ listingId: itemA._id, unitPence: 10000 }, { listingId: itemB._id, unitPence: 10000 }] });
  for (const [item, unit] of [[itemA, unitA], [itemB, unitB]]) put("reservations", { bookingId: multi._id, listingId: item._id, inventoryUnitId: unit._id, start, end: start, qty: 1, source: "site", status: "confirmed" });
  const multiArgs = { token: process.env.ADMIN_TOKEN, bookingId: multi._id, lineIndex: 1, newListingId: itemC._id }, multiPreview = await state.preview.handler(ctx, multiArgs);
  assert.equal(multiPreview.quote.deltaPence, -7000);
  const multiId = await state.propose.handler(ctx, { ...multiArgs, requestId: "encore-multiline-settlement", quoteSnapshot: multiPreview.quoteSnapshot, confirmed: true });
  await state.accept.handler(ctx, { token: "encore-renter", id: multiId, confirmed:true,expectedDeltaPence: -7000 });
  require('./lib/rentalTestHarness.cjs').confirmSyntheticSwapStock(multiId);
  assert.equal((await state.prepareRefund.handler(ctx,{id:multiId})).amountPence,7000);
  const multiRefund = await state.prepareRefund.handler(ctx, { id: multiId });
  await markRefundSucceeded(multiId, multiRefund);
  assert((await state.apply.handler(ctx, { id: multiId })).applied);
  assert.equal(multi.discount, 0.3);
  assert.equal(multi.creditApplied,2.7);
  assert.deepEqual(multi.checkoutLineFunding.map(row => [row.discount, row.accountCredit, row.card]), [[0.3,0.7,0], [0,2,0]]);
  assert.deepEqual(multi.checkoutLineCreditSources.map(row=>[row.lineIndex,row.creditId,row.amount]),[[0,refundCredit._id,0.7],[1,refundCredit._id,2]]);
  assert.deepEqual(multi.lineItems.map(row => row.listingId), [itemA._id, itemC._id]);
  assert((await state.apply.handler(ctx, { id: multiId })).already);
  console.log("PASS swap Encore settlement: frozen discount, exact refund-first commit, drift guard and retry");
})().catch(error => { console.error(error); process.exitCode = 1; });
