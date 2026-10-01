const assert=require('node:assert/strict');
const {load,db,put,tables,setMock}=require('./lib/rentalTestHarness.cjs');
let refunds=0,releases=0,failFinalize=true;
class Stripe {
 constructor(){this.paymentIntents={retrieve:async id=>id==='hold'?{id,status:'requires_capture'}:{id,status:'succeeded',amount_received:12000},cancel:async()=>{releases++;return {status:'canceled'}}};this.refunds={list:()=>({async *[Symbol.asyncIterator](){}}),create:async()=>{refunds++;throw Error('Credit path must not refund cash')}}}
}
setMock('stripe',{default:Stripe});process.env.STRIPE_SECRET_KEY='sk_test_fixture';process.env.CUSTOMER_BOOKING_ACTIONS='true';process.env.ADMIN_TOKEN='owner-fixture';
const bookingFns=load('convex/bookings.ts'),offers=load('convex/rentalCreditOffers.ts'),checkout=load('convex/checkout.ts'),accounts=load('convex/accounts.ts');
const account=put('accounts',{email:'credit@rental-test.invalid'}),foreign=put('accounts',{email:'foreign@rental-test.invalid'});
put('sessions',{token:'owned',accountId:account._id,expiresAt:Date.now()+600000});put('sessions',{token:'foreign',accountId:foreign._id,expiresAt:Date.now()+600000});
const b=put('bookings',{guestEmail:account.email,status:'confirmed',total:120,depositAmount:20,creditApplied:30,currency:'GBP',stripePaymentIntentId:'paid',stripeDepositIntentId:'hold',lineItems:[{listingId:'camera',title:'Camera',qty:1,lineTotal:100,start:Date.now()+5*86400000,end:Date.now()+6*86400000}]});
put('reservations',{bookingId:b._id,source:'site',status:'confirmed'});
const ctx={db,storage:{getUrl:async()=>null},scheduler:{runAfter:async()=>{}},runQuery:async(ref,args)=>{
 const [module,name]=ref.split('.');return ({bookings:bookingFns,rentalCreditOffers:offers,accounts})[module][name].handler(ctx,args);
},runMutation:async(ref,args)=>{
 const [module,name]=ref.split('.');if(ref==='bookings._finalizeCancellation'&&failFinalize){failFinalize=false;throw Error('database outage after release');}
 return ({bookings:bookingFns,rentalCreditOffers:offers})[module][name].handler(ctx,args);
}};
(async()=>{
 const id=await checkout.offerFullCredit.handler(ctx,{accountId:account._id,bookingId:b._id});assert.ok(id);
 assert.equal((await db.get(id)).amountPence,15000,'full remaining payment plus previously redeemed credit');
 assert.equal((tables.get('messages')??[]).filter(m=>m.meta?.kind==='full_credit_offer').length,1);
 assert.equal(await checkout.offerFullCredit.handler(ctx,{accountId:account._id,bookingId:b._id}),id,'duplicate quote reuses invitation');
 await assert.rejects(checkout.acceptFullCredit.handler(ctx,{token:'foreign',offerId:id,consent:true}),/unavailable/);
 await assert.rejects(checkout.acceptFullCredit.handler(ctx,{token:'owned',offerId:id,consent:false}),/Confirm/);
 await assert.rejects(checkout.acceptFullCredit.handler(ctx,{token:'owned',offerId:id,consent:true}),/database outage/);
 await assert.rejects(bookingFns.prepareCancellation.handler(ctx,{bookingId:b._id}),/Another cancellation choice/,'cash choice cannot race approved credit');
 await db.patch(id,{expiresAt:0});
 await checkout.acceptFullCredit.handler(ctx,{token:'owned',offerId:id,consent:true});
 await checkout.acceptFullCredit.handler(ctx,{token:'owned',offerId:id,consent:true});
 assert.equal(await bookingFns.replaceHold.handler(ctx,{bookingId:b._id,oldIntentId:'hold',newIntentId:'replacement',expiresAt:Date.now()+60000}),false);
 assert.equal(b.status,'cancelled');assert.equal(refunds,0);assert.ok(releases>0);assert.equal(tables.get('credits').length,1);
 const credit=tables.get('credits')[0];assert.equal(credit.amount,150);assert.equal(credit.expiresAt-credit.createdAt,365*86400000);assert.equal((await db.get(id)).status,'accepted');
 const {assertCreditOffer,creditOfferFingerprint}=load('convex/lib/rentalCreditPolicy.ts');
 const open={...b,status:'confirmed',cancellationDecision:undefined};
 const offer={bookingId:b._id,expiresAt:Date.now()+60000,fingerprint:creditOfferFingerprint(open)};
 assert.throws(()=>assertCreditOffer({...offer,expiresAt:0},open),/no longer/);
 assert.throws(()=>assertCreditOffer(offer,{...open,total:121}),/no longer/);
 assert.throws(()=>assertCreditOffer({...offer,fingerprint:creditOfferFingerprint({...open,lineItems:[{...open.lineItems[0],start:Date.now()+86400000}]})},{...open,lineItems:[{...open.lineItems[0],start:Date.now()+86400000}]}),/no longer/);
 console.log('PASS full credit: ownership/consent, accurate quote, once-only invitation, cash/credit exclusion, hold release, outage retry, one-year expiry, stale/changed/late offers rejected.');
})().catch(e=>{console.error(e);process.exitCode=1});
