const assert=require('node:assert/strict');
const {load,db,put,tables,setMock}=require('./lib/rentalTestHarness.cjs');
// Keep offer fingerprints and exact expiry assertions on one deterministic clock.
// Convex mutations use a fixed clock; this handler harness runs in ordinary Node.
const realDateNow=Date.now,fixtureNow=realDateNow();
Date.now=()=>fixtureNow;
let refunds=0,releases=0;
class Stripe {
 constructor(){this.paymentIntents={retrieve:async id=>id==='hold'?{id,status:'requires_capture'}:{id,status:'succeeded',amount_received:12000},cancel:async()=>{releases++;return {status:'canceled'}}};this.refunds={list:()=>({async *[Symbol.asyncIterator](){}}),create:async()=>{refunds++;throw Error('Credit path must not refund cash')}}}
}
setMock('stripe',{default:Stripe});process.env.STRIPE_SECRET_KEY='sk_test_fixture';process.env.CUSTOMER_BOOKING_ACTIONS='true';process.env.ADMIN_TOKEN='owner-fixture';
const bookingFns=load('convex/bookings.ts'),offers=load('convex/rentalCreditOffers.ts'),checkout=load('convex/checkout.ts'),accounts=load('convex/accounts.ts'),cancellationRecovery=load('convex/cancellationRecovery.ts');
const account=put('accounts',{email:'credit@rental-test.invalid'}),foreign=put('accounts',{email:'foreign@rental-test.invalid'});
put('sessions',{token:'owned',accountId:account._id,expiresAt:Date.now()+600000});put('sessions',{token:'foreign',accountId:foreign._id,expiresAt:Date.now()+600000});
const b=put('bookings',{guestEmail:account.email,status:'confirmed',total:120,depositAmount:20,creditApplied:30,currency:'GBP',stripePaymentIntentId:'paid',stripeDepositIntentId:'hold',lineItems:[{listingId:'camera',title:'Camera',qty:1,lineTotal:100,start:Date.now()+5*86400000,end:Date.now()+6*86400000}]});
put('reservations',{bookingId:b._id,source:'site',status:'confirmed'});
const ctx={db,storage:{getUrl:async()=>null},scheduler:{runAfter:async()=>{}},runQuery:async(ref,args)=>{
 const [module,name]=ref.split('.');return ({bookings:bookingFns,rentalCreditOffers:offers,accounts})[module][name].handler(ctx,args);
},runMutation:async(ref,args)=>{
 const [module,name]=ref.split('.');
 return ({bookings:bookingFns,rentalCreditOffers:offers,cancellationRecovery})[module][name].handler(ctx,args);
}};
(async()=>{
 const protectedRental=put('bookings',{...b,_id:'protected-v16',agreementDocs:[{kind:'cancellation',version:'2026-10-v16'}]});
 const beforeMessages=(tables.get('messages')??[]).length;
 assert.equal(await checkout.offerFullCredit.handler(ctx,{accountId:account._id,bookingId:protectedRental._id}),null);
 await assert.rejects(offers.create.handler(ctx,{accountId:account._id,bookingId:protectedRental._id,amountPence:12000,fingerprint:load('convex/lib/rentalCreditPolicy.ts').creditOfferFingerprint(protectedRental)}),/legacy deposit-to-credit offer/);
 assert.equal((tables.get('messages')??[]).length,beforeMessages,'v16 cannot send a legacy credit invitation');
 assert.equal((tables.get('rental_credit_offers')??[]).length,0,'v16 cannot create a deposit-to-credit quote');
 const id=await checkout.offerFullCredit.handler(ctx,{accountId:account._id,bookingId:b._id});assert.ok(id);
 assert.equal((await db.get(id)).amountPence,15000,'full remaining payment plus previously redeemed credit');
 assert.equal((await offers.get.handler(ctx,{token:'owned',offerId:id})).bookingId,String(b._id),'the renter sees only their booking id for the review handoff');
 assert.equal(await offers.get.handler(ctx,{token:'foreign',offerId:id}),null,'a different account cannot read or request review for the offer');
 assert.equal((tables.get('messages')??[]).filter(m=>m.meta?.kind==='full_credit_offer').length,1);
 assert.equal(await checkout.offerFullCredit.handler(ctx,{accountId:account._id,bookingId:b._id}),id,'duplicate quote reuses invitation');
 await assert.rejects(checkout.acceptFullCredit.handler(ctx,{token:'foreign',offerId:id,consent:true}),/unavailable/);
 await assert.rejects(checkout.acceptFullCredit.handler(ctx,{token:'owned',offerId:id,consent:false}),/review/);
 await assert.rejects(checkout.acceptFullCredit.handler(ctx,{token:'owned',offerId:id,consent:true}),/team approval/);
 assert.equal(b.status,'confirmed','renter acceptance cannot cancel the booking');
 assert.equal(b.cancellationDecision,undefined,'renter acceptance cannot persist a cancellation decision');
 assert.equal((tables.get('credits')??[]).length,0,'renter acceptance cannot issue account credit');
 assert.equal(refunds,0,'renter acceptance cannot refund payment');
 assert.equal(releases,0,'renter acceptance cannot release the card hold');
 assert.equal((await db.get(id)).status,'offered','the offer remains open for team review');
 const {assertCreditOffer,creditOfferFingerprint}=load('convex/lib/rentalCreditPolicy.ts');
 const open={...b,status:'confirmed',cancellationDecision:undefined};
 const offer={bookingId:b._id,expiresAt:Date.now()+60000,fingerprint:creditOfferFingerprint(open)};
 assert.throws(()=>assertCreditOffer({...offer,expiresAt:0},open),/no longer/);
 assert.throws(()=>assertCreditOffer(offer,{...open,total:121}),/no longer/);
 assert.throws(()=>assertCreditOffer({...offer,fingerprint:creditOfferFingerprint({...open,lineItems:[{...open.lineItems[0],start:Date.now()+86400000}]})},{...open,lineItems:[{...open.lineItems[0],start:Date.now()+86400000}]}),/no longer/);
 console.log('PASS full credit: owner-bound offer, accurate quote, one invitation, direct acceptance blocked, no cancellation/refund/credit/hold mutation, stale/changed/late offers rejected.');
})().catch(e=>{console.error(e);process.exitCode=1}).finally(()=>{Date.now=realDateNow});
