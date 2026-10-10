const assert=require('node:assert/strict'),h=require('./lib/rentalTestHarness.cjs');
process.env.ADMIN_TOKEN='refund-payment-binding-owner';
process.env.STRIPE_SECRET_KEY='sk_test_isolated_refund_transport';
const paid=new Map(),providerRefunds=new Map(),providerKeys=new Map(),providerRequests=[],providerStatus=new Map(),paymentOverrides=new Map();
let loseResponse=false;
h.setMock('stripe',{default:class {
 constructor(){
  this.paymentIntents={retrieve:async id=>{assert(paid.has(id),'provider read is restricted to the fixture rental payments');return {id,amount_received:paid.get(id),currency:'gbp',status:'succeeded',...paymentOverrides.get(id)};}};
  this.refunds={
   list:({payment_intent})=>[...providerRefunds.values()].filter(r=>r.payment_intent===payment_intent),
   retrieve:async id=>[...providerRefunds.values()].find(r=>r.id===id),
   create:async(params,{idempotencyKey})=>{
    providerRequests.push({params:structuredClone(params),idempotencyKey});
    let row=providerKeys.get(idempotencyKey);
    if(row)assert.deepEqual(row.params,params,'a provider retry has the identical frozen request');
    else{assert(paid.has(params.payment_intent));row={id:'re_fixture_'+providerRefunds.size,status:providerStatus.get(params.payment_intent)??'succeeded',amount:params.amount,currency:'gbp',metadata:structuredClone(params.metadata),payment_intent:params.payment_intent,params:structuredClone(params)};providerRefunds.set(row.id,row);providerKeys.set(idempotencyKey,row);}
    if(loseResponse){loseResponse=false;throw Error('Isolated provider response lost after refund creation');}
    return row;
   },
  };
 }
}});
const ops=h.load('convex/rentalOperations.ts'),sources=h.load('convex/lib/rentalPaymentSources.ts');
const ctx={db:{...h.db,get:async id=>{const row=await h.db.get(id);return row?structuredClone(row):null;}},scheduler:{runAfter:async()=>{}}};
function fixture(extra={}){
 const b=h.put('bookings',{status:'confirmed',stripePaymentIntentId:'pi_base_'+h.docs.size,total:150,depositAmount:50,...extra});
 const r=h.put('rental_refunds',{bookingId:b._id,requestId:'refund-'+b._id,amountPence:1000,reason:'Agreed rental adjustment',status:'prepared',createdAt:Date.now(),updatedAt:Date.now()});
 return {b,r};
}
const bind=(r,allocations)=>ops.bindRefundAllocations.handler(ctx,{id:r._id,allocations});
const allocation=(id,amount=1000)=>({paymentIntentId:id,amountPence:amount});
(async()=>{
 const {b,r}=fixture();
 await assert.rejects(bind(r,[allocation('pi_another_rental')]),/belong to this rental/);
 assert.equal(r.allocations,undefined,'foreign payment cannot become the durable refund target');
 const expected=[allocation(b.stripePaymentIntentId)];
 assert.deepEqual(await bind(r,expected),expected);
 assert.deepEqual(await bind(r,expected),expected,'exact retry retains the frozen original-method allocation');
 await assert.rejects(bind(r,[allocation('pi_changed_retry')]),/saved refund allocation/);
 await assert.rejects(bind(r,[allocation(b.stripePaymentIntentId,999)]),/saved refund allocation/);

 const member=fixture({rentalPaidPence:6000});
 member.r.amountPence=1001;
 await assert.rejects(bind(member.r,[allocation(member.b.stripePaymentIntentId,1001)]),/remaining rental payment/);
 assert.equal(member.r.allocations,undefined,'membership fee and refundable deposit cannot fund a rental refund');
 member.r.amountPence=1000;await bind(member.r,[allocation(member.b.stripePaymentIntentId)]);

 const updated=fixture({total:250,depositAmount:75});
 const addition=h.put('rental_additions',{bookingId:updated.b._id,status:'applied',paymentIntentId:'pi_addition_bound',lineTotal:75,securityCharge:25});
 h.put('rental_additions',{bookingId:updated.b._id,status:'paid',paymentIntentId:'pi_unapplied',lineTotal:90,securityCharge:10});
 h.put('booking_change_requests',{bookingId:updated.b._id,type:'extend',status:'applied',paymentIntentId:'pi_extension_bound',priceDelta:30});
 const paymentSources=await sources.rentalPaymentSources(ctx,updated.b);
 assert.equal(paymentSources.find(s=>s.paymentIntentId===addition.paymentIntentId).maxPaidPence,10000,'addition cash has its own paid amount ceiling');
 await assert.rejects(bind(updated.r,[allocation('pi_unapplied')]),/belong to this rental/);
 updated.r.amountPence=7501;
 await assert.rejects(bind(updated.r,[allocation(addition.paymentIntentId,7501)]),/remaining rental payment/);
 updated.r.amountPence=3001;
 await assert.rejects(bind(updated.r,[allocation('pi_extension_bound',3001)]),/remaining rental payment/);

 h.put('rental_refunds',{bookingId:updated.b._id,status:'failed',amountPence:7000,parts:[{paymentIntentId:addition.paymentIntentId,amountPence:7000,status:'succeeded',stripeRefundId:'re_partial'}]});
 updated.r.amountPence=501;
 await assert.rejects(bind(updated.r,[allocation(addition.paymentIntentId,501)]),/remaining rental payment/);
 updated.r.amountPence=500;await bind(updated.r,[allocation(addition.paymentIntentId,500)]);

 const split=fixture({rentalPaidPence:7000});
 h.put('rental_additions',{bookingId:split.b._id,status:'applied',paymentIntentId:'pi_split',lineTotal:10,securityCharge:0});
 split.r.amountPence=1500;const parts=[allocation(split.b.stripePaymentIntentId,500),allocation('pi_split',1000)];
 await bind(split.r,parts);await assert.rejects(bind(split.r,[...parts].reverse()),/saved refund allocation/);
 assert.deepEqual(split.r.allocations,parts,'ordered allocation remains stable for provider idempotency keys');

 const pending=fixture({rentalPaidPence:7000});
 h.put('rental_refunds',{bookingId:pending.b._id,status:'pending',amountPence:1500,allocations:[allocation(pending.b.stripePaymentIntentId,1500)]});
 await assert.rejects(bind(pending.r,[allocation(pending.b.stripePaymentIntentId)]),/remaining rental payment/);
 const legacy=fixture();legacy.r.stripeRefundId='re_existing';
 await assert.rejects(bind(legacy.r,[allocation(legacy.b.stripePaymentIntentId)]),/already started/);
 const missing=fixture();await h.db.delete(missing.b._id);
 await assert.rejects(bind(missing.r,[allocation(missing.b.stripePaymentIntentId)]),/Rental unavailable/);
 const invalid=fixture();await assert.rejects(bind(invalid.r,[allocation(invalid.b.stripePaymentIntentId,500),allocation(invalid.b.stripePaymentIntentId,500)]),/Invalid refund allocation/);
 const checkout=h.load('convex/checkout.ts');
 const actionCtx={
  runQuery:async(ref,args)=>{const [module,name]=ref.split('.');assert.equal(module,'rentalOperations');return ops[name].handler(ctx,args);},
  runMutation:async(ref,args)=>{const [module,name]=ref.split('.');assert.equal(module,'rentalOperations');return ops[name].handler(ctx,args);},
 };
 const live=h.put('bookings',{status:'confirmed',total:170,depositAmount:75,stripePaymentIntentId:'pi_action_original',lineItems:[{start:Date.UTC(2030,0,1),end:Date.UTC(2030,0,2)}]});
 h.put('rental_additions',{bookingId:live._id,status:'applied',lineTotal:75,securityCharge:25,paymentIntentId:'pi_action_addition'});
 paid.set('pi_action_original',7000);paid.set('pi_action_addition',10000);
 const input={token:process.env.ADMIN_TOKEN,bookingId:live._id,requestId:'original-payment-refund-3000',amountPence:3000,reason:'Agreed original-method rental price adjustment'};
 loseResponse=true;
 await assert.rejects(checkout.refundRental.handler(actionCtx,input),/response lost/);
 const durable=(h.tables.get('rental_refunds')??[]).find(x=>x.requestId===input.requestId);
 assert.deepEqual(durable.allocations,[allocation('pi_action_original',2000),allocation('pi_action_addition',1000)]);
 assert.equal(providerRefunds.size,1,'provider created a refund before the lost response');
 providerKeys.clear();durable.createdAt-=25*3600000;
 const result=await checkout.refundRental.handler(actionCtx,input);
 assert.equal(result.status,'succeeded');assert.equal(result.amount,30);assert.equal(providerRefunds.size,2,'late retry recovers the existing refund even after provider idempotency retention expires');
 assert.equal(durable.status,'succeeded');assert.equal(durable.parts.length,2);
 assert.equal([...providerRefunds.values()].reduce((sum,p)=>sum+p.amount,0),3000,'no deposit or membership cash enters the rental refund');
 const requestsBefore=providerRequests.length;await checkout.refundRental.handler(actionCtx,input);
 assert.equal(providerRequests.length,requestsBefore,'completed exact action retry performs no additional refund request');
 for(const mismatch of ['booking','amount','payment','currency','duplicate']){
  const f=fixture({rentalPaidPence:9000});paid.set(f.b.stripePaymentIntentId,9000);
  const receipt={id:'re_mismatch_'+mismatch,status:'succeeded',amount:1000,currency:'gbp',payment_intent:f.b.stripePaymentIntentId,metadata:{rentalRefundId:f.r._id,bookingId:f.b._id,rentalPaymentIntent:f.b.stripePaymentIntentId}};
  if(mismatch==='booking')receipt.metadata.bookingId='another-rental';
  if(mismatch==='amount')receipt.amount=999;
  if(mismatch==='payment')receipt.metadata.rentalPaymentIntent='pi_foreign';
  if(mismatch==='currency')receipt.currency='eur';
  providerRefunds.set(receipt.id,receipt);
  if(mismatch==='duplicate')providerRefunds.set(receipt.id+'-second',{...receipt,id:receipt.id+'-second'});
  const writes=providerRequests.length;
  await assert.rejects(checkout.refundRental.handler(actionCtx,{...input,bookingId:f.b._id,requestId:f.r.requestId,amountPence:f.r.amountPence}),mismatch==='duplicate'?/Multiple provider refunds/:/does not match/);
  assert.equal(providerRequests.length,writes,'unverifiable recovery cannot create another refund');
  assert.equal(f.r.status,'prepared');assert.equal(f.r.parts,undefined);
 }
 const progressing=h.put('bookings',{status:'confirmed',total:170,depositAmount:75,stripePaymentIntentId:'pi_pending_base',lineItems:live.lineItems});
 h.put('rental_additions',{bookingId:progressing._id,status:'applied',lineTotal:75,securityCharge:25,paymentIntentId:'pi_failed_addition'});
 paid.set('pi_pending_base',7000);paid.set('pi_failed_addition',10000);
 providerStatus.set('pi_pending_base','pending');providerStatus.set('pi_failed_addition','failed');
 const progressInput={...input,bookingId:progressing._id,requestId:'pending-part-with-failed-part'};
 const progressResult=await checkout.refundRental.handler(actionCtx,progressInput);
 const progressJob=(h.tables.get('rental_refunds')??[]).find(x=>x.requestId===progressInput.requestId);
 assert.equal(progressJob.status,'pending');assert.equal(progressResult.status,'pending','the action cannot report failed while another refund is still processing');
 for(const prepared of [false,true])for(const bad of [{currency:'eur'},{id:'pi_unrelated'},{status:'requires_capture'}]){
  const f=fixture({rentalPaidPence:9000});paid.set(f.b.stripePaymentIntentId,9000);
  if(prepared)await bind(f.r,[allocation(f.b.stripePaymentIntentId)]);
  paymentOverrides.set(f.b.stripePaymentIntentId,bad);const writes=providerRequests.length;
  await assert.rejects(checkout.refundRental.handler(actionCtx,{...input,bookingId:f.b._id,requestId:f.r.requestId,amountPence:1000}),/identity, currency or capture status/);
  assert.equal(providerRequests.length,writes,'invalid payment is rejected before money creation both before and after allocation binding');
 }
 const depleted=fixture({rentalPaidPence:9000});depleted.r.amountPence=2000;paid.set(depleted.b.stripePaymentIntentId,9000);
 await bind(depleted.r,[allocation(depleted.b.stripePaymentIntentId,2000)]);
 providerRefunds.set('re_outside_app',{id:'re_outside_app',status:'succeeded',amount:3000,currency:'gbp',payment_intent:depleted.b.stripePaymentIntentId,metadata:{}});
 const writes=providerRequests.length;
 await assert.rejects(checkout.refundRental.handler(actionCtx,{...input,bookingId:depleted.b._id,requestId:depleted.r.requestId,amountPence:2000}),/protecting refundable security/);
 assert.equal(providerRequests.length,writes,'a later external refund cannot make the frozen rental refund consume protected deposit cash');
 const bookings=h.load('convex/bookings.ts');
 for(const stage of ['prepared','pending'])for(const status of ['confirmed','active']){
  const f=fixture();f.r.status=stage;
  await assert.rejects(bookings.adminSetStatus.handler(ctx,{token:process.env.ADMIN_TOKEN,bookingId:f.b._id,status}),/refund.*processing/i);
  assert.equal(f.b.status,'confirmed');assert.equal(f.b.pickedUpAt,undefined,'direct admin API cannot bypass the UI refund lock');
 }
 console.log('PASS real refund allocation mutation: rental-owned payment sources, immutable ordered retries, membership/deposit protection, applied addition/extension limits, partial succeeded and pending refund reservations, legacy receipt protection, missing booking and duplicate targets. No Stripe or production writes.');
 console.log('PASS actual checkout.refundRental action with isolated Stripe transport: prepared split targets, lost provider response recovered through the same keys, exactly two original-method refunds, security protected and completed retry performs no provider write.');
})().catch(e=>{console.error(e);process.exitCode=1;});
