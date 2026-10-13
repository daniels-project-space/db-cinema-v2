const assert=require('node:assert/strict'),h=require('./lib/rentalTestHarness.cjs');
const stock=h.load('convex/managerCheckoutStock.ts'),push=h.load('convex/managerCheckoutStockPush.ts');
const u=h.put('inventory_units',{rmv2ItemId:'physical-battery'}),b=h.put('bookings',{status:'pending_payment'}),now=Date.now();
const hold=h.put('reservations',{inventoryUnitId:u._id,bookingId:b._id,start:now+86400000,end:now+86400000+3600000,qty:2,source:'site',status:'hold',holdExpiresAt:now+600000,endExclusive:true,turnaroundBufferMinutes:60});
const ctx={db:h.db,runMutation:(ref,args)=>stock[ref.split('.')[1]].handler(ctx,args)};
(async()=>{
 const first=await stock.snapshot.handler(ctx,{});assert.equal(first.rows.length,1);assert.equal(first.rows[0].qty,2);assert.equal(first.rows[0].masterItemId,u.rmv2ItemId);assert(!JSON.stringify(first).includes('email'));
 await stock.record.handler(ctx,{revision:first.revision,ok:true});assert.equal(await stock.snapshot.handler(ctx,{}),null);
 const old=Date.now;Date.now=()=>now+61000;const heartbeat=await stock.snapshot.handler(ctx,{});Date.now=old;assert(heartbeat.revision>first.revision);await stock.record.handler(ctx,{revision:first.revision,ok:true});assert.notEqual(h.tables.get('manager_checkout_stock')[0].deliveredRevision,heartbeat.revision);
 await h.db.patch(b._id,{status:'confirmed'});const paid=await stock.snapshot.handler(ctx,{});assert.deepEqual(paid.rows,[],'Paid rentals use booking-sync, never duplicate checkout occupancy');
 await h.db.patch(b._id,{status:'pending_payment'});await h.db.patch(hold._id,{holdExpiresAt:now-1});assert.deepEqual((await stock.snapshot.handler(ctx,{})??{rows:[]}).rows,[]);
 await h.db.patch(hold._id,{holdExpiresAt:now+600000});await h.db.patch(u._id,{rmv2ItemId:undefined});await assert.rejects(stock.snapshot.handler(ctx,{}),/physical identity/);
 console.log('PASS actual manager hold outbox: physical quantities/windows, no renter data, replay, fresh heartbeat, revision fencing, paid and expired exclusion, missing identity fails closed. No provider writes.');
})().catch(e=>{console.error(e);process.exitCode=1});
