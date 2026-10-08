const assert = require('node:assert/strict');
const { load, db, put, tables } = require('./lib/rentalTestHarness.cjs');
const archive = load('convex/verificationArchive.ts');
process.env.ADMIN_TOKEN = 'backfill-test';

(async () => {
  const owner = put('accounts', { email: 'current@example.invalid' });
  const other = put('accounts', { email: 'previous@example.invalid' });
  const wanted = [];
  for (let i = 0; i < 137; i++) wanted.push(put('bookings', {
    accountId: owner._id, guestEmail: other.email, status: 'confirmed', diditSessionId: `owned-${i}`,
  }));
  for (let i = 0; i < 55; i++) wanted.push(put('bookings', {
    guestEmail: owner.email, status: 'active', diditSessionId: `legacy-${i}`,
  }));
  const closed = { accountId: owner._id, guestEmail: owner.email, status: 'returned', returnedAt: Date.now() - 31 * 86400000 };
  const expired = put('bookings', { ...closed, diditSessionId: 'expired' });
  const claimed = put('bookings', { ...closed, diditSessionId: 'open-claim' });
  put('rental_damage_cases', { bookingId: claimed._id, status: 'open' });
  wanted.push(claimed);
  const reused = put('bookings', { ...closed, diditSessionId: 'active-reuse' });
  put('bookings', { accountId: owner._id, status: 'active', verificationReusedFrom: reused._id });
  wanted.push(reused);
  const unknownClosure = put('bookings', { ...closed, returnedAt: undefined, diditSessionId: 'unknown-closure' });
  wanted.push(unknownClosure);
  const deleted = put('bookings', { ...closed, diditSessionId: 'already-deleted' });
  const deletedArchive = put('verification_archives', { bookingId: deleted._id, accountId: owner._id, sessionId: deleted.diditSessionId, status: 'deleted' });
  put('rental_damage_cases', { bookingId: deleted._id, status: 'open' });
  const foreign = put('bookings', { accountId: other._id, guestEmail: owner.email, status: 'active', diditSessionId: 'foreign-owner' });
  const unrelated = put('bookings', { guestEmail: 'unrelated@example.invalid', status: 'active', diditSessionId: 'unrelated' });
  const pending = [], captures = [], pageSizes = [];
  const measuredDb = { ...db, query(table) {
    const query = db.query(table), paginate = query.paginate;
    query.paginate = async options => { const result = await paginate(options); pageSizes.push(result.page.length); assert.equal(options.numItems, 25); return result; };
    return query;
  } };
  const ctx = { db: measuredDb, scheduler: { runAfter: async (delay, ref, args) => {
    assert.equal(delay, 0);
    if (ref === 'verificationArchive.backfillNext') pending.push(args);
    else { assert.equal(ref, 'verificationArchiveWorker.capture'); captures.push(args); }
  } } };
  await assert.rejects(() => archive.backfillAccount.handler(ctx, { token: 'invalid', accountId: owner._id }), /unauthorized/);
  assert.equal(pending.length + captures.length, 0, 'Denied access cannot schedule copies');
  async function scan() {
    await archive.backfillAccount.handler(ctx, { token: 'backfill-test', accountId: owner._id });
    let batches = 0;
    while (pending.length) { assert.ok(++batches < 30, 'Continuation terminates'); await archive.backfillNext.handler(ctx, pending.shift()); }
  }
  await scan();
  const created = tables.get('verification_archives').filter(a => a.status !== 'deleted');
  assert.deepEqual(new Set(created.map(a => a.bookingId)), new Set(wanted.map(b => b._id)), 'All permanent and legacy rentals are covered, including the oldest beyond 100');
  assert.equal(created.length, wanted.length);
  assert.ok(created.every(a => a.accountId === owner._id), 'Copies are linked to the actual owner despite changed email');
  assert.ok(pageSizes.length >= 9 && Math.max(...pageSizes) <= 25, 'Each transaction reads a bounded rental page');
  for (const excluded of [expired, deleted, foreign, unrelated]) assert.ok(!created.some(a => a.bookingId === excluded._id));
  assert.equal(deletedArchive.status, 'deleted', 'Claims cannot resurrect previously deleted files');
  const firstCaptureCount = captures.length;
  await scan();
  assert.equal(tables.get('verification_archives').length, created.length + 1, 'Retrying the complete scan deduplicates archives');
  assert.equal(captures.length, firstCaptureCount, 'Existing pending work is not queued twice');
  await assert.rejects(() => archive.backfillAccount.handler(ctx, { token: 'backfill-test', accountId: 'missing-account' }), /Account not found/);
  console.log('PASS archive backfill: 195 eligible rentals across bounded continuations, changed-email ownership, legacy isolation, open claims, active reuse, unknown closure, expiry, deleted-byte protection and retry dedupe.');
})().catch(error => { console.error(error); process.exitCode = 1; });
