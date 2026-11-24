const assert = require('node:assert/strict');
const h = require('./lib/rentalTestHarness.cjs');

process.env.STRIPE_SECRET_KEY = 'sk_test_confirmation_fixture';
let retrievalFailures = 0;
let wrongSession = false;
let webhookEvent;
class StripeFixture {
  checkout = { sessions: { retrieve: async () => {
    if (retrievalFailures > 0) { retrievalFailures--; throw new Error('temporary Stripe outage'); }
    return { id: 'cs_confirmation_fixture', status: 'complete', payment_status: 'paid', payment_intent: 'pi_confirmation_fixture',amount_total:10000,currency:'gbp', metadata: { bookingId: wrongSession ? 'another-booking' : 'bookings-fixture' } };
  } } };
  paymentIntents={retrieve:async id=>({id,status:'succeeded',amount_received:10000,currency:'gbp'})};
  webhooks={constructEvent:()=>webhookEvent};
}
h.setMock('stripe', { default: StripeFixture });
process.env.STRIPE_WEBHOOK_SECRET='whsec_confirmation_fixture';
const checkout = h.load('convex/checkout.ts');
const scheduled = [];
let failures = 0;
let inventoryRetries = 0;
let confirmations = 0;
let trackedPurchases = 0;
let stockRefreshes = 0;
let managerPushSucceeds = true;
let stockRefreshFails = false;
const deliveryOrder = [];
const booking = { _id: 'bookings-fixture', status: 'pending_verification', verificationProvider: 'didit', idVerifyStatus: 'verified', stripeCheckoutSessionId: 'cs_confirmation_fixture',checkoutPaidAt:Date.now(),total:100,currency:'GBP' };
const ctx = {
  scheduler: { runAfter: async (delay, ref, args) => scheduled.push({ delay, ref, args }) },
  runAction: async (ref, args) => {
    if(ref === 'rmv2_webhook.push') { deliveryOrder.push('manager'); return { ok: managerPushSucceeds }; }
    assert.equal(ref, 'sync.syncHyggloReservations');
    assert.equal(args.force, true, 'paid confirmation must read current Rental Manager stock');
    deliveryOrder.push('live-stock');stockRefreshes++;
    if(stockRefreshFails)throw new Error('temporary live stock refresh outage');
    return { checkedAt: Date.now() };
  },
  runQuery: async (ref, args) => {
    if(ref === 'rmv2Delivery.internalStatus') return {status:'pending',revision:2,deliveredRevision:1};
    if(ref === 'bookings.pendingCheckoutSessions') return [{bookingId:booking._id,sessionId:booking.stripeCheckoutSessionId,createdAt:Date.now()}];
    if(ref === 'bookings.verificationAccess') return booking;
    if(ref === 'bookings.holdContext' || ref === 'savedCardState.context') return null;
    throw new Error(`Unexpected query ${ref}`);
  },
  runMutation: async (ref) => {
    if (ref === 'bookings.recordPaidCheckoutReceipt') return { recorded: true, awaitingVerification:true, checkoutPaidAt:Date.now(), requiresSavedCard:false };
    if (ref === 'bookings.confirm') { confirmations++; return booking.idVerifyStatus === 'verified' ? { awaitingInventoryReview: inventoryRetries > 0 } : { awaitingVerification:true }; }
    if (ref === 'bookings.markVerificationConfirmationFailure') { failures++; return true; }
    if (ref === 'analytics.track') { trackedPurchases++; return true; }
    throw new Error(`Unexpected mutation ${ref}`);
  },
};
async function quietExpectedError(run) {
  const original = console.error;
  console.error = () => {};
  try { return await run(); }
  finally { console.error = original; }
}

