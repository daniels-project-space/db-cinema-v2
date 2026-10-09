const assert=require('node:assert/strict'),h=require('./lib/rentalTestHarness.cjs');
const ops=h.load('convex/rentalOperations.ts'),requests=h.load('convex/rentalRequests.ts'),billing=h.load('convex/lib/rentalBillingLines.ts'),policy=h.load('src/lib/cancellationPolicy.ts');
process.env.ADMIN_TOKEN='kit-removal-owner';const jobs=[],ctx={db:h.db,scheduler:{runAfter:async(...args)=>jobs.push(args)}};
const account=h.put('accounts',{email:'owner-linked@example.invalid'}),foreign=h.put('accounts',{email:'reused@example.invalid'});
h.put('sessions',{token:'renter',accountId:account._id,expiresAt:Date.now()+60000});
const unit=h.put('inventory_units',{name:'Camera pool',quantityOwned:10}),listing=h.put('listings',{title:'Sony FX3',active:true,components:[{inventoryUnitId:unit._id,qty:1}]});
const start=Date.UTC(2030,0,10),end=start+86400000;
function fixture(qty=3){const b=h.put('bookings',{accountId:account._id,guestEmail:foreign.email,status:'confirmed',subtotal:100.01,total:150.01,depositAmount:50,depositHoldAmount:100,lineItems:[{listingId:listing._id,title:listing.title,qty,start,end,lineTotal:100.01,dailyRate:60}]});h.put('reservations',{bookingId:b._id,listingId:listing._id,inventoryUnitId:unit._id,start,end,qty,status:'confirmed',source:'site'});return b}
function request(b,extra={}){return h.put('rental_change_requests',{requestId:'removal-'+b._id,bookingId:b._id,accountId:account._id,kind:'items',status:'approved',detail:'Please remove one camera.',messageId:'message-fixture',createdAt:Date.now(),kitSelection:{change:'remove',lineIndex:0,quantity:1,note:'Please remove one camera.',source:{listingId:listing._id,qty:b.lineItems[0].qty,start,end},sourceListingId:listing._id,sourceQty:b.lineItems[0].qty,sourceStart:start,sourceEnd:end,sourceTitle:listing.title},...extra})}
function args(b,r){return{token:process.env.ADMIN_TOKEN,bookingId:b._id,changeRequestId:r._id,requestId:'removal-operation-'+b._id,lineIndex:0,listingId:listing._id,expectedQty:b.lineItems[0].qty,expectedStart:start,expectedEnd:end,removeQty:1,keepAgreedCharges:true,reason:'Agreed removal of one camera.'}}
(async()=>{const b=fixture(),r=request(b),a=args(b,r);
 await assert.rejects(ops.removeItem.handler(ctx,{...a,token:'renter'}),/unauthorized/);
 await assert.rejects(ops.removeItem.handler(ctx,{...a,keepAgreedCharges:false}),/Confirm.*charges/);
 await assert.rejects(ops.removeItem.handler(ctx,{...a,removeQty:2}),/does not match/);
 await assert.rejects(ops.removeItem.handler(ctx,{...a,expectedEnd:end+86400000}),/does not match/);
 const fr=request(b,{accountId:foreign._id});await assert.rejects(ops.removeItem.handler(ctx,{...a,changeRequestId:fr._id}),/approved request/);
 const wrong=request(b,{kitSelection:{...r.kitSelection,change:'swap'}});await assert.rejects(ops.removeItem.handler(ctx,{...a,changeRequestId:wrong._id}),/approved equipment removal/);
 const history=await requests.agreedKit.handler(ctx,{token:process.env.ADMIN_TOKEN,bookingId:b._id,id:r._id});assert.equal(history.kitSelection.quantity,1);assert.equal(await requests.agreedKit.handler(ctx,{token:'renter',bookingId:b._id,id:r._id}),null);
 await ops.removeItem.handler(ctx,a);
 assert.equal(b.lineItems.length,1);assert.equal(b.lineItems[0].qty,2);assert.equal(b.lineItems[0].dailyRate,40);assert.equal(b.lineItems[0].lineTotal,66.67);assert.equal(b.removedItems[0].lineTotal,33.34);assert.equal(b.removedItems[0].qty,1);assert.equal(b.removedItems[0].sourceQty,3);assert.equal(b.removedItems[0].changeRequestId,r._id);assert.equal(Math.round(billing.rentalBillingLines(b).reduce((n,l)=>n+l.lineTotal,0)*100),10001,'invoice keeps every originally agreed penny');
 assert.equal(b.total,150.01);assert.equal(b.subtotal,100.01);assert.equal(b.depositAmount,50);assert.equal(b.depositHoldAmount,100);assert.equal(policy.rentalCancellationStart(b),start);
 const live=h.tables.get('reservations').filter(row=>row.bookingId===b._id&&row.status==='confirmed');assert.equal(live.length,1);assert.equal(live[0].qty,2,'only one physical unit released');
 assert.equal(r.execution.operation,'kit_removal');assert.equal(r.execution.status,'applied');const messages=h.tables.get('messages').length,jobCount=jobs.length;
 await ops.removeItem.handler(ctx,a);assert.equal(b.lineItems[0].qty,2);assert.equal(h.tables.get('messages').length,messages);assert.equal(jobs.length,jobCount,'exact replay cannot release stock or notify twice');
 await assert.rejects(ops.removeItem.handler(ctx,{...a,reason:'Changed agreed reason'}),/operation has changed/);
 await assert.rejects(ops.removeItem.handler(ctx,{...a,changeRequestId:undefined}),/Removal request has changed/);
 const staleB=fixture(),staleR=request(staleB),staleArgs=args(staleB,staleR);staleB.lineItems[0].qty=2;await assert.rejects(ops.removeItem.handler(ctx,staleArgs),/kit changed/);
 const finalB=fixture(1),finalR=request(finalB);await assert.rejects(ops.removeItem.handler(ctx,args(finalB,finalR)),/last item/);
 const legacyB=fixture(2);await ops.removeItem.handler(ctx,{...args(legacyB,request(legacyB)),changeRequestId:undefined,removeQty:1});assert.equal(legacyB.lineItems[0].qty,1,'unlinked explicit partial removal remains guarded');
 console.log('PASS approved partial removal: account/kind/source/quantity/consent fences, exact inventory release, charge/security/cancellation preservation, penny-balanced invoices, completion receipt and deduplicated replay. No provider writes.');
})().catch(e=>{console.error(e);process.exit(1)});
