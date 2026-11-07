const assert = require('node:assert/strict');
const { load, setMock } = require('./lib/rentalTestHarness.cjs');

process.env.STRIPE_SECRET_KEY = 'sk_test_fixture';
process.env.MEMBERSHIP_HISTORICAL_INVOICE_CREDIT_V1 = 'enabled';
process.env.STRIPE_WEBHOOK_SECRET = 'fixture';
let fail = true;
const session = { id: 'cs_test_fixture', status: 'complete', payment_status:'paid', payment_intent:'pi_fixture', subscription: 'sub_fixture', metadata: { bookingId: 'bookings:fixture', membershipTier: 'plus' } };
setMock('stripe', { default: class { constructor() {
  this.checkout = { sessions: { retrieve: async () => session } };
  this.subscriptions = { retrieve: async () => { if (fail) throw Error('synthetic provider failure'); return { id:'sub_fixture', customer:'cus_fixture', status:'trialing', created:1, cancel_at_period_end:false, metadata:{ membershipTier:'plus', accountEmail:'test@example.invalid' } }; } };
  this.webhooks = { constructEvent: () => ({ type:'checkout.session.completed', data:{ object:session } }) };
} } });
const checkout = load('convex/checkout.ts');
const scheduled = [], mutations = [];
const ctx = { scheduler: { runAfter: async (...args) => scheduled.push(args) }, runMutation: async (...args) => mutations.push(args), runQuery: async () => ({ _id:'accounts:fixture', stripeCustomerId:'cus_fixture' }) };

(async () => {
  await checkout.fulfillMembershipForBooking(ctx, session);
  assert.equal(scheduled.length, 1);
  assert.equal(scheduled[0][1], 'checkout.retryMembershipCheckout');
  assert.deepEqual(scheduled[0][2], { sessionId: session.id, bookingId: 'bookings:fixture', attempt: 0 });
  await checkout.retryMembershipCheckout.handler(ctx, scheduled[0][2]);
  assert.equal(scheduled[1][2].attempt, 1);
  await checkout.retryMembershipCheckout.handler(ctx, { ...scheduled[0][2], attempt: 3 });
  assert.equal(mutations[0][0], 'membershipInvoiceReviews.recordCheckoutFailure');
  fail = false;
  await checkout.retryMembershipCheckout.handler(ctx, scheduled[1][2]);
  assert.equal(scheduled.length, 2);
  fail = true;
  let confirmed = false, funded = false;
  const webhookCtx = { scheduler:ctx.scheduler, runQuery:async () => null, runAction:async ref => { assert.equal(ref, 'sync.syncHyggloReservations'); return { checkedAt:Date.now() }; }, runMutation:async ref => {
    if (ref === 'bookings.recordPaidCheckoutReceipt') return {};
    if (ref === 'bookings.confirm') { if (funded) throw Error('The paid first-month credit receipt has not settled yet.'); confirmed = true; return {}; }
    throw Error(`Unexpected mutation ${ref}`);
  } };
  assert.equal(await checkout.stripeWebhook.handler(webhookCtx, { body:'fixture', sig:'fixture' }), true);
  assert.equal(confirmed, true, 'unfunded booking reaches confirmation despite subscription outage');
  confirmed = false; funded = true;
  await assert.rejects(() => checkout.stripeWebhook.handler(webhookCtx, { body:'fixture', sig:'fixture' }), /credit receipt/);
  assert.equal(confirmed, false, 'first-month-credit-funded booking still requires its receipt');
  process.env.MEMBERSHIP_HISTORICAL_INVOICE_CREDIT_V1 = 'disabled';
  fail = true;
  await assert.rejects(() => checkout.fulfillMembershipForBooking(ctx, session), /synthetic provider failure/);
  await assert.rejects(() => checkout.fulfillMembershipForBooking(ctx, { ...session, metadata: { membershipTier: 'plus' } }), /synthetic provider failure/);
  console.log('PASS membership provider isolation, bounded retry and failure alert; synthetic Stripe only.');
})().catch(error => { console.error(error); process.exitCode = 1; });
