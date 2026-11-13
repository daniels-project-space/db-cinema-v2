const assert=require('node:assert/strict');const {load,db,put,tables}=require('./lib/rentalTestHarness.cjs');
const replacements=load('convex/rentalReplacements.ts');process.env.ADMIN_TOKEN='fixture-owner-only';const token=process.env.ADMIN_TOKEN;const ctx={db,scheduler:{runAfter:async()=>{}}};
const start=Date.UTC(2030,1,1),end=start+86400000;
function listing(title,type,blocked=false,daily=40){const unit=put('inventory_units',{name:title,quantityOwned:1});return put('listings',{category:type==='lens'?'Lenses':'Cameras',itemType:type,specs:{mount:'E'},active:true,stockMappingStatus:'complete',depositAmount:1000,pricing:{daily},title,r2Images:['/fixture-primary.png'],sourceImages:['https://photos.rental-test.invalid/alternate.png'],components:[{inventoryUnitId:unit._id,qty:1}],...(blocked?{unavailableDates:['2030-02-01']}:{})});}
const body=listing('Unavailable body','camera-body',true),lens=listing('Unavailable lens','lens',true),tripod=listing('Retained tripod','tripod');const bodies=[listing('Replacement body 1','camera-body'),listing('Replacement body 2','camera-body')];const lenses=[listing('Replacement lens 1','lens'),listing('Replacement lens 2','lens')];
const cheaperBody=listing('Lower-priced body','camera-body',false,30),cheaperLens=listing('Lower-priced lens','lens',false,30);
const b=put('bookings',{status:'confirmed',guestEmail:'fixture@rental-test.invalid',total:240,depositAmount:20,lineItems:[body,lens,tripod].map(item=>({listingId:item._id,title:item.title,start,end,qty:1,lineTotal:80})),replacementValues:[body,lens,tripod].map(item=>({listingId:item._id,unitPence:100000}))});
for(const item of [body,lens,tripod])put('reservations',{bookingId:b._id,listingId:item._id,inventoryUnitId:item.components[0].inventoryUnitId,start,end,qty:1,source:'site',status:'confirmed'});
(async()=>{
await assert.rejects(replacements.basketOptions.handler(ctx,{token:'foreign',bookingId:b._id}),/Unauthorized/);
const readBefore=JSON.stringify([...tables].map(([name,rows])=>[name,[...rows.values()]]));
let result=await replacements.basketOptions.handler(ctx,{token,bookingId:b._id});assert.equal(result.originals.length,2);assert.equal(result.options.length,2);assert(result.options.every(option=>option.items.length===2&&option.available));assert(result.options.every(option=>option.items[0].replaces===body.title&&option.items[1].replaces===lens.title));
assert(result.options.every(option=>option.items.every(item=>item.id!==cheaperBody._id&&item.id!==cheaperLens._id)),'Free basket replacement options cannot silently change agreed item charges');
assert(result.originals.every(item=>item.image_urls.length===2));assert(result.options.every(option=>option.items.every(item=>item.image_urls.length===2)));
assert.equal(JSON.stringify([...tables].map(([name,rows])=>[name,[...rows.values()]])),readBefore);
const choice=result.options[0];const args={token,bookingId:b._id,requestId:'fixture-basket-12345',replacementId:choice.id,original:choice.original};
for(const field of ['activeDeliveryQuoteId','activePriceAdjustmentId']){await db.patch(b._id,{[field]:'open-change'});const locked=await replacements.basketOptions.handler(ctx,{token,bookingId:b._id});assert(locked.options.every(option=>!option.can_apply));await assert.rejects(replacements.acceptBasket.handler(ctx,args),/legacy replacement is closed.*renter-approved equipment-change proposal/i);await db.patch(b._id,{[field]:undefined});}
// Admin authorization intentionally records an audit event; compare rental,
// reservation, ledger and payment business state while preserving that log.
const snapshot=()=>JSON.stringify([...tables].filter(([name])=>name!=='admin_audit_log').map(([name,rows])=>[name,[...rows.values()]]));
const baseline=snapshot();
await assert.rejects(replacements.acceptBasket.handler(ctx,{...args,original:{...choice.original,lines:choice.original.lines.map((line,index)=>index===0?{...line,qty:2}:line)}}),/legacy replacement is closed.*renter-approved equipment-change proposal/i);
assert.equal(snapshot(),baseline,'A mismatched new request cannot alter booking or reservations');
await assert.rejects(replacements.acceptBasket.handler(ctx,args),/legacy replacement is closed.*renter-approved equipment-change proposal/i);
assert.equal(snapshot(),baseline,'The legacy basket endpoint cannot apply a new change');

// Keep exact replay for old completed basket receipts, without rerunning stock
// or settlement writes.
const priorRows=choice.items.map((item,i)=>({requestId:`${args.requestId}:${choice.original.lines[i].lineIndex}`,lineIndex:choice.original.lines[i].lineIndex,oldListingId:choice.original.lines[i].listingId,newListingId:item.id,qty:choice.original.lines[i].qty,start:choice.original.lines[i].start,end:choice.original.lines[i].end,appliedAt:Date.now()}));
const replacementByLine=new Map(choice.items.map(item=>[item.lineIndex,item]));
await db.patch(b._id,{lineItems:b.lineItems.map((line,index)=>{const replacement=replacementByLine.get(index);return replacement?{...line,listingId:replacement.id,title:replacement.name}:line;}),kitReplacements:priorRows});
const replaySnapshot=snapshot();
assert.deepEqual(await replacements.acceptBasket.handler(ctx,args),{ok:true,replayed:true});
assert.equal(snapshot(),replaySnapshot,'Legacy basket replay is read-only');
await assert.rejects(replacements.acceptBasket.handler(ctx,{...args,replacementId:args.replacementId.split('|').reverse().join('|')}),/changed/);
assert.equal(snapshot(),replaySnapshot,'A mismatched legacy basket replay cannot write');
console.log('PASS legacy basket replacement: new direct writes blocked; exact completed receipt replay preserved without changing rental or reservations. Suggestions remain read-only.');
})().catch(error=>{console.error(error);process.exitCode=1});
