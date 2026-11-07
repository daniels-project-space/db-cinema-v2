const assert = require('node:assert/strict');
const {load, db, put, setMock} = require('./lib/rentalTestHarness.cjs');
const alerts = [], messages = [], emails = [];
setMock('./lib/adminPush', {queueOwnerNotification: async (_ctx, args) => alerts.push(args)});
setMock('./lib/rentalChat', {postRentalMessage: async (_ctx, args) => messages.push(args)});
setMock('./lib/rentalAllocation', {assertRentalAllocation: async () => {}});
const audit = load('convex/swapStockAudit.ts');
const fence = load('convex/lib/swapStockFence.ts');
const account = put('accounts', {email: 'fixture@example.invalid'});
const booking = put('bookings', {accountId: account._id, status: 'confirmed', idVerifyStatus: 'verified', idVerifiedAt: Date.now(), rmv2Revision: 1, rmv2DeliveredRevision: 1, rmv2SyncStatus: 'delivered'});
const swap = put('rental_item_swaps', {bookingId: booking._id, accountId: account._id, status: 'applied', oldLine: {title: 'Camera', qty: 1}, newLine: {title: 'Lens', qty: 1}});
const unit = put('inventory_units', {rmv2ItemId: 'synthetic-manager-item'});
const reservation = put('reservations', {bookingId: booking._id, inventoryUnitId: unit._id, source: 'site', status: 'confirmed', start: 10, end: 20, qty: 1, endExclusive: true, turnaroundBufferMinutes: 60});
const receipt = put('swap_stock_applied_receipts', {swapId: swap._id, bookingId: booking._id, bookingRevision: 1, managerRequestId: 'synthetic-claim', fingerprint: 'fingerprint', executionKey: 'execution', appliedAt: 1, deliveryState: 'acknowledged', stockRisk: false, auditDueAt: Date.now() - 1, windows: [{reservationId: reservation._id, inventoryUnitId: unit._id, managerItemId: unit.rmv2ItemId, start: 10, end: 20, quantity: 1, endExclusive: true, turnaroundBufferMinutes: 60}]});
const ctx = {db, scheduler: {runAfter: async (_delay, ref, args) => emails.push({ref, args})}};

(async () => {
  for (let attempt = 1; attempt <= 3; attempt++) {
    receipt.auditDueAt = Date.now() - 1;
    const token = `attempt-${attempt}`;
    assert.ok(await audit.claim.handler(ctx, {id: receipt._id, token}));
    await audit.record.handler(ctx, {id: receipt._id, token, result: {status: 'confirmed', result: {}}});
    assert.equal(receipt.auditAttempts, attempt);
    assert.ok(receipt.auditDueAt > Date.now());
  }
  assert.equal(receipt.stockRisk, true);
  assert.equal(booking.activeItemSwapId, swap._id);
  assert.ok(alerts.some(alert => alert.eventKey.endsWith(':unavailable')));
  await assert.rejects(() => fence.assertSwapStockReconciled(ctx, booking._id), /stock reconciliation/);
  assert.equal(messages.length, 0);
  receipt.auditDueAt = Date.now() - 1;
  assert.ok(await audit.claim.handler(ctx, {id: receipt._id, token: 'still-unavailable'}));
  await audit.record.handler(ctx, {id: receipt._id, token: 'still-unavailable', result: {status: 'confirmed', result: {}}});
  assert.equal(receipt.auditAttempts, 4);
  assert.ok(!alerts.some(alert => alert.eventKey.endsWith(':eligibility')), 'Malformed stock results must not be described as a successful stock check');
  receipt.auditDueAt = Date.now() - 1;
  assert.ok(await audit.claim.handler(ctx, {id: receipt._id, token: 'recovered'}));
  await audit.record.handler(ctx, {id: receipt._id, token: 'recovered', result: {status: 'confirmed', result: {stockRisk: false}}});
  assert.equal(receipt.stockRisk, false);
  assert.equal(receipt.auditAttempts, 0);
  assert.equal(booking.activeItemSwapId, undefined);
  await fence.assertSwapStockReconciled(ctx, booking._id);
  assert.equal(messages.length, 1);
  assert.equal(emails.length, 1);
  console.log('PASS stock audit: malformed confirmations retry, alert and fence; valid recovery clears the fence exactly once.');
})().catch(error => {console.error(error); process.exitCode = 1;});
