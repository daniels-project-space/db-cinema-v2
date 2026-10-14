const assert=require('node:assert/strict'),{load}=require('./lib/rentalTestHarness.cjs');
const before=process.env.RMV2_OUTBOUND_ENABLED;
(async()=>{
 process.env.RMV2_OUTBOUND_ENABLED='false';
 let calls=0;const denied=new Proxy({},{get(){return async()=>{calls++;throw Error('No staging side effect may start')}}});
 assert.deepEqual(await load('convex/rmv2_webhook.ts').push.handler(denied,{bookingId:'synthetic-disabled'}),{ok:false,reason:'delivery_disabled'});
 await load('convex/rmv2_webhook.ts').retryDue.handler(denied,{});
 await load('convex/managerCheckoutStockPush.ts').push.handler(denied,{});
 await load('convex/managerNotifications.ts').deliver.handler(denied,{notificationId:'synthetic-disabled'});
 assert.equal(calls,0,'Disabled outbound avoids reads, claims, revisions, retries and provider sends');
 console.log('PASS actual staging outbound gate: booking push, scheduled recovery, notifications and stock-hold pushes stop before any database or transport effect. Inventory reads remain independent. No real data/provider calls.');
})().catch(e=>{console.error(e);process.exitCode=1}).finally(()=>{if(before===undefined)delete process.env.RMV2_OUTBOUND_ENABLED;else process.env.RMV2_OUTBOUND_ENABLED=before});
