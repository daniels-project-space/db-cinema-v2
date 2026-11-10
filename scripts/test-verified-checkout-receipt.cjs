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
  console.log('PASS Stripe checkout receipts: succeeded PI amount/currency and booking minimum checked before paid state; zero-due checkout requires complete account-credit coverage.');
})().catch(error=>{console.error(error);process.exitCode=1;});
