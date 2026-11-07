const assert = require('node:assert/strict');
const { load, db, put } = require('./lib/rentalTestHarness.cjs');
const ledger = load('convex/swapStockOperations.ts');
const request = { operation:'releaseCompensated', args:{ id:'claim', fingerprint:'original', executionKey:'execution' } };
const swap = put('rental_item_swaps', { bookingId:'booking', accountId:'account' });
const operation = put('swap_stock_operations', { swapId:swap._id, operation:'releaseCompensated', state:'review', request, reconcileAfter:Date.now()-1, reconcileAttempts:8 });
let calls = 0;
const context = {
  runQuery:async () => structuredClone(await db.get(operation._id)),
  runAction:async () => { calls++; throw Error('synthetic provider outage'); },
  runMutation:async (_, args) => ledger.recordReviewCheck.handler({ db }, args),
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
  console.log('PASS swap compensated-release review retries: exception backoff, stale replies, concurrent dispatch and bounded exhaustion.');
})().catch(error=>{console.error(error);process.exitCode=1});
