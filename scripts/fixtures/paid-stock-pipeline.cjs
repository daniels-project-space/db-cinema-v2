/** Export real source-handler projections, in-memory only; never contacts providers. */
Date.now=()=>Date.UTC(2034,11,31,12);
const {load,db,put}=require('../lib/rentalTestHarness.cjs');
const bookings=load('convex/bookings.ts'),sync=load('convex/rmv2_sync.ts');
const masterId=process.argv[2];if(!masterId)throw Error('Fixture master ID required');
const account=put('accounts',{email:'cross-stock@rental-test.invalid',name:'Cross-stock fixture'});
const unit=put('inventory_units',{name:'Sony FX3',sku:'fixture-body',quantityOwned:1,active:true,rmv2ItemId:masterId,hyggloProductId:42});
const listing=put('listings',{title:'Sony FX3',active:true,depositAmount:1000,pricing:{daily:10},components:[{inventoryUnitId:unit._id,qty:1}]});
const start=Date.UTC(2035,0,1),end=Date.UTC(2035,0,2);const booking=put('bookings',{status:'pending_payment',guestEmail:account.email,guestName:account.name,accountId:account._id,fulfilment:'pickup',pickupTime:'10:00',returnTime:'17:00',subtotal:20,total:70,discount:0,deliveryFee:0,depositAmount:50,depositHoldAmount:0,securityPolicyVersion:'2026-10-refundable-deposit-v1',savedCardLimit:100,verificationRequired:true,createdAt:Date.now(),lineItems:[{listingId:listing._id,title:listing.title,qty:1,start,end,lineTotal:20}],replacementValues:[{listingId:listing._id,unitPence:100000}]});
const ctx={db,scheduler:{runAfter:async()=>{}}};
(async()=>{await load("convex/sync.ts").applySharedStock.handler(ctx,{snapshot:{version:2,turnaroundBufferMinutes:60,checkedAt:Date.now(),units:[{masterItemId:masterId,active:true,quantityOwned:1,windows:[]}]}});await bookings.placeHolds.handler(ctx,{bookingId:booking._id,ttlMs:30*60000});const unpaid=await sync.forRmv2SyncOne.handler(ctx,{bookingId:booking._id});await bookings.confirm.handler(ctx,{bookingId:booking._id,paymentIntentId:'pi_isolated_paid'});const paid=await sync.forRmv2SyncOne.handler(ctx,{bookingId:booking._id});await bookings.markReturnedStatus.handler(ctx,{bookingId:booking._id});const returned=await sync.forRmv2SyncOne.handler(ctx,{bookingId:booking._id});process.stdout.write(JSON.stringify({unpaid,paid,returned}));})().catch(e=>{console.error(e);process.exitCode=1});
