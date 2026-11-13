const assert = require('node:assert/strict');
const { load, db, put, setMock } = require('./lib/rentalTestHarness.cjs');

let authorityReady = false;
setMock('./lib/rentalSwapAuthority', { swapAuthorityAvailable: () => authorityReady });
setMock('./lib/rentalAllocation', { assertRentalAllocation: async () => {} });
const audit = load('convex/swapStockAudit.ts');
const scheduled = [];
const ctx = { db, scheduler: { runAfter: async (...args) => scheduled.push(args) } };

function legacyFixture(label, { changedAllocation = false, badClaim = false } = {}) {
  const booking = put('bookings', { status: 'confirmed', rmv2Revision: 4 });
  const swap = put('rental_item_swaps', { bookingId: booking._id, status: 'applied', stockAppliedAt: 100, oldLine: { title: 'Camera', qty: 1 }, newLine: { title: 'Lens', qty: 1 } });
  const unit = put('inventory_units', { rmv2ItemId: `manager-${label}` });
  const reservation = put('reservations', { bookingId: booking._id, inventoryUnitId: unit._id, source: 'site', status: 'confirmed', start: 1000, end: 2000, qty: changedAllocation ? 2 : 1, endExclusive: true, turnaroundBufferMinutes: 60 });
  const receipt = put('swap_stock_applied_receipts', { swapId: swap._id, bookingId: booking._id, bookingRevision: 4, managerRequestId: `claim-${label}`, fingerprint: `fingerprint-${label}`, executionKey: `swap_execution_${swap._id}`, appliedAt: 100, windows: [{ reservationId: reservation._id, inventoryUnitId: unit._id, managerItemId: unit.rmv2ItemId, start: 1000, end: 2000, quantity: 1, endExclusive: true, turnaroundBufferMinutes: 60 }] });
  const claim = put('swap_stock_operations', { swapId: swap._id, operation: 'acquire', state: 'confirmed', receipt: { requestId: `claim-${label}`, fingerprint: badClaim ? `wrong-${label}` : `fingerprint-${label}` } });
  const execution = put('swap_stock_operations', { swapId: swap._id, operation: 'beginExecution', state: 'confirmed', receipt: { state: 'execution_started' }, request: { args: { id: `claim-${label}`, fingerprint: `fingerprint-${label}`, executionKey: `swap_execution_${swap._id}` } } });
  return { booking, swap, receipt, claim, execution };
}

(async () => {
  process.env.SHARED_STOCK_BRIDGE_EXPERIMENTAL = 'true';
  const good = legacyFixture('good');
  const changed = legacyFixture('changed', { changedAllocation: true });
  const mismatched = legacyFixture('mismatched', { badClaim: true });

  assert.deepEqual(await audit.recoverSafeLegacyReceipts.handler(ctx, {}), { scanned: 0, queued: 0, disabled: true });
  assert.equal(good.receipt.deliveryState, undefined, 'the disabled bridge must not mutate legacy receipts');
  authorityReady = true;

  const result = await audit.recoverSafeLegacyReceipts.handler(ctx, {});
  assert.deepEqual(result, { scanned: 3, queued: 1, disabled: false });
  assert.equal(good.receipt.deliveryState, 'pending');
  assert.equal(good.booking.activeItemSwapId, good.swap._id);
  assert.equal(good.booking.rmv2Revision, 5);
  assert.equal(changed.receipt.deliveryState, undefined, 'changed allocations remain fenced for individual reconciliation');
  assert.equal(changed.booking.activeItemSwapId, undefined);
  assert.equal(mismatched.receipt.deliveryState, undefined, 'a mismatched manager claim is never retried');
  assert.equal(scheduled.length, 1, 'one matching receipt queues exactly one manager sync');

  const repeated = await audit.recoverSafeLegacyReceipts.handler(ctx, {});
  assert.equal(repeated.queued, 0, 'repeat sweeps do not bump the booking revision or queue duplicate syncs');
  assert.equal(good.booking.rmv2Revision, 5);
  assert.equal(scheduled.length, 1);

  const olderAmbiguous = Array.from({ length: 11 }, (_, index) => legacyFixture(`backlog-${index}`, { changedAllocation: true }));
  const afterAmbiguous = legacyFixture('after-backlog');
  const firstPage = await audit.recoverSafeLegacyReceipts.handler(ctx, {});
  assert.deepEqual(firstPage, { scanned: 10, queued: 0, disabled: false }, 'the sweep processes bounded pages');
  assert.equal(afterAmbiguous.receipt.deliveryState, undefined, 'a later receipt waits for its page');
  const secondPage = await audit.recoverSafeLegacyReceipts.handler(ctx, {});
  assert.deepEqual(secondPage, { scanned: 4, queued: 1, disabled: false }, 'the saved cursor advances beyond persistent ambiguous rows');
  assert.equal(afterAmbiguous.receipt.deliveryState, 'pending', 'an exact later receipt is not starved by older unsafe rows');
  assert(olderAmbiguous.every(row => row.receipt.deliveryState === undefined), 'ambiguous rows remain untouched');
  console.log('PASS bounded legacy swap recovery: exact receipts auto-queue once; changed allocation and mismatched manager evidence remain fenced; bridge-off is inert.');
})().catch(error => { console.error(error); process.exitCode = 1; });
