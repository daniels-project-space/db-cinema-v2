const assert = require('node:assert/strict');
const h = require('./lib/rentalTestHarness.cjs');

Object.assign(process.env, { STRIPE_SECRET_KEY:'sk_test_fixture', STRIPE_WEBHOOK_SECRET:'fixture', MEMBERSHIP_HISTORICAL_INVOICE_CREDIT_V1:'enabled' });
let currentSession;
class FixtureStripe {
  constructor() {
    this.webhooks = { constructEvent: () => ({ type:'checkout.session.completed', data:{ object:currentSession } }) };
    this.subscriptions = { retrieve: async () => { throw Error('synthetic subscription outage'); } };
    this.paymentIntents = { retrieve: async id => ({id,status:'succeeded',amount_received:currentSession.amount_total,currency:currentSession.currency}) };
  }
}
h.setMock('stripe', { default:FixtureStripe });
const checkout = h.load('convex/checkout.ts');
const bookings = h.load('convex/bookings.ts');
const checkedAt = Date.now();
h.put('rmv2_sync_state', { key:'shared-stock-v1', status:'ok', cursor:JSON.stringify({checkedAt}) });
const inventory = h.put('inventory_units', { name:'Fixture camera', sku:'fixture-camera', quantityOwned:1, active:true });
const listing = h.put('listings', { title:'Fixture camera', active:true, stockMappingStatus:'complete', components:[{inventoryUnitId:inventory._id, qty:1}] });
const account = h.put('accounts', { email:'member@example.invalid', name:'Fixture Member', createdAt:checkedAt });
const scheduled = [];
const ctx = { db:h.db, scheduler:{runAfter:async (...args)=>scheduled.push(args)},
  runAction:async ref => { assert.equal(ref,'sync.syncHyggloReservations'); return {checkedAt}; },
  runQuery:async ref => { if (ref === 'savedCardState.context' || ref === 'bookings.holdContext') return null; throw Error(`Unexpected query ${ref}`); },
  runMutation:async (ref,args) => {
    if (ref === 'bookings.recordPaidCheckoutReceipt') return bookings.recordPaidCheckoutReceipt.handler(ctx,args);
    if (ref === 'bookings.confirm') return bookings.confirm.handler(ctx,args);
    throw Error(`Unexpected mutation ${ref}`);
  },
};
function fixture(day, credit) {
  const booking = h.put('bookings', { status:'pending_payment', guestEmail:account.email, accountId:account._id, fulfilment:'pickup',
    stripeCheckoutSessionId:`cs_test_${day}`, subtotal:100, total:100-credit, depositAmount:0, membershipCreditApplied:credit,currency:'GBP',
    lineItems:[{listingId:listing._id,title:listing.title,start:Date.UTC(2030,0,day),end:Date.UTC(2030,0,day),qty:1,total:100,deposit:0}] });
  currentSession = { id:booking.stripeCheckoutSessionId, status:'complete', payment_status:'paid', payment_intent:`pi_${day}`, amount_total:Math.round((100-credit)*100),currency:'gbp',subscription:'sub_fixture', metadata:{bookingId:booking._id,membershipTier:'plus'} };
  return booking;
}
(async () => {
  const ordinary = fixture(2,0);
  assert.equal(await checkout.stripeWebhook.handler(ctx,{body:'fixture',sig:'fixture'}),true);
  assert.equal(ordinary.status,'confirmed');
  assert(scheduled.some(([,ref,args])=>ref==='checkout.retryMembershipCheckout' && args.bookingId===ordinary._id));
  const funded = fixture(5,20);
  await assert.rejects(()=>checkout.stripeWebhook.handler(ctx,{body:'fixture',sig:'fixture'}),/first-month credit receipt has not settled/);
  assert.equal(funded.status,'pending_payment');
  assert(scheduled.some(([,ref,args])=>ref==='checkout.retryMembershipCheckout' && args.bookingId===funded._id));
  const grant = h.put('membership_credit_grants',{accountId:account._id,invoiceId:'in_fixture',subscriptionId:'sub_fixture',initialCreditAppliedPence:2000});
  funded.membershipCreditGrantId=grant._id;
  assert.equal(await checkout.stripeWebhook.handler(ctx,{body:'fixture',sig:'fixture'}),true);
  assert.equal(funded.status,'confirmed');
  console.log('PASS actual booking confirmation with subscription outage, unfunded and receipt-gated first-month credit; synthetic services.');
})().catch(error=>{console.error(error);process.exitCode=1});
