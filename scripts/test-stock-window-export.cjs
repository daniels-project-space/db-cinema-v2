const assert=require('node:assert/strict');
const {load}=require('./lib/rentalTestHarness.cjs');
const {mapBookingForSync}=load('convex/rmv2_sync.ts');
const {stockWindow}=load('convex/lib/stockWindows.ts');
const day=d=>Date.parse(d+'T00:00:00Z');
const unit={_id:'unit',rmv2ItemId:'master',name:'Camera',hyggloProductId:1};
const base={_id:'booking',_creationTime:1,status:'confirmed',pickupTime:'09:00',returnTime:'22:00'};
const project=(lines,rows)=>mapBookingForSync({...base,lineItems:lines},new Map(),new Map([['unit',unit]]),new Map(),rows).physicalReservations;
function row(line,precise=true,marked=true,storeTimes=false){const w=stockWindow(line,precise),{pickupTime,returnTime,turnaroundBufferMinutes,...window}=w;return {_id:'reservation',inventoryUnitId:'unit',listingId:line.listingId,source:'site',status:'confirmed',qty:1,...window,end:window.end-(marked?0:3600000),endExclusive:true,...(storeTimes?{pickupTime,returnTime}:{}),...(marked?{turnaroundBufferMinutes}:{})};}
for(const date of ['2027-07-06','2027-03-28','2027-10-31']){
 const line={listingId:'lens',title:'Lens',qty:1,start:day(date),end:day(date),pickupTime:'10:00',returnTime:'17:00'};
 const allocation=row(line);const out=project([line],[allocation])[0];
 assert.equal(out.pickupTime,'10:00');assert.equal(out.returnTime,'17:00');assert.equal(out.pickupDate,date);assert.equal(out.returnDate,date);assert.equal(out.end,allocation.end);assert.equal(out.turnaroundBufferMinutes,60);
 const old=project([line],[row(line,true,false)])[0];assert.equal(old.end,allocation.end);assert.equal(old.returnTime,'17:00');
 const conservative=project([line],[row(line,false)])[0];assert.equal(conservative.returnDate,date);assert.equal(conservative.returnTime,'17:00');
}
const midnight={listingId:'camera',title:'Camera',qty:1,start:day('2027-07-06'),end:day('2027-07-07'),pickupTime:'19:00',returnTime:'00:00'};
const other={...midnight,listingId:'lens',pickupTime:'20:00',returnTime:'01:00'};
const outs=project([midnight,other],[row(midnight),row(other)]);
assert.deepEqual(outs.map(x=>[x.pickupTime,x.returnTime,x.returnDate]),[['19:00','00:00','2027-07-07'],['20:00','01:00','2027-07-07']]);
const unknown={...midnight,pickupTime:null,returnTime:null};
const u=project([unknown],[row(unknown)])[0];assert.equal(u.pickupTime,null);assert.equal(u.returnTime,null);assert.equal(u.returnDate,'2027-07-07');
const ambiguous=project([midnight,{...midnight,pickupTime:'20:00'}],[row(midnight,false)])[0];assert.equal(ambiguous.pickupTime,null);assert.equal(ambiguous.returnTime,null);assert(!('returnDate' in ambiguous));
const exact=project([midnight,{...midnight,pickupTime:'20:00'}],[row(midnight,false,true,true)])[0];assert.equal(exact.pickupTime,'19:00');assert.equal(exact.returnTime,'00:00','Persisted physical clocks override ambiguous legacy line matching');
const altered={...row(midnight),end:row(midnight).end+1};const unmatched=project([midnight],[altered])[0];assert.equal(unmatched.returnTime,null);assert(!('returnDate' in unmatched));
const legacy={...row(midnight),start:midnight.start,end:midnight.end,endExclusive:undefined,turnaroundBufferMinutes:undefined};assert.equal(project([midnight],[legacy])[0].returnTime,'00:00');
console.log('PASS actual RM booking exporter: buffered and legacy exact rows, conservative allocations, BST/DST signed dates, individual midnight clocks, unknown null preservation and ambiguous/unmatched fail-closed evidence. No provider writes.');
