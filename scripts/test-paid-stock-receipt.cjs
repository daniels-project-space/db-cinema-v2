const assert = require('node:assert/strict');
const { load, db, put, setMock } = require('./lib/rentalTestHarness.cjs');

let session;
let stockChecks = 0;
class Stripe {
  constructor() { this.checkout = { sessions: { retrieve: async () => session } }; }
}
setMock('stripe', { default: Stripe });
process.env.STRIPE_SECRET_KEY = 'sk_test_fixture';
const bookings = load('convex/bookings.ts');
const checkout = load('convex/checkout.ts');
const booking = put('bookings', { status: 'pending_payment', stripeCheckoutSessionId: 'cs_fixture', lineItems: [], guestEmail: 'test@example.invalid' });
session = { id: 'cs_fixture', status: 'complete', payment_status: 'paid', payment_intent: 'pi_fixture', metadata: { bookingId: booking._id } };
const ctx = {
  db,
  scheduler: { runAfter: async () => {} },
  runMutation: async (ref, args) => bookings[ref.split('.')[1]].handler(ctx, args),
  runAction: async () => { stockChecks++; throw Error('Stock provider unavailable'); },
};

(async () => {
  await assert.rejects(checkout.finalize.handler(ctx, { sessionId: session.id }), /availability could not be refreshed/);
  assert.equal(booking.stripePaymentIntentId, 'pi_fixture');
  assert.equal(booking.status, 'pending_payment');
  assert.equal(await bookings.expireUnpaidPending.handler(ctx, { bookingId: booking._id, sessionId: session.id }), false);
  await assert.rejects(checkout.finalize.handler(ctx, { sessionId: session.id }), /availability could not be refreshed/);
  assert.equal(booking.stripePaymentIntentId, 'pi_fixture');
  const previousChecks = stockChecks;
  session = { ...session, payment_intent: 'pi_different' };
  await assert.rejects(checkout.finalize.handler(ctx, { sessionId: session.id }), /differs from the recorded receipt/);
  assert.equal(booking.stripePaymentIntentId, 'pi_fixture');
  assert.equal(stockChecks, previousChecks);
  session = { ...session, id: 'cs_wrong', payment_intent: 'pi_fixture' };
  await assert.rejects(checkout.finalize.handler(ctx, { sessionId: session.id }), /does not match the booking/);
  session = { ...session, id: 'cs_fixture', payment_status: 'unpaid', status: 'open' };
  assert.equal((await checkout.finalize.handler(ctx, { sessionId: session.id })).paid, false);
  assert.equal(stockChecks, previousChecks);
  console.log('PASS paid receipt survives stock-provider failure; retries, mismatches and unpaid sessions cannot replace it.');
})().catch(error => { console.error(error); process.exitCode = 1; });
