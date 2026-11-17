const assert=require('node:assert/strict'),h=require('./lib/rentalTestHarness.cjs');
process.env.STRIPE_SECRET_KEY='sk_test_fixture';
const bookingId='bookings-fixture',customer='cus_fixture',method='pm_fixture';
const session={id:'cs_fixture',status:'complete',payment_status:'paid',mode:'payment',amount_total:6500,currency:'gbp',customer,payment_intent:'pi_fixture',metadata:{bookingId}};
const payment={id:'pi_fixture',status:'succeeded',amount_received:6500,currency:'gbp',customer,payment_method:method,setup_future_usage:'off_session'};
class StripeFixture{constructor(){this.checkout={sessions:{retrieve:async()=>session}};this.paymentIntents={retrieve:async()=>payment};this.paymentMethods={retrieve:async()=>({id:method,type:'card',customer})}}}
h.setMock('stripe',{default:StripeFixture});
const checkout=h.load('convex/checkout.ts'),policy=h.load('shared/rentalSecurity.ts');
const booking={status:'pending_verification',checkoutPaidAt:Date.now(),stripeCheckoutSessionId:session.id,stripePaymentIntentId:payment.id,securityPolicyVersion:policy.SETUP_INTENT_SECURITY_POLICY_VERSION,total:65,currency:'GBP',savedCardStatus:'awaiting_payment'};
const calls=[];let apply=true;
const ctx={runQuery:async()=>booking,runMutation:async(ref,args)=>{calls.push({ref,args});return ref==='savedCardState.save'?apply:true}};
(async()=>{
 await checkout.prepareSavedCard.handler(ctx,{bookingId});assert.equal(calls[0].ref,'savedCardState.save');assert.equal(calls[0].args.customerId,customer);assert.equal(calls[0].args.paymentMethodId,method);
 calls.length=0;payment.setup_future_usage=null;await assert.rejects(checkout.prepareSavedCard.handler(ctx,{bookingId}),/future payments/);assert.deepEqual(calls.map(x=>x.ref),['savedCardState.failed']);
 payment.setup_future_usage='off_session';calls.length=0;payment.amount_received=6400;await assert.rejects(checkout.prepareSavedCard.handler(ctx,{bookingId}),/future payments/);assert.equal(calls.some(x=>x.ref==='savedCardState.save'),false);
 payment.amount_received=6500;calls.length=0;apply=false;await assert.rejects(checkout.prepareSavedCard.handler(ctx,{bookingId}),/could not be recorded/);
 calls.length=0;session.mode='setup';await checkout.prepareSavedCard.handler(ctx,{bookingId});assert.equal(calls.length,0,'setup checkout retains its existing confirmation path');session.mode='payment';
 calls.length=0;delete booking.checkoutPaidAt;await checkout.prepareSavedCard.handler(ctx,{bookingId});assert.equal(calls.length,0,'unpaid booking cannot reach Stripe or save');
 booking.checkoutPaidAt=Date.now();const scheduled=[],alerts=[];let attempts=0;
 const retryCtx={runQuery:async()=>booking,runAction:async()=>{attempts++;throw Object.assign(Error('unavailable'),{type:'StripeConnectionError'})},runMutation:async(ref)=>alerts.push(ref),scheduler:{runAfter:async(ms,ref,args)=>scheduled.push({ms,ref,args})}};
 await checkout.recoverPendingSavedCard.handler(retryCtx,{bookingId,attempt:1});assert.equal(scheduled[0].args.attempt,2);
 await checkout.recoverPendingSavedCard.handler(retryCtx,{bookingId,attempt:3});assert.equal(alerts[0],'savedCardState.alertRecoveryFailure');
 booking.savedCardStatus='saved';await checkout.recoverPendingSavedCard.handler(retryCtx,{bookingId,attempt:1});assert.equal(attempts,2);
 booking.savedCardStatus='needs_setup';retryCtx.runAction=async()=>{throw Error('receipt mismatch')};await checkout.recoverPendingSavedCard.handler(retryCtx,{bookingId,attempt:1});assert.equal(scheduled.length,1,'permanent failures are not retried');assert.equal(alerts.length,2);
 console.log('PASS paid pending Stripe receipt: exact payment, off-session usage, owned card and accepted database write required; no live calls.');
})().catch(e=>{console.error(e);process.exitCode=1});
