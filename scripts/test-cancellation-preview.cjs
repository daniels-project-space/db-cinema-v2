const assert=require('node:assert/strict');
const {load,db,put,setMock}=require('./lib/rentalTestHarness.cjs');
const intents=new Map(),refunds=[];let mutations=0,reads=0;
class Stripe{paymentIntents={retrieve:async id=>{reads++;if(!intents.has(id))throw Error('Provider unavailable');return intents.get(id)},cancel:async()=>{mutations++;throw Error('Preview cannot cancel')}};checkout={sessions:{retrieve:async()=>({status:'open'}),expire:async()=>{mutations++;throw Error('Preview cannot expire')}}};refunds={list:()=>({async *[Symbol.asyncIterator](){yield* refunds;}}),create:async()=>{mutations++;throw Error('Preview cannot refund')}};}
setMock('stripe',{__esModule:true,default:Stripe});process.env.STRIPE_SECRET_KEY='sk_test_fixture';process.env.ADMIN_TOKEN='preview-owner';
const checkout=load('convex/checkout.ts'),bookings=load('convex/bookings.ts'),admin=load('convex/adminAuth.ts');
const account=put('accounts',{email:'preview@example.invalid'}),b=put('bookings',{accountId:account._id,status:'confirmed',total:45,depositAmount:25,creditApplied:10,currency:'GBP',stripePaymentIntentId:'pi_main',stripeDepositIntentId:'pi_hold',depositHoldPreviousIntentIds:['pi_old'],lineItems:[{listingId:'camera',qty:1,title:'Camera',start:Date.UTC(2030,0,1),end:Date.UTC(2030,0,2),lineTotal:20}]});
put('reservations',{bookingId:b._id,source:'site',status:'confirmed'});
intents.set('pi_main',{id:'pi_main',status:'succeeded',amount_received:4500,currency:'gbp'});intents.set('pi_hold',{id:'pi_hold',status:'requires_capture',amount_received:0,amount_capturable:10000,currency:'gbp'});intents.set('pi_old',{id:'pi_old',status:'canceled',amount_received:0});
const ctx={db,runQuery:async(ref,args)=>bookings[ref.split('.')[1]].handler(ctx,args),runMutation:async(ref,args)=>{assert.equal(ref,'adminAuth.assertAdminInternal');return admin.assertAdminInternal.handler(ctx,args);}};
const call=()=>checkout.cancellationPreview.handler(ctx,{token:process.env.ADMIN_TOKEN,bookingId:b._id});
(async()=>{
 await assert.rejects(checkout.cancellationPreview.handler(ctx,{token:'renter',bookingId:b._id}),/unauthorized/);assert.equal(reads,0);
 const before=JSON.stringify(b),preview=await call();assert.equal(preview.kind,'full_refund');assert.equal(preview.refundAmount,45);assert.equal(preview.creditAmount,10);assert.equal(preview.holdReleaseAmount,100);assert(!JSON.stringify(preview).includes('pi_'));assert(preview.checkedAt);assert.equal(JSON.stringify(b),before);assert.equal(mutations,0);
 refunds.push({id:'re_partial',status:'succeeded',amount:500});assert.equal((await call()).refundAmount,40);
 await db.patch(b._id,{lineItems:[{...b.lineItems[0],start:Date.now(),end:Date.now()+86400000}]});const credit=await call();assert.equal(credit.kind,'store_credit');assert.equal(credit.refundAmount,25);assert.equal(credit.creditAmount,25);
 intents.set('pi_hold',{id:'pi_hold',status:'succeeded',amount_received:10000});await assert.rejects(call(),/captured charge/);
 intents.set('pi_hold',{id:'pi_hold',status:'processing',amount_received:0});await assert.rejects(call(),/still processing/);
 intents.set('pi_hold',{id:'pi_hold',status:'requires_capture',amount_received:0,amount_capturable:10000,currency:'usd'});await assert.rejects(call(),/needs review/);
 intents.set('pi_hold',{id:'pi_hold',status:'canceled',amount_received:0});intents.set('pi_main',{id:'pi_main',status:'processing',amount_received:0,currency:'gbp'});await assert.rejects(call(),/payment needs review/);
 await db.patch(b._id,{status:'pending_payment',stripePaymentIntentId:undefined,stripeCheckoutSessionId:'cs_open',creditApplied:0});const unpaid=await call();assert.equal(unpaid.refundAmount,0);assert.equal(unpaid.holdReleaseAmount,0);assert.equal(mutations,0,'no expiry, refund or hold release from preview');
 console.log('PASS actual admin cancellation preview: live balances, prior refunds, policy cash/credit split, credit restoration, deduped uncaptured holds, captured/pending/currency errors, denied reads and open checkout without expiry. Controlled provider transport; no external writes.');
})().catch(e=>{console.error(e);process.exitCode=1;});
