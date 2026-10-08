const assert=require('node:assert/strict');
const {load,db,put}=require('./lib/rentalTestHarness.cjs');
const {rentalWindow,londonRentalInstant}=load('shared/rentalWindow.ts');
const {stockWindow,stockTimePrecision}=load('convex/lib/stockWindows.ts');
const availability=load('convex/availability.ts'),bookings=load('convex/bookings.ts');
const day=86400000,date=Date.UTC(2030,5,8),ctx={db};
const unit=put('inventory_units',{name:'Physical lens',quantityOwned:1,active:true});
const listing=put('listings',{title:'Lens',active:true,components:[{inventoryUnitId:unit._id,qty:1}],unavailableDates:[]});
const state=put('rmv2_sync_state',{key:'shared-stock-v1',status:'ok',cursor:JSON.stringify({version:2,turnaroundBufferMinutes:60,checkedAt:Date.now()})});
const occupied=put('reservations',{source:'hygglo',stockWindowVersion:2,turnaroundBufferMinutes:60,inventoryUnitId:unit._id,start:londonRentalInstant(date,'09:00'),end:londonRentalInstant(date,'19:00'),qty:1,status:'confirmed',endExclusive:true});
const line=(pickupTime,returnTime,extra={})=>({listingId:listing._id,start:date,end:date,pickupTime,returnTime,...extra});
const fit=items=>availability.forCart.handler(ctx,{items});
(async()=>{
 const refresh=JSON.parse(load('convex/crons.ts').default.export())['sync-hygglo-reservations'];
 assert.equal(refresh.name,'sync.syncHyggloReservations','Freshness schedule calls the real shared-stock importer');
 const refreshMs=(refresh.schedule.minutes??0)*60000+(refresh.schedule.seconds??0)*1000;
 assert(refreshMs>0,'Shared-stock refresh must be a positive interval');
 const originalNow=Date.now;let now=originalNow();
 try {
  Date.now=()=>now;
  for(let cycle=0;cycle<3;cycle++){
   state.cursor=JSON.stringify({version:2,turnaroundBufferMinutes:60,checkedAt:now});
   now+=2*refreshMs-1; // One missed refresh must not invalidate the last successful feed.
   assert.equal(await stockTimePrecision(ctx),true,'Scheduled source refresh must occur before precise stock expires, even after one missed cycle');
  }
 }finally{Date.now=originalNow;state.cursor=JSON.stringify({version:2,turnaroundBufferMinutes:60,checkedAt:Date.now()});}
 assert.equal((await fit([line('19:00','22:00')]))[listing._id].ok,true,'Confirmed return frees pool at exact instant, after the one-hour turnaround');
 assert.equal((await fit([line('17:00','22:00')]))[listing._id].ok,false,'Overlap cannot be crossed');
 let slots=await availability.forTimeSlots.handler(ctx,{...line(undefined,undefined),items:[]});assert.deepEqual(slots.pickupSlots,['19:00','20:00','21:00']);
 assert.equal((await fit([line(undefined,'22:00')]))[listing._id].ok,false,'Unknown pickup blocks whole start day');
 occupied.end=rentalWindow({start:date,end:date}).end+3600000;
 assert.equal((await fit([line('19:00','22:00')]))[listing._id].ok,false,'Unknown return conservatively blocks whole return day');
 occupied.status='cancelled';
 assert.equal((await fit([line('09:00','12:00'),line('13:00','18:00')]))[listing._id].ok,true,'Disjoint cart windows reuse one physical copy');
 assert.equal((await fit([line('09:00','13:00'),line('12:00','18:00')]))[listing._id].ok,false,'Overlapping cart windows compete');
 unit.quantityOwned=4;occupied.status='confirmed';occupied.qty=1;
 assert.equal((await fit([line('09:00','18:00',{qty:3})]))[listing._id].ok,true,'Four owned and one rented leaves three');
 assert.equal((await fit([line('09:00','18:00',{qty:4})]))[listing._id].ok,false,'Quantity cannot exceed remaining pool');
 listing.components.push({inventoryUnitId:unit._id,qty:3});assert.equal((await fit([line('09:00','18:00')]))[listing._id].ok,false,'Duplicate BOM components aggregate');listing.components.pop();
 unit.quantityOwned=1;occupied.end=londonRentalInstant(date,'19:00');occupied.start=londonRentalInstant(date,'09:00');occupied.stockWindowVersion=1;
 assert.equal((await fit([line('19:00','22:00')]))[listing._id].ok,false,'V1 wall labels never support exact release');
 occupied.stockWindowVersion=2;state.cursor=JSON.stringify({version:1,checkedAt:Date.now()});assert.equal((await fit([line('19:00','22:00')]))[listing._id].ok,false,'Unqualified reader precision is conservative');
 state.cursor=JSON.stringify({version:2,turnaroundBufferMinutes:60,checkedAt:Date.now()-360000});assert.equal((await fit([line('19:00','22:00')]))[listing._id].ok,false,'Stale precision is conservative');
 state.cursor=JSON.stringify({version:2,turnaroundBufferMinutes:60,checkedAt:Date.now()});occupied.status='cancelled';
 const booking=put('bookings',{status:'pending_payment',lineItems:[line('09:00','12:00',{qty:1})]});
 assert.equal((await bookings.placeHolds.handler(ctx,{bookingId:booking._id,ttlMs:60000})).created,1);
 assert.equal((await bookings.placeHolds.handler(ctx,{bookingId:booking._id,ttlMs:60000})).alreadyReserved,true);
 assert.equal((await fit([line('13:00','18:00')]))[listing._id].ok,true,'Authoritative pending hold frees pool at its return plus one-hour turnaround');
 assert.equal((await fit([line('11:00','18:00')]))[listing._id].ok,false,'Authoritative pending hold prevents competing checkout');
 booking.lineItems[0].returnTime='13:00';await assert.rejects(bookings.placeHolds.handler(ctx,{bookingId:booking._id,ttlMs:60000}),/has changed/);
 occupied.status='confirmed';occupied.end=londonRentalInstant(date,'18:00');
 assert.equal((await fit([line('17:00','22:00')]))[listing._id].ok,false,'Actual 17:00 return retains one-hour turnaround');
 assert.equal((await fit([line('18:00','22:00')]))[listing._id].ok,true,'Actual 17:00 return releases at exactly 18:00');occupied.status='cancelled';
 const defaults=await availability.forCheckoutTimeSlots.handler(ctx,{items:[line('13:00','18:00')],pickupTime:'09:00',returnTime:'12:00'});assert(defaults.pickupSlots.length,'Fixed per-item times retain valid default clock controls');
 await assert.rejects(availability.forTimeSlots.handler(ctx,{...line(undefined,undefined),start:date+3600000,items:[]}),/UTC-midnight/);
 assert.equal((await fit([line('09:00','12:00'),line('12:00','18:00')]))[listing._id].ok,false,'Adjacent requests must leave the full one-hour turnaround');
 const spring=Date.UTC(2030,2,31),fall=Date.UTC(2030,9,27);assert.equal(rentalWindow({start:spring,end:spring}).end-rentalWindow({start:spring,end:spring}).start,23*3600000);assert.equal(rentalWindow({start:fall,end:fall}).end-rentalWindow({start:fall,end:fall}).start,25*3600000);
 assert.equal(stockWindow({start:spring,end:spring},true).end-stockWindow({start:spring,end:spring},true).start,24*3600000,'23-hour unknown civil day plus one elapsed hour');
 assert.equal(stockWindow({start:fall,end:fall},true).end-stockWindow({start:fall,end:fall},true).start,26*3600000,'25-hour unknown civil day plus one elapsed hour');
 assert.equal(stockWindow({start:date,end:date,pickupTime:'09:00',returnTime:'22:00'},true).end,londonRentalInstant(date,'23:00'));
 assert.throws(()=>londonRentalInstant(spring,'01:30'),/ambiguous|does not exist/);assert.throws(()=>londonRentalInstant(fall,'01:30'),/ambiguous|does not exist/);
 console.log('PASS actual interval handlers: exact return, overlap, paired slots, unknown endpoints, shared quantities/BOM, v1/stale guard, London DST. No live writes.');
})().catch(e=>{console.error(e);process.exitCode=1});
