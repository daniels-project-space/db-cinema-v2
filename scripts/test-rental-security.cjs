const assert=require('node:assert/strict');
const {load,db,put,setMock}=require('./lib/rentalTestHarness.cjs');
const security=load('shared/rentalSecurity.ts');
for(const protection of ['verify','deposit']) {
 for(const [value,deposit,hold] of [[0,100,0],[299.99,100,30],[300,100,30],[999.99,100,100],[2500,62.5,250],[10000,100,1000]]) assert.deepEqual(security.rentalSecurity(protection,value),{deposit,hold});
}
assert.deepEqual(security.rentalSecurity('verify',1000),{deposit:25,hold:100});
assert.deepEqual(security.rentalSecurity('deposit',1000),{deposit:25,hold:100});
assert.throws(()=>security.rentalSecurity('verify',NaN),/Invalid/);
assert.deepEqual(security.securityForPolicy('2026-10-value-bands-v1','verify',2500),{deposit:62.5,hold:125});
assert.deepEqual(security.securityForPolicy(undefined,'verify',2500),{deposit:62.5,hold:125});
let intentCalls=0;
class StripeFixture {
 checkout={sessions:{retrieve:async()=>({status:'complete',payment_status:'paid',metadata:{bookingId:'booking'},customer:'cus_test',payment_intent:'pi_paid'})}};
 paymentIntents={retrieve:async()=>({payment_method:'pm_card'}),create:async(args)=>{intentCalls++;assert.equal(args.amount,10000);assert.equal(args.capture_method,'manual');return {id:'pi_hold',status:'requires_capture',latest_charge:{payment_method_details:{card:{capture_before:Date.now()/1000+86400}}}}}};
}
setMock('stripe',{default:StripeFixture});
const checkout=load('convex/checkout.ts'),catalog=load('convex/catalog.ts');
const {calculateRentalPrice}=load('convex/lib/rentalPrice.ts');
const day=Date.UTC(2030,0,1);
const lens=put('listings',{active:true,title:'Lens',depositAmount:150,pricing:{daily:2000},components:[]});
let member=false;
const ctx={db,runQuery:async(ref,args)=>{
 if(ref==='catalog.repriceLines')return catalog.repriceLines.handler({db},args);
 if(ref==='accounts._byEmail')return load('convex/accounts.ts')._byEmail.handler({db},args);
 if(ref==='accounts._byToken')return member ? {_id:'account',email:'renter@example.invalid',membershipActive:true,membershipStatus:'active',membershipPaidThrough:Date.now()+86400000,membershipTier:'plus'} : null;
 if(ref==='bookings.availableCheckoutCredit')return 0;
 if(ref==='membershipBenefits.deliveryAvailable')return true;
 throw Error('Unexpected query '+ref);
}};
const line={listingId:lens._id,title:'forged',qty:1,start:day,end:day,total:1,deposit:999999};
(async()=>{
 let p=await calculateRentalPrice(ctx,{items:[line],customer:{email:'renter@example.invalid'},fulfilment:'pickup'});
 assert.equal(p.securityPolicyVersion,security.SECURITY_POLICY_VERSION);assert.equal(p.subtotal,2000);assert.equal(p.replacementSum,150);assert.equal(p.depositAmount,100);assert.equal(p.depositHoldAmount,15);
 p=await calculateRentalPrice(ctx,{items:[line,{...line,start:day+86400000,end:day+86400000}],customer:{email:'renter@example.invalid'},fulfilment:'pickup'});
 assert.equal(p.replacementSum,300);assert.equal(p.depositAmount,100);assert.equal(p.depositHoldAmount,30,'Hold uses the complete canonical equipment value');
 member=true;p=await calculateRentalPrice(ctx,{items:[line],token:'token',customer:{email:'renter@example.invalid'},fulfilment:'pickup'});assert.equal(p.depositAmount,0);assert.equal(p.depositHoldAmount,15,'Paid membership waives only the refundable payment, not the required 10% hold');
 process.env.STRIPE_SECRET_KEY='sk_test_fixture';
 let amount=0;const writes=[];
 const holdCtx={runQuery:async()=>({amount,status:'confirmed'}),runMutation:async(_ref,args)=>writes.push(args)};
 assert.equal((await checkout.syncHold.handler(holdCtx,{sessionId:'cs_paid'})).status,'not_applicable');assert.equal(intentCalls,0);assert.equal(writes.length,0);
 amount=100;assert.equal((await checkout.syncHold.handler(holdCtx,{sessionId:'cs_paid'})).status,'held');assert.equal(intentCalls,1);assert.equal(writes[0].status,'held');
 console.log('PASS 10% card security: penny rounding, preserved prior policies, both protection inputs, canonical catalog aggregate (not rental price/client values), paid waiver, zero-hold Stripe skip and £100 manual hold.');
})().catch(e=>{console.error(e);process.exitCode=1;});
