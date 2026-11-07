const assert = require('node:assert/strict');
const h = require('./lib/rentalTestHarness.cjs');

process.env.STRIPE_SECRET_KEY = 'sk_test_confirmation_fixture';
let retrievalFailures = 0;
let wrongSession = false;
class StripeFixture {
  checkout = { sessions: { retrieve: async () => {
    if (retrievalFailures > 0) { retrievalFailures--; throw new Error('temporary Stripe outage'); }
    return { id: 'cs_confirmation_fixture', status: 'complete', payment_status: 'paid', payment_intent: 'pi_confirmation_fixture', metadata: { bookingId: wrongSession ? 'another-booking' : 'bookings-fixture' } };
  } } };
}
h.setMock('stripe', { default: StripeFixture });
const checkout = h.load('convex/checkout.ts');
const scheduled = [];
let failures = 0;
let inventoryRetries = 0;
let confirmations = 0;
let trackedPurchases = 0;
let stockRefreshes = 0;
const booking = { _id: 'bookings-fixture', status: 'pending_verification', verificationProvider: 'didit', idVerifyStatus: 'verified', stripeCheckoutSessionId: 'cs_confirmation_fixture' };
const ctx = {
  scheduler: { runAfter: async (delay, ref, args) => scheduled.push({ delay, ref, args }) },
  runQuery: async (ref) => {
    if (ref === 'bookings.verificationAccess') return booking;
    if (ref === 'bookings.holdContext') return null;
    if (ref === 'savedCardState.context') return null;
    throw new Error(`Unexpected query ${ref}`);
  },
  runAction: async (ref, args) => {
    assert.equal(ref, 'sync.syncHyggloReservations');
    assert.equal(args.force, true, 'paid confirmation must read current Rental Manager stock');
    stockRefreshes++;
    return { checkedAt: Date.now() };
  },
  runMutation: async (ref) => {
    if (ref === 'bookings.recordPaidCheckoutReceipt') return { recorded: true };
    if (ref === 'bookings.confirm') { confirmations++; return { awaitingInventoryReview: inventoryRetries > 0 }; }
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

  retrievalFailures = 1;
  await quietExpectedError(() => checkout.confirmAfterVerification.handler(ctx, { bookingId: booking._id, attempt: 3 }));
  assert.equal(failures, 1, 'exhausted provider retries create a visible admin alert');

  wrongSession = true;
  await checkout.confirmAfterVerification.handler(ctx, { bookingId: booking._id, attempt: 0 });
  assert.equal(failures, 2, 'a paid session bound to another booking is alerted, never confirmed');
  assert.equal(trackedPurchases, 1);
  console.log('PASS paid Didit confirmation recovery: transient retries, bounded stock retries, no false purchase analytics, exhausted-retry alert and strict Stripe booking binding. Synthetic Stripe fixture only.');
})().catch(error => { console.error(error); process.exitCode = 1; });
