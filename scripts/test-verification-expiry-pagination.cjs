const assert = require('node:assert/strict');
const { load, db, put } = require('./lib/rentalTestHarness.cjs');
const { expireRentalVerifications } = load('convex/bookings.ts');

(async () => {
  const now = Date.now();
  const expired = Array.from({ length: 125 }, () => put('bookings', {
    status: 'pending_verification', idVerifyStatus: 'verified', verificationExpiresAt: now - 1,
  }));
  const current = put('bookings', {
    status: 'pending_verification', idVerifyStatus: 'verified', verificationExpiresAt: now + 60000,
  });
  const confirmedRental = put('bookings', { status: 'confirmed', idVerifyStatus: 'verified', verificationExpiresAt: now - 1 });
  const returned = put('bookings', {
    status: 'returned', idVerifyStatus: 'verified', verificationExpiresAt: now - 1,
  });
  const continuations = [];
  const ctx = { db, scheduler: { runAfter: async (_delay, ref, args) => {
    if (ref === 'bookings.expireRentalVerifications') continuations.push(args);
  } } };

  await expireRentalVerifications.handler(ctx, {});
  assert.equal(expired.filter(row => row.idVerifyStatus === 'requires_input').length, 50);
  assert.equal(continuations.length, 1);
  while (continuations.length) await expireRentalVerifications.handler(ctx, continuations.shift());
  assert.equal(expired.filter(row => row.idVerifyStatus === 'requires_input').length, 125);
  assert.equal(current.idVerifyStatus, 'verified');
  assert.equal(confirmedRental.idVerifyStatus, 'verified', 'Account reuse expiry never invalidates an already-confirmed booking');
  assert.equal(returned.idVerifyStatus, 'verified');
  const revisions = expired.map(row => row.rmv2Revision);
  await expireRentalVerifications.handler(ctx, {});
  while (continuations.length) await expireRentalVerifications.handler(ctx, continuations.shift());
  assert.deepEqual(expired.map(row => row.rmv2Revision), revisions);
  console.log('PASS verification expiry pagination: bounded pages, complete coverage and idempotent replay.');
})().catch(error => { console.error(error); process.exitCode = 1; });
