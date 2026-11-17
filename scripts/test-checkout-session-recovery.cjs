const assert=require('node:assert/strict');
const {load}=require('./lib/rentalTestHarness.cjs');
const {checkoutSessionState,expireUnpaidCheckoutSession}=load('convex/lib/checkoutSessionRecovery.ts');
const {checkoutStartDestination}=load('src/lib/checkoutStartResult.ts');

(async()=>{
  const expiredCalls=[],bookingCalls=[];
  const open={id:'cs-open',status:'open',payment_status:'unpaid'};
  assert.equal(checkoutSessionState(open),'open_unpaid');
  const expired=await expireUnpaidCheckoutSession({session:open,
    expireStripe:async id=>{expiredCalls.push(id);return {...open,status:'expired'};},
    retrieveStripe:async()=>{throw Error('expiry should succeed');},
    expireBooking:async id=>{bookingCalls.push(id);return true;},
  });
  assert.deepEqual(expired,{state:'expired_unpaid',session:{...open,status:'expired'},bookingExpired:true});
  assert.deepEqual(expiredCalls,['cs-open']);assert.deepEqual(bookingCalls,['cs-open']);

  const paidRace={id:'cs-race',status:'complete',payment_status:'paid',amount_total:12000,currency:'gbp'};
  const raced=await expireUnpaidCheckoutSession({session:open,
    expireStripe:async()=>paidRace,
    retrieveStripe:async()=>{throw Error('provider read is not needed after expiry succeeds');},
    expireBooking:async()=>{throw Error('an already-paid session must not be expired locally');},
  });
  assert.equal(raced.state,'paid');assert.equal(raced.session,paidRace);assert.equal(raced.bookingExpired,false);
  assert.equal(checkoutSessionState({id:'cs-already-paid',status:'complete',payment_status:'paid'}),'paid');
  assert.equal(checkoutSessionState({id:'cs-zero-paid',status:'complete',payment_status:'no_payment_required'}),'paid');
  assert.equal(checkoutStartDestination({url:'https://checkout.example.test/session'}),'https://checkout.example.test/session');
  assert.equal(checkoutStartDestination({bookingId:'booking-fixture',alreadyPaid:true,sessionId:'cs-paid-race'}),'/checkout/success?session_id=cs-paid-race');
  assert.equal(checkoutStartDestination({bookingId:'booking-fixture',alreadyPaid:true,sessionId:'cs+paid/race'}),'/checkout/success?session_id=cs%2Bpaid%2Frace');

  let expiredBooking=false;
  const terminal=await expireUnpaidCheckoutSession({session:{id:'cs-expired',status:'expired',payment_status:'unpaid'},
    expireStripe:async()=>{throw Error('expired session should not be sent for expiry again');},
    retrieveStripe:async()=>{throw Error('expired session is already authoritative');},
    expireBooking:async()=>{expiredBooking=true;return true;},
  });
  assert.equal(terminal.state,'expired_unpaid');assert.equal(expiredBooking,true);

  let preserved=false;
  const processing=await expireUnpaidCheckoutSession({session:{id:'cs-processing',status:'complete',payment_status:'unpaid'},
    expireStripe:async()=>{throw Error('indeterminate completed session must not be expired');},
    retrieveStripe:async()=>{throw Error('no expiry attempt expected');},
    expireBooking:async()=>{preserved=true;return true;},
  });
  assert.equal(processing.state,'indeterminate');assert.equal(preserved,false);
  console.log('PASS checkout retry recovery: open unpaid expires, expiry race preserves completed payment, terminal unpaid releases only after provider state, processing remains untouched.');
})().catch(error=>{console.error(error);process.exitCode=1;});
