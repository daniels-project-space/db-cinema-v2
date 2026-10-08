const assert=require('node:assert/strict');
const {load,db,put}=require('./lib/rentalTestHarness.cjs');
const {queueRmv2Sync}=load('convex/lib/rmv2SyncQueue.ts');
const delivery=load('convex/rmv2Delivery.ts'),webhook=load('convex/rmv2_webhook.ts');
(async()=>{
 let scheduled=0;const ctx={db,scheduler:{runAfter:async()=>{scheduled++}}};
 const b=put('bookings',{status:'confirmed'}),claim=revision=>delivery.claim.handler(ctx,{bookingId:b._id,revision}),record=(revision,generation,ok)=>delivery.record.handler(ctx,{bookingId:b._id,revision,generation,ok});
 await queueRmv2Sync(ctx,b._id);assert.equal(b.rmv2Revision,1);assert.equal(scheduled,1);assert.deepEqual(await claim(1),{generation:1});assert.equal(await claim(1),null);assert(!(await delivery.due.handler(ctx,{})).some(x=>x._id===b._id),'Leased work cannot occupy the head of the due queue');
 await queueRmv2Sync(ctx,b._id);await record(1,1,true);assert.equal(b.rmv2SyncStatus,'pending');assert.deepEqual(await claim(2),{generation:2});await record(2,2,false);assert.equal(b.rmv2SyncAttempts,1);assert.equal(await claim(2),null);await record(2,2,false);assert.equal(b.rmv2SyncAttempts,1,'Duplicate result cannot consume another retry');
 await db.patch(b._id,{rmv2SyncDueAt:0,rmv2SyncLeaseUntil:Date.now()-1});assert.deepEqual(await claim(2),{generation:3});const active=b.rmv2SyncLeaseUntil;await record(2,2,false);await record(2,2,true);assert.equal(b.rmv2SyncLeaseUntil,active);assert.equal(b.rmv2SyncStatus,'pending');assert.equal(b.rmv2SyncAttempts,1,'Late previous-attempt results do not affect the replacement lease');await record(2,3,true);assert.equal(b.rmv2DeliveredRevision,2);await record(2,3,false);assert.equal(b.rmv2SyncStatus,'delivered');
 await queueRmv2Sync(ctx,b._id);for(let i=0;i<12;i++){await db.patch(b._id,{rmv2SyncDueAt:0});const lease=await claim(3);assert(lease);await record(3,lease.generation,false)}assert.equal(b.rmv2SyncStatus,'attention');await queueRmv2Sync(ctx,b._id);assert.equal(b.rmv2SyncAttempts,0);
 const leased=[];for(let i=0;i<12;i++){const row=put('bookings',{status:'confirmed'});await queueRmv2Sync(ctx,row._id);await delivery.claim.handler(ctx,{bookingId:row._id,revision:1});leased.push(row._id)}const free=put('bookings',{status:'confirmed'});await queueRmv2Sync(ctx,free._id);const due=await delivery.due.handler(ctx,{});assert(due.some(x=>x._id===free._id));assert(!due.some(x=>leased.includes(x._id)),'Leased first rows cannot starve other pending rentals');
 process.env.RMV2_WEBHOOK_URL='https://manager.example.invalid/booking-sync';process.env.RMV2_WEBHOOK_SECRET='isolated-fixture';
 const transportBeforeRace=global.fetch;
 const raced=put('bookings',{status:'confirmed'});await queueRmv2Sync(ctx,raced._id);
 const raceCtx={runQuery:async()=>({id:raced._id,revision:raced.rmv2Revision,status:raced.status}),runMutation:async(ref,args)=>ref==='rmv2Delivery.claim'?delivery.claim.handler(ctx,args):delivery.record.handler(ctx,args)};
 let release,started;const gate=new Promise(resolve=>release=resolve),startSignal=new Promise(resolve=>started=resolve);let sends=0;
 try{global.fetch=async()=>{sends++;if(sends===1){started();await gate;return {ok:true,json:async()=>({ok:true,version:1,bookingId:raced._id,receivedRevision:1,appliedRevision:1,outcome:'applied'})}}return {ok:true,json:async()=>({ok:true})}};
 const older=webhook.push.handler(raceCtx,{bookingId:raced._id});await startSignal;await db.patch(raced._id,{rmv2SyncLeaseUntil:Date.now()-1,rmv2SyncDueAt:0});await webhook.push.handler(raceCtx,{bookingId:raced._id});assert.equal(raced.rmv2SyncAttempts,1);release();await older;assert.equal(raced.rmv2SyncStatus,'pending');assert.equal(raced.rmv2DeliveredRevision,undefined);assert.equal(raced.rmv2SyncAttempts,1,'Actual late worker receipt cannot acknowledge the replacement attempt');
 }finally{global.fetch=transportBeforeRace}
 const original=global.fetch;let recorded,requests=0;const booking={id:b._id,revision:4,status:'confirmed'};
 const actionCtx={runQuery:async()=>booking,runMutation:async(_,args)=>{if('ok'in args){recorded=args;return}return {generation:99}}};
 const valid={ok:true,version:1,bookingId:b._id,receivedRevision:4,appliedRevision:4,outcome:'applied'};
 try{
 for(const receipt of [{ok:true},{...valid,version:2},{...valid,bookingId:'wrong'},{...valid,receivedRevision:3},{...valid,appliedRevision:5},{...valid,outcome:'stale'},{...valid,outcome:'ignored',reason:'unpaid',appliedRevision:null}]){global.fetch=async()=>{requests++;return {ok:true,json:async()=>receipt}};await webhook.push.handler(actionCtx,{bookingId:b._id});assert.equal(recorded.reason,'invalid_receipt');assert.equal(recorded.generation,99)}
 for(const outcome of ['applied','unchanged']){global.fetch=async()=>({ok:true,json:async()=>({...valid,outcome})});await webhook.push.handler(actionCtx,{bookingId:b._id});assert.equal(recorded.ok,true)}
 booking.status='pending_payment';global.fetch=async()=>({ok:true,json:async()=>({...valid,appliedRevision:null,outcome:'ignored',reason:'unpaid'})});await webhook.push.handler(actionCtx,{bookingId:b._id});assert.equal(recorded.ok,true,'Explicitly unpaid source is not invented as a paid manager rental');
 const before=requests;actionCtx.runMutation=async()=>null;await webhook.push.handler(actionCtx,{bookingId:b._id});assert.equal(requests,before,'Unclaimed jobs do not transmit');
 }finally{global.fetch=original}
 console.log('PASS actual durable queue/webhook handlers: generation-fenced leases, duplicate/stale result rejection, backoff, killed-worker recovery, bounded attempts, leased-row starvation prevention, exact versioned booking/revision receipts and explicit unpaid skip. Controlled transport; no provider writes.');
})().catch(e=>{console.error(e);process.exitCode=1});
