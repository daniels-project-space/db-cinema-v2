const assert = require('node:assert/strict');
const { load, db, put } = require('./lib/rentalTestHarness.cjs');
const ledger = load('convex/swapStockOperations.ts');
const { stockWindow } = load('convex/lib/stockWindows.ts');
const request = { operation:'releaseCompensated', args:{ id:'claim', fingerprint:'original', executionKey:'execution' } };
const swap = put('rental_item_swaps', { bookingId:'booking', accountId:'account' });
const operation = put('swap_stock_operations', { swapId:swap._id, operation:'releaseCompensated', state:'review', request, reconcileAfter:Date.now()-1, reconcileAttempts:8 });
let calls = 0;
let lastReviewResult;
const context = {
  runQuery:async (_, args) => structuredClone(await db.get(args.id)),
  runAction:async () => { calls++; throw Error('synthetic provider outage'); },
  runMutation:async (_, args) => { lastReviewResult=await ledger.recordReviewCheck.handler({ db }, args); return lastReviewResult; },
};

(async () => {
  const snapshot = { id:operation._id, request:{ operation:'checkCompensatedRelease', args:request.args }, expectedDue:operation.reconcileAfter, expectedAttempts:8 };
  await Promise.all([ledger.checkReview.handler(context,{id:operation._id}),ledger.checkReview.handler(context,{id:operation._id})]);
  assert.equal(calls,2);
  assert.equal(operation.reconcileAttempts,9,'Concurrent failures count as one attempt');
  assert(operation.reconcileAfter>Date.now(),'Transport errors receive backoff instead of starving other reviews');
  await ledger.recordReviewCheck.handler({db},{...snapshot,result:{status:'confirmed',result:{state:'compensated_released'}}});
  assert.equal(operation.receipt,undefined,'A stale response cannot override newer evidence');
  await ledger.checkReview.handler(context,{id:operation._id});
  assert.equal(calls,2,'A retry cannot run before its backoff expires');
  operation.reconcileAfter=Date.now()-1;
  operation.reconcileAttempts=15;
  await ledger.checkReview.handler(context,{id:operation._id});
  assert.equal(operation.reconcileAttempts,16);
  assert.equal(operation.reconcileAfter,undefined,'Permanent outages stop automatic retries for manual review');
  assert.equal(operation.state,'review');
  await ledger.checkReview.handler(context,{id:operation._id});
  assert.equal(calls,3,'An unscheduled review cannot be restarted accidentally');

  const startedAt = Date.now();
  const rentalDay = Date.UTC(2032, 0, 1);
  const dayMs = 86400000;
  const account = put('accounts', { email:'swap-release@example.invalid' });
  const inventoryUnit = put('inventory_units', { name:'Reviewed camera', quantityOwned:1, rmv2ItemId:'manager-camera' });
  const listing = put('listings', { title:'Reviewed camera', active:true, components:[{ inventoryUnitId:inventoryUnit._id, qty:1 }] });
  const booking = put('bookings', {
    accountId:account._id, status:'confirmed', rmv2SyncStatus:'delivered', rmv2Revision:7, rmv2DeliveredRevision:7,
    lineItems:[{ listingId:listing._id, title:listing.title, start:rentalDay, end:rentalDay, qty:1 }],
  });
  const swap = put('rental_item_swaps', {
    bookingId:booking._id, accountId:account._id, lineIndex:0, oldLine:booking.lineItems[0],
    status:'refunded', acceptedAt:startedAt-60000, paymentIntentId:'pi_compensated_fixture',
    compensationStartedAt:startedAt, compensationReceipt:{ paymentIntentId:'pi_compensated_fixture', amountPence:500, attemptedAt:startedAt, status:'succeeded', stripeRefundId:'re_compensated_fixture' },
    quote:{ deltaPence:500 },
  });
  await db.patch(booking._id, { activeItemSwapId:swap._id });
  put('reservations', { bookingId:booking._id, listingId:listing._id, inventoryUnitId:inventoryUnit._id, ...stockWindow(booking.lineItems[0],false), qty:1, source:'site', status:'confirmed', endExclusive:true, turnaroundBufferMinutes:60 });
  const proposedUnit = put('inventory_units', { name:'Proposed lens', quantityOwned:1, rmv2ItemId:'manager-lens' });
  const proposedListing = put('listings', { title:'Proposed lens', active:true, components:[{ inventoryUnitId:proposedUnit._id, qty:1 }] });
  const proposedWindow = stockWindow(booking.lineItems[0],false);
  put('reservations', { bookingId:booking._id, listingId:proposedListing._id, inventoryUnitId:proposedUnit._id, start:proposedWindow.start, end:proposedWindow.end, qty:1, source:'site', status:'hold', externalRef:`swap:${swap._id}` });
  const requestId = 'claim-compensated-fixture';
  const fingerprint = 'fingerprint-compensated-fixture';
  const executionKey = `swap_execution_${swap._id}`;
  const stock = stockWindow(booking.lineItems[0],false);
  const windows = [{ itemId:'manager-camera', start:stock.start, end:stock.end, quantity:1 }];
  const evidence = { swapId:String(swap._id), bookingId:String(booking._id), bookingRevision:7, paymentIntentId:'pi_compensated_fixture', refundId:'re_compensated_fixture', refundStatus:'succeeded', amountPence:500, refundAttemptedAt:startedAt, windows };
  put('swap_stock_operations', { swapId:swap._id, operation:'acquire', state:'confirmed', receipt:{ requestId, fingerprint, state:'prepared', replayed:false } });
  put('swap_stock_operations', { swapId:swap._id, operation:'beginExecution', state:'confirmed', request:{ args:{ id:requestId, fingerprint, executionKey } } });
  const recoverableRelease = put('swap_stock_operations', { swapId:swap._id, operation:'releaseCompensated', state:'review', request:{ operation:'releaseCompensated', args:{ id:requestId, fingerprint, executionKey, evidence } }, reconcileAfter:Date.now()-1, reconcileAttempts:8 });
  await db.patch(booking._id,{rmv2DeliveredRevision:6});
  await ledger.recordReviewCheck.handler({ db }, { id:recoverableRelease._id, request:{ operation:'checkCompensatedRelease', args:recoverableRelease.request.args }, expectedDue:recoverableRelease.reconcileAfter, expectedAttempts:8, result:{ status:'confirmed', result:{ state:'compensated_released', replayed:false } } });
  assert.equal(recoverableRelease.state,'review','A stale manager snapshot keeps the release receipt for safe retry');
  assert.equal(recoverableRelease.receipt.state,'compensated_released');
  assert.equal(booking.activeItemSwapId,swap._id,'The booking stays locked until its fresh inventory snapshot is rechecked');
  const proposedHold= (await db.query('reservations').withIndex('by_booking',row=>row.eq('bookingId',booking._id)).collect()).find(row=>row.externalRef===`swap:${swap._id}`);
  assert.equal(proposedHold.status,'hold','A proposed stock hold remains in place until local finalization succeeds');
  await db.patch(booking._id,{rmv2DeliveredRevision:7});
  await db.patch(recoverableRelease._id,{reconcileAfter:Date.now()-60000});
  await ledger.checkReview.handler(context,{id:recoverableRelease._id});
  assert.equal(lastReviewResult,'confirmed','A stored manager receipt can be finalized without another provider call');
  assert.equal(recoverableRelease.state,'confirmed','A checked manager release is finalized after local booking evidence is revalidated');
  assert.equal(booking.activeItemSwapId,undefined,'The original rental unlocks only after the manager confirms the compensated release');
  assert.equal(proposedHold.status,'cancelled','The local proposed-item hold is released after manager confirmation');
  console.log('PASS swap compensated-release review retries: exception backoff, stale replies, concurrent dispatch and bounded exhaustion.');
})().catch(error=>{console.error(error);process.exitCode=1});
