const assert=require('node:assert/strict');
const {setMock}=require('./lib/rentalTestHarness.cjs');
process.env.STRIPE_SECRET_KEY='sk_test_fixture';
let creates=0,acquire='unknown',bookingAvailable=true;
setMock('stripe',{default:class{constructor(){this.checkout={sessions:{create:async args=>{creates++;return {id:`cs_test_${creates}`,url:'https://checkout.stripe.com/cs_test_fixture',status:'open',payment_status:'unpaid',currency:'gbp',amount_total:args.line_items[0].price_data.unit_amount,expires_at:args.expires_at,metadata:args.metadata};}}};}}});
const payments=require('./lib/rentalTestHarness.cjs').load('convex/rentalSwapPayments.ts');
let swap={_id:'swap-1',bookingId:'booking-1',status:'accepted',acceptedAt:Date.now(),acceptedEmail:'fixture@example.invalid',expiresAt:Date.now()+3600000,quote:{deltaPence:100},oldLine:{title:'old'},newLine:{title:'new'}};
const events=[];
const ctx={
  runMutation:async(ref,args)=>{
    events.push(ref);
    if(ref==='rentalSwapState.accept')return swap;
    if(ref==='swapStockOperations.prepareSwapClaim'){
      if(!bookingAvailable)throw Error('The original equipment booking needs review.');
      return 'claim';
    }
    if(ref==='rentalSwapState.markSessionCreationStarted')return {started:true,replayed:false};
    if(ref==='rentalSwapState.bindSession')return;
    throw Error(`Unexpected mutation ${ref}`);
  },
  runAction:async(ref,args)=>{
    events.push(`${ref}:${args.id}`);
    if(ref==='swapStockOperations.recover')return {status:acquire};
    throw Error(`Unexpected action ${ref}`);
  },
};

(async()=>{
  const args={token:'fixture',id:swap._id,confirmed:true,expectedDeltaPence:100};
  await assert.rejects(payments.accept.handler(ctx,args),/reconciled/,'an uncertain prepared stock claim blocks link creation');
  assert.equal(creates,0,'Stripe is not called until Rental Manager confirms the reservation');

  acquire='confirmed';events.length=0;
  const result=await payments.accept.handler(ctx,args);
  assert.equal(result.url,'https://checkout.stripe.com/cs_test_fixture');
  assert.equal(creates,1);
  assert.deepEqual(events,['rentalSwapState.accept','swapStockOperations.prepareSwapClaim','swapStockOperations.recover:claim','rentalSwapState.markSessionCreationStarted','rentalSwapState.bindSession']);
  assert(!events.some(event=>event.includes('beginExecution')),'a payment link is backed by a prepared reservation, not started execution');

  swap={...swap,_id:'swap-stale'};bookingAvailable=false;events.length=0;
  await assert.rejects(payments.accept.handler(ctx,{...args,id:swap._id}),/booking needs review/,'a rental that changed before reservation cannot receive a payment link');
  assert.equal(creates,1,'a stale or cancelled rental cannot create another payment session');
  console.log('PASS synthetic swap stock gate: unknown stock blocks payment links; prepared stock allows a link; execution is deferred until payment; stale rentals stay blocked.');
})().catch(error=>{console.error(error);process.exitCode=1;});