(async () => {
  retrievalFailures = 1;
  await quietExpectedError(() => checkout.confirmAfterVerification.handler(ctx, { bookingId: booking._id, attempt: 0 }));
  assert.equal(scheduled.at(-1).delay, 15 * 60000);
  assert.equal(scheduled.at(-1).args.attempt, 1);
  assert.equal(failures, 0, 'transient failure retries before notifying the admin');

  inventoryRetries = 1;
  await checkout.confirmAfterVerification.handler(ctx, { bookingId: booking._id, attempt: 1 });
  assert.equal(scheduled.at(-1).args.attempt, 2, 'stock review retries are bounded and numbered');

  inventoryRetries = 0;
  await checkout.confirmAfterVerification.handler(ctx, { bookingId: booking._id, attempt: 2 });
  assert.equal(confirmations, 2);
  assert.equal(stockRefreshes, 2, 'each paid confirmation attempt refreshes live stock first');
  assert.equal(trackedPurchases, 1, 'only a fully confirmed rental records a purchase');
  assert.deepEqual(deliveryOrder,['manager','live-stock','manager','live-stock'],'Rental Manager records the paid pending Didit window before the live stock check and booking confirmation');

  const beforeGate={confirmations,stockRefreshes};managerPushSucceeds=false;
  booking.checkoutPaidAt=Date.now();
  const pendingPage=await checkout.finalize.handler(ctx,{sessionId:'cs_confirmation_fixture'});
  assert.equal(pendingPage.verificationPending,true,'a paid rental reaches verification while manager sync is delayed');
  assert.equal(confirmations,beforeGate.confirmations,'showing verification does not confirm the rental');
  booking.checkoutPaidAt=undefined;
  await assert.rejects(checkout.finalize.handler(ctx,{sessionId:'cs_confirmation_fixture'}),/Rental Manager has not confirmed/,'an unattested payment cannot bypass the stock gate');
  booking.checkoutPaidAt=Date.now();
  await quietExpectedError(() => checkout.confirmAfterVerification.handler(ctx,{bookingId:booking._id,attempt:0}));
  assert.equal(confirmations,beforeGate.confirmations);assert.equal(stockRefreshes,beforeGate.stockRefreshes,'Booking confirmation waits for Manager to record the paid pending reservation');
  assert.equal(scheduled.at(-1).args.attempt,1,'Failed Manager delivery gets a bounded retry; payment remains recorded');
  managerPushSucceeds=true;await checkout.confirmAfterVerification.handler(ctx,{bookingId:booking._id,attempt:1});
  assert.equal(confirmations,beforeGate.confirmations+1);assert.equal(trackedPurchases,2);

  managerPushSucceeds=false;
  const confirmationsBeforeSuccessPage=confirmations,stockBeforeSuccessPage=stockRefreshes;
  const paidPending=await checkout.finalize.handler(ctx,{sessionId:'cs_confirmation_fixture'});
  assert.deepEqual(paidPending,{bookingId:booking._id,paid:true,verificationPending:true},'a paid booking with an unacknowledged manager sync returns its safe pending-verification destination');
  assert.equal(confirmations,confirmationsBeforeSuccessPage,'the renter-facing fallback never confirms a booking before Rental Manager acknowledges stock');
  assert.equal(stockRefreshes,stockBeforeSuccessPage,'the renter-facing fallback never skips past the manager acknowledgement to a stock-confirmation attempt');
  managerPushSucceeds=true;

  stockRefreshFails=true;
  const confirmationsBeforeStockFailure=confirmations;
  const paidStockPending=await checkout.finalize.handler(ctx,{sessionId:'cs_confirmation_fixture'});
  assert.deepEqual(paidStockPending,{bookingId:booking._id,paid:true,verificationPending:true},'a paid booking with a failed live stock refresh still routes to its pending rental instead of a generic payment error');
  assert.equal(confirmations,confirmationsBeforeStockFailure,'live stock refresh failure never confirms the paid rental');
  stockRefreshFails=false;

  // A legacy declined case may have had its paid hold cancelled. Recovery must
  // refresh stock, restore the exact ledger, get Manager's receipt, then run
  // the ordinary final stock check before any confirmation.
  const recoveryOrder=[];let recoveryFails=false;
  const recoveryCtx={...ctx,runAction:async(ref,args)=>{
    if(ref==='sync.syncHyggloReservations'){recoveryOrder.push('stock');return {checkedAt:Date.now()};}
    if(ref==='rmv2_webhook.push'){recoveryOrder.push('manager');return {ok:true};}
    throw Error(`Unexpected action ${ref}`);
  },runMutation:async(ref,args)=>{
    if(ref==='bookings.recordPaidCheckoutReceipt')return {recorded:true,awaitingVerification:true,requiresSavedCard:false,needsVerificationHoldRecovery:true};
    if(ref==='bookings.restoreReleasedVerificationHold'){recoveryOrder.push('restore');if(recoveryFails)throw Error('No available stock');return {restored:true};}
    if(ref==='bookings.confirm'){recoveryOrder.push('confirm');return {};}
    if(ref==='analytics.track')return true;
    if(ref==='bookings.markVerificationConfirmationFailure')return true;
    throw Error(`Unexpected mutation ${ref}`);
  }};
  await checkout.confirmAfterVerification.handler(recoveryCtx,{bookingId:booking._id});
  assert.deepEqual(recoveryOrder,['stock','restore','manager','stock','confirm']);
  recoveryOrder.length=0;recoveryFails=true;
  await quietExpectedError(()=>checkout.confirmAfterVerification.handler(recoveryCtx,{bookingId:booking._id}));
  assert.deepEqual(recoveryOrder,['stock','restore'],'an unavailable allocation cannot reach delivery or confirmation');

  retrievalFailures = 1;
  await quietExpectedError(() => checkout.confirmAfterVerification.handler(ctx, { bookingId: booking._id, attempt: 3 }));
  assert.equal(failures, 1, 'exhausted provider retries create a visible admin alert');

  wrongSession = true;
  await checkout.confirmAfterVerification.handler(ctx, { bookingId: booking._id, attempt: 0 });
  assert.equal(failures, 2, 'a paid session bound to another booking is alerted, never confirmed');
  assert.equal(trackedPurchases, 2);

  wrongSession = false;
  booking.idVerifyStatus = 'processing';
  booking.status = 'pending_verification';
  booking.paidConfirmedAt = undefined;
  booking.checkoutPaidAt = Date.now();
  webhookEvent={id:'evt_pending_paid_fixture',type:'checkout.session.completed',data:{object:{id:'cs_confirmation_fixture',status:'complete',payment_status:'paid',payment_intent:'pi_confirmation_fixture',amount_total:10000,currency:'gbp',metadata:{bookingId:booking._id}}}};
  const beforePaidPending={confirmations,trackedPurchases,stockRefreshes};
  await checkout.stripeWebhook.handler(ctx,{body:'fixture-event',sig:'fixture-signature'});
  assert.equal(confirmations,beforePaidPending.confirmations+1,'Stripe webhook shares the paid-pending confirmation boundary');
  assert.equal(booking.status,'pending_verification');assert.equal(booking.paidConfirmedAt,undefined);
  assert.equal(trackedPurchases,beforePaidPending.trackedPurchases,'A paid webhook cannot record a confirmed purchase before Didit approval');

  const reconcileCtx={...ctx,runQuery:async(ref,args)=>ref==='bookings.pendingCheckoutSessions'?[{bookingId:booking._id,sessionId:booking.stripeCheckoutSessionId,createdAt:Date.now()}]:ctx.runQuery(ref,args)};
  const reconciled=await checkout.reconcilePendingPayments.handler(reconcileCtx,{});
  assert.equal(reconciled.confirmed,0,'Payment reconciliation leaves a Didit-pending rental unconfirmed');
  assert.equal(booking.status,'pending_verification');assert.equal(booking.paidConfirmedAt,undefined);
  assert.equal(trackedPurchases,beforePaidPending.trackedPurchases,'Reconciliation cannot record purchase analytics before approval');
  assert.equal(stockRefreshes,beforePaidPending.stockRefreshes+2,'Webhook and reconciliation both make the paid-pending reservation visible, then check stock');
  console.log('PASS paid Didit confirmation recovery: Manager reservation acknowledgement gates live stock confirmation; transient retries, bounded stock retries, no false purchase analytics, exhausted-retry alert and strict Stripe booking binding. Synthetic Stripe fixture only.');
})().catch(error => { console.error(error); process.exitCode = 1; });
