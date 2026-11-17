const assert=require('node:assert/strict');
const {load,db,put}=require('./lib/rentalTestHarness.cjs');
const checkout=load('convex/checkout.ts');
const bookings=load('convex/bookings.ts');

(async()=>{
  const session={id:'cs-receipt',status:'complete',payment_status:'paid',amount_total:10000,currency:'gbp',
    payment_intent:'pi-receipt',metadata:{bookingId:'booking-receipt'}};
  const sb={paymentIntents:{retrieve:async id=>({id,status:'succeeded',amount_received:10000,currency:'gbp'})},
    invoicePayments:{list:async()=>({data:[]})}};
  const receipt=await checkout.verifiedCheckoutReceipt(sb,session);
  assert.deepEqual(receipt,{paymentIntentId:'pi-receipt',amountTotalPence:10000,currency:'gbp',paymentStatus:'paid'});
  await assert.rejects(()=>checkout.verifiedCheckoutReceipt({...sb,paymentIntents:{retrieve:async()=>({status:'succeeded',amount_received:9999,currency:'gbp'})}},session),/amount or currency/);
  await assert.rejects(()=>checkout.verifiedCheckoutReceipt({...sb,paymentIntents:{retrieve:async()=>({status:'requires_capture',amount_received:10000,currency:'gbp'})}},session),/amount or currency/);

  const booking=put('bookings',{status:'pending_payment',stripeCheckoutSessionId:session.id,total:100,currency:'GBP',checkoutExpectedAmountPence:10000,
    verificationProvider:'didit',idVerifyStatus:'required',lineItems:[]});
  const ctx={db,scheduler:{runAfter:async()=>{}}};
  await assert.rejects(()=>bookings.recordPaidCheckoutReceipt.handler(ctx,{bookingId:booking._id,sessionId:session.id,
    paymentIntentId:'pi-receipt',amountTotalPence:9999,currency:'gbp',paymentStatus:'paid'}),/amount or currency/);
  await assert.rejects(()=>bookings.recordPaidCheckoutReceipt.handler(ctx,{bookingId:booking._id,sessionId:session.id,
    paymentIntentId:'pi-receipt',amountTotalPence:10000,currency:'usd',paymentStatus:'paid'}),/amount or currency/);
  await assert.rejects(()=>bookings.recordPaidCheckoutReceipt.handler(ctx,{bookingId:booking._id,sessionId:session.id,
    paymentIntentId:'pi-receipt',amountTotalPence:10001,currency:'gbp',paymentStatus:'paid'}),/amount or currency/);
  assert.equal(booking.checkoutPaidAt,undefined,'invalid provider receipts never mark a booking paid');
  await bookings.recordPaidCheckoutReceipt.handler(ctx,{bookingId:booking._id,sessionId:session.id,
    paymentIntentId:'pi-receipt',amountTotalPence:10000,currency:'gbp',paymentStatus:'paid'});
  assert.equal(booking.checkoutPaymentAmountPence,10000);assert.equal(booking.checkoutPaymentCurrency,'GBP');
  assert.equal(booking.checkoutPaymentStatus,'paid');assert.equal(booking.checkoutPaidAt>0,true);

  const partial=put('bookings',{status:'pending_payment',stripeCheckoutSessionId:'cs-partial-credit',total:0,currency:'GBP',subtotal:100,discount:0,creditApplied:0.01,
    verificationProvider:'didit',idVerifyStatus:'required',lineItems:[]});
  await assert.rejects(()=>bookings.recordPaidCheckoutReceipt.handler(ctx,{bookingId:partial._id,sessionId:'cs-partial-credit',amountTotalPence:0,currency:'gbp',paymentStatus:'no_payment_required'}),/zero-payment checkout/);
  const zero=put('bookings',{status:'pending_payment',stripeCheckoutSessionId:'cs-credit',total:0,currency:'GBP',subtotal:100,discount:0,creditApplied:100,
    verificationProvider:'didit',idVerifyStatus:'required',lineItems:[]});
  await bookings.recordPaidCheckoutReceipt.handler(ctx,{bookingId:zero._id,sessionId:'cs-credit',amountTotalPence:0,currency:'gbp',paymentStatus:'no_payment_required'});
  assert.equal(zero.checkoutPaymentStatus,'no_payment_required');

  const setupSession={id:'cs-setup',status:'complete',mode:'setup',payment_status:'no_payment_required',amount_total:0,currency:'gbp',
    customer:'cus-rental',setup_intent:'seti-rental',metadata:{bookingId:'booking-setup'}};
  const setupClient={setupIntents:{retrieve:async id=>({id,status:'succeeded',customer:'cus-rental',payment_method:'pm-rental',usage:'off_session'})},
    paymentMethods:{retrieve:async id=>({id,type:'card',customer:'cus-rental'})},invoicePayments:{list:async()=>({data:[]})}};
  assert.deepEqual(await checkout.checkoutSavedCard(setupSession,setupClient),{customerId:'cus-rental',paymentMethodId:'pm-rental'});
  await assert.rejects(()=>checkout.checkoutSavedCard({...setupSession,setup_intent:null},setupClient),/reusable card could not be saved/);
  await assert.rejects(()=>checkout.checkoutSavedCard(setupSession,{...setupClient,setupIntents:{retrieve:async id=>({id,status:'requires_action',customer:'cus-rental',payment_method:'pm-rental'})}}),/SetupIntent has not successfully saved/);
  await assert.rejects(()=>checkout.checkoutSavedCard(setupSession,{...setupClient,setupIntents:{retrieve:async id=>({id,status:'succeeded',customer:'cus-other',payment_method:'pm-rental'})}}),/SetupIntent has not successfully saved/);
  await assert.rejects(()=>checkout.checkoutSavedCard(setupSession,{...setupClient,setupIntents:{retrieve:async id=>({id,status:'succeeded',customer:'cus-rental',payment_method:'pm-rental',usage:'on_session'})}}),/SetupIntent has not successfully saved/);
  await assert.rejects(()=>checkout.checkoutSavedCard(setupSession,{...setupClient,paymentMethods:{retrieve:async id=>({id,type:'card',customer:'cus-other'})}}),/not attached to this rental customer/);

  const paidCardSession={id:'cs-paid-card',status:'complete',mode:'payment',payment_status:'paid',amount_total:10000,currency:'gbp',
    customer:'cus-rental',payment_intent:'pi-saved-card',metadata:{bookingId:'booking-paid-card'}};
  const paidCardClient={paymentIntents:{retrieve:async id=>({id,status:'succeeded',customer:'cus-rental',setup_future_usage:'off_session',payment_method:'pm-rental'})},
    paymentMethods:{retrieve:async id=>({id,type:'card',customer:'cus-rental'})},invoicePayments:{list:async()=>({data:[]})}};
  assert.deepEqual(await checkout.checkoutSavedCard(paidCardSession,paidCardClient),{customerId:'cus-rental',paymentMethodId:'pm-rental'});
  await assert.rejects(()=>checkout.checkoutSavedCard(paidCardSession,{...paidCardClient,paymentIntents:{retrieve:async id=>({id,status:'succeeded',customer:'cus-rental',setup_future_usage:null,payment_method:'pm-rental'})}}),/reusable card could not be saved/);

  const security=load('shared/rentalSecurity.ts');
  const unready=put('bookings',{status:'pending_verification',securityPolicyVersion:security.IMMEDIATE_CLAIM_SECURITY_POLICY_VERSION,
    savedCardStatus:'needs_setup',lineItems:[],guestEmail:'unready@example.invalid'});
  await assert.rejects(()=>bookings.confirm.handler({db,scheduler:{runAfter:async()=>{}}},{bookingId:unready._id}),/successful reusable-card setup/);
  unready.checkoutPaidAt=Date.now();const scheduled=[],alerts=[];let attempts=0;
  const recoveryCtx={runQuery:async()=>unready,runAction:async()=>{attempts++;throw Object.assign(Error('provider unavailable'),{type:'StripeConnectionError'})},runMutation:async(ref,a)=>alerts.push({ref,a}),scheduler:{runAfter:async(ms,ref,args)=>scheduled.push({ms,ref,args})}};
  await checkout.recoverPendingSavedCard.handler(recoveryCtx,{bookingId:unready._id,attempt:1});
  assert.equal(scheduled[0].args.attempt,2);assert.equal(alerts.length,0);
  await checkout.recoverPendingSavedCard.handler(recoveryCtx,{bookingId:unready._id,attempt:3});
  assert.equal(alerts[0].ref,'savedCardState.alertRecoveryFailure');
  unready.savedCardStatus='saved';await checkout.recoverPendingSavedCard.handler(recoveryCtx,{bookingId:unready._id,attempt:1});assert.equal(attempts,2,'saved receipts are not retried');
  unready.savedCardStatus='needs_setup';recoveryCtx.runAction=async()=>{throw Error('card receipt does not match')};
  await checkout.recoverPendingSavedCard.handler(recoveryCtx,{bookingId:unready._id,attempt:1});assert.equal(scheduled.length,1,'permanent errors are not retried');assert.equal(alerts.length,2);
  console.log('PASS Stripe checkout receipts: payment and credit coverage are verified; reusable cards require a successful, customer-bound SetupIntent or payment method before confirmation.');
})().catch(error=>{console.error(error);process.exitCode=1;});
