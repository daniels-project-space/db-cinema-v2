const assert=require('node:assert/strict');
const {load}=require('./lib/rentalTestHarness.cjs');
const push=load('convex/rmv2_webhook.ts').push;
const stock={swapId:'swap-one',managerRequestId:'claim',fingerprint:'fingerprint',executionKey:'execution',bookingRevision:3};
const booking={revision:4,status:'confirmed',stockApplicationReceipt:stock};
const results=[];
const ctx={runQuery:async()=>booking,runMutation:async(name,args)=>{if(name==='rmv2Delivery.claim')return {generation:1};results.push(args);}};
process.env.RMV2_WEBHOOK_URL='https://example.invalid/booking';process.env.RMV2_WEBHOOK_SECRET='fixture';
const base={ok:true,version:1,bookingId:'booking-one',receivedRevision:4,appliedRevision:4,outcome:'applied'};
(async()=>{
 global.fetch=async()=>({ok:true,json:async()=>base});
 assert.equal((await push.handler(ctx,{bookingId:'booking-one'})).reason,'invalid_stock_acknowledgement');
 global.fetch=async()=>({ok:true,json:async()=>({...base,stockAcknowledgement:{...stock,fingerprint:'wrong'}})});
 assert.equal((await push.handler(ctx,{bookingId:'booking-one'})).reason,'invalid_stock_acknowledgement');
 global.fetch=async()=>({ok:true,json:async()=>({...base,stockAcknowledgement:{managerRequestId:stock.managerRequestId,fingerprint:stock.fingerprint,executionKey:stock.executionKey,bookingRevision:stock.bookingRevision}})});
 assert.equal((await push.handler(ctx,{bookingId:'booking-one'})).ok,true);
 assert.deepEqual(results.at(-1).stockAcknowledgement,stock);
 console.log('PASS stock delivery requires a matching manager acknowledgement');
})().catch(error=>{console.error(error);process.exitCode=1});
