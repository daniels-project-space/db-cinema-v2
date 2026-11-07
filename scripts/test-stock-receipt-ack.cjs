const assert=require('node:assert/strict');
const {load,db,put}=require('./lib/rentalTestHarness.cjs');
const delivery=load('convex/rmv2Delivery.ts');
const booking=put('bookings',{rmv2Revision:4,rmv2SyncStatus:'pending',rmv2SyncLeaseGeneration:1,rmv2SyncLeaseUntil:123});
const receipt=put('swap_stock_applied_receipts',{swapId:'swap-one',bookingId:booking._id,bookingRevision:3,managerRequestId:'claim',fingerprint:'fingerprint',executionKey:'execution',deliveryState:'pending'});
const ack={swapId:receipt.swapId,bookingRevision:3,managerRequestId:'claim',fingerprint:'fingerprint',executionKey:'execution'};
const ctx={db,scheduler:{runAfter:async()=>{}}};
(async()=>{
 const args={bookingId:booking._id,revision:4,generation:1,ok:true};
 await assert.rejects(delivery.record.handler(ctx,{...args,stockAcknowledgement:{...ack,fingerprint:'wrong'}}),/needs reconciliation/);
 assert.equal(receipt.deliveryState,'pending');assert.equal(booking.rmv2SyncStatus,'pending');
 await delivery.record.handler(ctx,{...args,stockAcknowledgement:ack});
 assert.equal(receipt.deliveryState,'acknowledged');assert.equal(booking.rmv2SyncStatus,'delivered');
 await delivery.record.handler(ctx,{...args,stockAcknowledgement:ack});
 assert.equal(receipt.deliveryState,'acknowledged');
 console.log('PASS durable stock receipt acknowledgement rejects mismatched evidence and handles replay');
})().catch(error=>{console.error(error);process.exitCode=1});
