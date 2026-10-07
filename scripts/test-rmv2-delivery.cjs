const assert=require('node:assert/strict');
const {load,db,put}=require('./lib/rentalTestHarness.cjs');
const {queueRmv2Sync}=load('convex/lib/rmv2SyncQueue.ts');
const delivery=load('convex/rmv2Delivery.ts'),webhook=load('convex/rmv2_webhook.ts');
(async()=>{
 let scheduled=0; const ctx={db,scheduler:{runAfter:async()=>{scheduled++}}};
 const b=put('bookings',{status:'confirmed'});
 await queueRmv2Sync(ctx,b._id);assert.equal(b.rmv2Revision,1);assert.equal(scheduled,1);
 assert.equal(await delivery.claim.handler(ctx,{bookingId:b._id,revision:1}),true);
 assert.equal(await delivery.claim.handler(ctx,{bookingId:b._id,revision:1}),false,'Lease prevents concurrent delivery');
 await queueRmv2Sync(ctx,b._id);assert.equal(b.rmv2Revision,2);
 await delivery.record.handler(ctx,{bookingId:b._id,revision:1,ok:true});assert.equal(b.rmv2SyncStatus,'pending','Old receipt cannot acknowledge new state');
 await delivery.record.handler(ctx,{bookingId:b._id,revision:2,ok:false,reason:'http_503'});assert.equal(b.rmv2SyncAttempts,1);assert(b.rmv2SyncDueAt>Date.now());
 assert.equal(await delivery.claim.handler(ctx,{bookingId:b._id,revision:2}),false,'Backoff respected');
 await db.patch(b._id,{rmv2SyncDueAt:0,rmv2SyncLeaseUntil:Date.now()-1});assert.equal(await delivery.claim.handler(ctx,{bookingId:b._id,revision:2}),true,'Expired lease recovers a killed worker');
 await delivery.record.handler(ctx,{bookingId:b._id,revision:2,ok:true});assert.equal(b.rmv2DeliveredRevision,2);
 await delivery.record.handler(ctx,{bookingId:b._id,revision:2,ok:false});assert.equal(b.rmv2SyncStatus,'delivered','Late failure cannot undo receipt');
 await queueRmv2Sync(ctx,b._id);for(let i=0;i<12;i++)await delivery.record.handler(ctx,{bookingId:b._id,revision:3,ok:false});assert.equal(b.rmv2SyncStatus,'attention');
 await queueRmv2Sync(ctx,b._id);assert.equal(b.rmv2SyncAttempts,0);
 process.env.RMV2_WEBHOOK_URL='https://manager.example.invalid/booking-sync';process.env.RMV2_WEBHOOK_SECRET='isolated-fixture';
 const original=global.fetch;let recorded,requests=0;
 const actionCtx={runQuery:async()=>({id:b._id,revision:4}),runMutation:async(_,args)=>{if('ok'in args){recorded=args;return}return true}};
 try{
 global.fetch=async()=>{requests++;return {ok:true,json:async()=>({ok:false})}};await webhook.push.handler(actionCtx,{bookingId:b._id});assert.equal(recorded.reason,'invalid_receipt');
 global.fetch=async()=>({ok:true,json:async()=>({ok:true})});await webhook.push.handler(actionCtx,{bookingId:b._id});assert.equal(recorded.ok,true);
 actionCtx.runMutation=async()=>false;await webhook.push.handler(actionCtx,{bookingId:b._id});assert.equal(requests,1,'Unclaimed jobs do not transmit');
 }finally{global.fetch=original}
 console.log('PASS durable queue, leases, stale acknowledgements, backoff, worker recovery, bounded attempts and verified webhook receipts');
})().catch(e=>{console.error(e);process.exitCode=1});
