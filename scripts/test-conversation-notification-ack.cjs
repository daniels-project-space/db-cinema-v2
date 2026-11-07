const assert = require('node:assert/strict');
const { load, db, put } = require('./lib/rentalTestHarness.cjs');
const { acknowledgeOwnerNotifications } = load('convex/lib/adminPush.ts');
const { acknowledgeConversationBatch } = load('convex/adminNotifications.ts');

const scheduled = [];
const ctx = { db, scheduler: { runAfter: async (...args) => scheduled.push(args) } };
const account = put('accounts', { email: 'notification-test@example.invalid' });
const otherAccount = put('accounts', { email: 'other@example.invalid' });
const booking = put('bookings', {});
const otherBooking = put('bookings', {});
const add = (kind, createdAt, accountId = account._id, bookingId = booking._id) => put('admin_notifications', {
  eventKey: `test-${kind}-${Math.random()}`, kind, accountId, bookingId, title: 'Test', body: 'Test', createdAt, read: false,
});

(async () => {
  const messages = Array.from({ length: 125 }, (_, index) => add('renter_message', index));
  const human = add('human_request', 25);
  const resumed = add('gaffer_resumed', 26);
  const verification = add('verification_failure', 27);
  const identity = add('identity_match', 28);
  const payment = add('booking_paid', 29);
  const future = add('renter_message', 200);
  const other = add('renter_message', 20, otherAccount._id);
  const otherRental = add('renter_message', 20, account._id, otherBooking._id);
  await acknowledgeOwnerNotifications(ctx, account._id, booking._id, 150);
  assert.equal(messages.filter(row => row.read).length, 100);
  assert.equal(human.read, true);
  assert.equal(resumed.read, true);
  assert.equal(scheduled.length, 1);
  assert.equal(scheduled[0][1], 'adminNotifications.acknowledgeConversationBatch');
  await acknowledgeConversationBatch.handler(ctx, scheduled[0][2]);
  assert(messages.every(row => row.read));
  for (const row of [verification, identity, payment, future, other, otherRental]) assert.equal(row.read, false);
  assert.equal(scheduled.length, 1);
  await acknowledgeOwnerNotifications(ctx, account._id, booking._id, 150);
  assert.equal(scheduled.length, 1);
  console.log('PASS conversation read preserves verification, identity, payment, future and unrelated alerts; bounded continuation clears older messages.');
})().catch(error => { console.error(error); process.exitCode = 1; });
