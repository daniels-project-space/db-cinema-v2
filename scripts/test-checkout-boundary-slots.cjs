const assert=require('node:assert/strict');
const {load,db,put}=require('./lib/rentalTestHarness.cjs');
const {RENTAL_TIME_SLOTS,londonRentalInstant}=load('shared/rentalWindow.ts');
const availability=load('convex/availability.ts'),ctx={db};
const day=86400000,date=Date.UTC(2030,5,8);
const unit=put('inventory_units',{name:'Shared camera',quantityOwned:1,active:true});
const listing=put('listings',{title:'Camera',active:true,components:[{inventoryUnitId:unit._id,qty:1}],unavailableDates:[]});
const state=put('rmv2_sync_state',{key:'shared-stock-v1',status:'ok',cursor:JSON.stringify({version:2,turnaroundBufferMinutes:60,checkedAt:Date.now()})});
const row=put('reservations',{source:'hygglo',stockWindowVersion:2,turnaroundBufferMinutes:60,inventoryUnitId:unit._id,start:londonRentalInstant(date,'12:00'),end:londonRentalInstant(date,'14:00'),qty:1,status:'cancelled',endExclusive:true});
const line=(start=date,end=date,extra={})=>({listingId:listing._id,start,end,...extra});
const slots=(items,extra={})=>availability.forCheckoutTimeSlots.handler(ctx,{items,...extra});
const has=(s,pickupTime,returnTime)=>s.validPairs.some(p=>p.pickupTime===pickupTime&&p.returnTime===returnTime);
(async()=>{
 let s=await slots([line()],{pickupTime:'21:00',returnTime:'20:00'});
 assert.deepEqual(s.pickupBoundarySlots,RENTAL_TIME_SLOTS,'No bookings: late pickup is stock-free independently of chosen return');
 assert.deepEqual(s.returnBoundarySlots,RENTAL_TIME_SLOTS,'No bookings: early return is stock-free independently of chosen pickup');
 assert.equal(s.validPairs.length,91);assert(!has(s,'21:00','20:00'));assert(has(s,'21:00','22:00'));
 assert(!s.pickupSlots.includes('21:00'),'Legacy selected-return projection remains unchanged');
 const reverse=await slots([line()],{pickupTime:'09:00',returnTime:'22:00'});assert.deepEqual(s.pickupBoundarySlots,reverse.pickupBoundarySlots);assert.deepEqual(s.returnBoundarySlots,reverse.returnBoundarySlots);assert.deepEqual(s.validPairs,reverse.validPairs);
 const individual=await availability.forTimeSlots.handler(ctx,{...line(),pickupTime:'21:00',returnTime:'20:00',items:[]});assert.deepEqual(individual.pickupBoundarySlots,RENTAL_TIME_SLOTS);assert.deepEqual(individual.returnBoundarySlots,RENTAL_TIME_SLOTS);
 row.status='confirmed';row.start=londonRentalInstant(date-day,'09:00');row.end=londonRentalInstant(date,'18:00');
 const next=put('reservations',{...row,_id:undefined,start:londonRentalInstant(date+2*day,'16:00'),end:londonRentalInstant(date+3*day,'18:00')});
 s=await slots([line(date,date+2*day)]);assert.deepEqual(s.pickupBoundarySlots,['18:00','19:00','20:00','21:00','22:00']);assert.deepEqual(s.returnBoundarySlots,['09:00','10:00','11:00','12:00','13:00','14:00','15:00'],'Next hire16:00 requires our return no later than15:00');assert(has(s,'18:00','15:00'));assert(!has(s,'17:00','15:00'));assert(!has(s,'18:00','16:00'));

 for(const read of [args=>slots([line(date,date+2*day)],args),args=>availability.forTimeSlots.handler(ctx,{...line(date,date+2*day),...args,items:[]})]){
  const chosen=await read({pickupTime:'18:00',returnTime:'09:00'});
  assert(chosen.pickupBoundarySlots.includes('18:00'),'Previous hire ends at the buffered pickup boundary');
  assert(chosen.returnBoundarySlots.includes('09:00'),'A morning return two days later remains valid for an evening pickup');
  assert(!chosen.pickupBoundarySlots.includes('17:00'),'The actual earlier rental blocks pickup until its buffer ends');
  assert(!chosen.returnBoundarySlots.includes('16:00'),'The next scheduled pickup requires return plus the full one-hour buffer');
  if('available' in chosen)assert.equal(chosen.available,1,'Bookings before pickup and after return plus buffer do not consume this rental period');
 }
 const middle=put('reservations',{...row,_id:undefined,start:londonRentalInstant(date+day,'12:00'),end:londonRentalInstant(date+day,'14:00')});s=await slots([line(date,date+2*day)]);assert.deepEqual(s.pickupBoundarySlots,[]);assert.deepEqual(s.returnBoundarySlots,[]);assert.deepEqual(s.validPairs,[],'A booked interior window prevents every continuous rental pair');middle.status='cancelled';row.status='cancelled';next.status='cancelled';
 row.status='confirmed';row.start=londonRentalInstant(date,'12:00');row.end=londonRentalInstant(date,'14:00');s=await slots([line()]);assert(has(s,'09:00','11:00'));assert(!has(s,'09:00','15:00'),'Free endpoints cannot cross a same-day booked middle window');assert(s.pickupBoundarySlots.includes('14:00'));assert(!s.pickupBoundarySlots.includes('13:00'));assert(s.returnBoundarySlots.includes('11:00'));assert(!s.returnBoundarySlots.includes('12:00'));

 // Menus must honour the opposite selected clock, rather than another shorter pair.
 for(const read of [args=>slots([line()],args),args=>availability.forTimeSlots.handler(ctx,{...line(),...args,items:[]})]){
  const selected=await read({pickupTime:'09:00',returnTime:'18:00'});
  assert(!selected.pickupBoundarySlots.includes('09:00'),'Morning pickup cannot cross the booked middle period to the selected evening return');
  assert(!selected.returnBoundarySlots.includes('18:00'),'Evening return cannot cross the booked middle period from the selected morning pickup');
  assert(selected.pickupBoundarySlots.includes('14:00'),'Pickup after the actual earlier rental and its buffer remains selectable');
  assert(selected.returnBoundarySlots.includes('11:00'),'Return before the next rental, leaving the full buffer, remains selectable');
 }
 row.status='cancelled';
 for(const read of [args=>slots([line(date,date+2*day)],args),args=>availability.forTimeSlots.handler(ctx,{...line(date,date+2*day),...args,items:[]})]){
  const clear=await read({pickupTime:'18:00',returnTime:'09:00'});
  assert.deepEqual(clear.pickupBoundarySlots,RENTAL_TIME_SLOTS,'An uninterrupted multi-day rental has no arbitrary morning/evening stock restriction');
  assert.deepEqual(clear.returnBoundarySlots,RENTAL_TIME_SLOTS,'Return-day clocks are independent of clock order across different dates');
 }
 row.status='confirmed';
 unit.quantityOwned=2;s=await slots([line()]);assert(has(s,'09:00','15:00'),'One booked copy leaves one available');s=await slots([line(date,date,{qty:2})]);assert(!has(s,'09:00','15:00'),'Requested quantity uses shared physical capacity');listing.components.push({inventoryUnitId:unit._id,qty:1});s=await slots([line()]);assert(!has(s,'09:00','15:00'),'Duplicate BOM quantities aggregate');listing.components.pop();row.status='cancelled';
 s=await slots([line(),line()]);assert(has(s,'09:00','15:00'));unit.quantityOwned=1;s=await slots([line(),line()]);assert.deepEqual(s.validPairs,[],'Other cart lines compete for the same stock');
 const other=await availability.forTimeSlots.handler(ctx,{...line(),items:[line(date,date,{pickupTime:'09:00',returnTime:'22:00'})]});assert.deepEqual(other.validPairs,[],'Per-line masks retain other-cart allocations');
 s=await slots([line(),line(date,date,{pickupTime:'09:00',returnTime:'12:00'})]);assert(s.pickupBoundarySlots.includes('13:00'));assert(!s.pickupBoundarySlots.includes('12:00'));assert(has(s,'13:00','14:00'),'Fixed item clocks retain their own occupied window');
 s=await slots([line(date,date+2*day),line(date+day,date+day,{pickupTime:'12:00',returnTime:'13:00'})]);assert.deepEqual(s.pickupBoundarySlots,[]);assert.deepEqual(s.returnBoundarySlots,[]);assert.deepEqual(s.validPairs,[],'An overridden other-cart window in the interior cannot be shortened away');
 listing.marketingOnly=true;s=await slots([line()]);assert.deepEqual(s.validPairs,[]);listing.marketingOnly=false;listing.unavailableDates=['2030-06-09'];s=await slots([line(date,date+2*day)]);assert.deepEqual(s.pickupBoundarySlots,[],'Source date blocks remain authoritative');listing.unavailableDates=[];
 state.cursor=JSON.stringify({version:1,checkedAt:Date.now()});row.status='confirmed';s=await slots([line()]);assert.deepEqual(s.validPairs,[],'Unknown/legacy precision keeps full-day occupancy conservative');
 console.log('PASS actual checkout boundary handlers: independent endpoint masks, separate ordering, full continuous periods, buffered previous/next hires, interior conflicts, shared qty/BOM/other cart and conservative gates. No live writes.');
})().catch(e=>{console.error(e);process.exitCode=1});
