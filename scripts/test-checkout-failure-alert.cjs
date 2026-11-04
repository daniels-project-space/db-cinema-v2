const assert = require('node:assert/strict');
const { load, db, put, tables } = require('./lib/rentalTestHarness.cjs');
const { flagCheckoutSessionFailure } = load('convex/bookings.ts');
const { adminNotificationCategory } = load('shared/adminNotificationPresentation.ts');
const ctx = { db, scheduler: { runAfter: async () => {} } };

(async () => {
  const account = put('accounts', { email: 'private@example.invalid' });
  const booking = put('bookings', { status: 'pending_payment', accountId: account._id, accountAccessRequired: false });
  await flagCheckoutSessionFailure.handler(ctx, { bookingId: booking._id });
  await flagCheckoutSessionFailure.handler(ctx, { bookingId: booking._id });
  const notifications = tables.get('admin_notifications');
  assert.equal(notifications.length, 1, 'retries do not repeat the same alert');
  assert.equal(notifications[0].bookingId, booking._id);
  assert.equal(notifications[0].accountId, account._id);
  assert.equal(adminNotificationCategory(notifications[0].kind), 'Bookings & payments');
  assert(!JSON.stringify(notifications[0]).includes(account.email), 'push copy excludes recipient details');
  const guest = put('bookings', { status: 'pending_payment', accountId: account._id, accountAccessRequired: true });
  await flagCheckoutSessionFailure.handler(ctx, { bookingId: guest._id });
  assert.equal(notifications.at(-1).accountId, undefined, 'unclaimed guest is not linked to an account');
  const bound = put('bookings', { status: 'pending_payment', stripeCheckoutSessionId: 'cs_fixture' });
  await flagCheckoutSessionFailure.handler(ctx, { bookingId: bound._id });
  const cancelled = put('bookings', { status: 'cancelled' });
  await flagCheckoutSessionFailure.handler(ctx, { bookingId: cancelled._id });
  assert.equal(notifications.length, 2, 'bound and closed rentals do not create stale alerts');
  for (let index = 0; index < 14; index++) {
    const pending = put('bookings', { status: 'pending_payment' });
    await flagCheckoutSessionFailure.handler(ctx, { bookingId: pending._id });
  }
  assert.equal(notifications.filter(item => item.title === 'Checkout could not open').length, 10);
  assert.equal(notifications.filter(item => item.title === 'Multiple checkouts need attention').length, 1, 'outages are grouped after the bounded individual alerts');
  console.log('PASS checkout failure alerts: exact booking, deduplication, guest isolation and bounded outage aggregation.');
})().catch(error => { console.error(error); process.exitCode = 1; });
