const assert = require('node:assert/strict');
const { load, db, put, tables } = require('./lib/rentalTestHarness.cjs');
const archive = load('convex/verificationArchive.ts');
const { accountVerificationReady } = load('convex/lib/accountVerificationReady.ts');
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
  const closed = { accountId: owner._id, guestEmail: owner.email, status: 'returned', returnedAt: Date.now() - 91 * 86400000 };
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
  const pending = [], captures = [], linkers = [], pageSizes = [];
  const measuredDb = { ...db, query(table) {
    const query = db.query(table), paginate = query.paginate;
    query.paginate = async options => { const result = await paginate(options); pageSizes.push(result.page.length); assert.equal(options.numItems, 25); return result; };
    return query;
  } };
  const ctx = { db: measuredDb, scheduler: { runAfter: async (delay, ref, args) => {
    assert.equal(delay, 0);
    if (ref === 'verificationArchive.backfillNext') pending.push(args);
    else if (ref === 'verificationArchive.linkVerifiedAccount') linkers.push(args);
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

  const legacyBooleanOnly = put('accounts', {
    email: 'legacy-boolean@example.invalid', name: 'Legacy Renter', emailVerifiedAt: Date.now(), idVerified: true,
  });
  assert.equal(await accountVerificationReady(ctx, legacyBooleanOnly), null, 'a legacy account-level ID flag alone never creates a verification badge');
  await archive.backfillAccount.handler(ctx, { token: 'backfill-test', accountId: legacyBooleanOnly._id });
  while (pending.length) await archive.backfillNext.handler(ctx, pending.shift());
  for (const args of linkers.splice(0)) await archive.linkVerifiedAccount.handler(ctx, args);
  assert.equal(legacyBooleanOnly.rentalVerification, undefined, 'the admin backfill does not turn a boolean-only legacy record into a Didit pass');
  assert.equal(await accountVerificationReady(ctx, legacyBooleanOnly), null);

  const approvedAt = Date.now() - 12 * 86400000;
  const legacyApprovedAccount = put('accounts', {
    email: 'legacy-approved@example.invalid', name: 'Verified Legacy Renter', address: '1 Example Road SW1A 1AA',
    emailVerifiedAt: Date.now(), idVerified: true,
  });
  const legacyApprovedBooking = put('bookings', {
    accountId: legacyApprovedAccount._id, guestEmail: legacyApprovedAccount.email, status: 'returned',
    returnedAt: Date.now() - 2 * 86400000, verificationProvider: 'didit', idVerificationSource: 'didit',
    idVerifyStatus: 'verified', idVerifiedAt: approvedAt, verificationExpiresAt: approvedAt + 90 * 86400000,
    diditSessionId: 'legacy-approved-session', agreementName: legacyApprovedAccount.name,
    billingAddress: legacyApprovedAccount.address,
    verificationChecks: { identity: 'approved', selfie: 'approved', address: 'approved' },
  });
  const legacyApprovedArchive = put('verification_archives', {
    bookingId: legacyApprovedBooking._id, accountId: legacyApprovedAccount._id,
    sessionId: legacyApprovedBooking.diditSessionId, status: 'complete', generation: 1,
  });
  require('./lib/verificationFiles.cjs').seedVerificationFiles(put, legacyApprovedArchive);
  assert.equal(await accountVerificationReady(ctx, legacyApprovedAccount), null, 'an unlinked legacy account is not badged before the explicit archive-backed migration');
  await archive.backfillAccount.handler(ctx, { token: 'backfill-test', accountId: legacyApprovedAccount._id });
  while (pending.length) await archive.backfillNext.handler(ctx, pending.shift());
  for (const args of linkers.splice(0)) await archive.linkVerifiedAccount.handler(ctx, args);
  assert.equal(legacyApprovedAccount.rentalVerification.verifiedAt, approvedAt, 'a proven legacy rental backfills the original Didit approval timestamp');
  assert.equal(legacyApprovedAccount.rentalVerification.expiresAt, approvedAt + 90 * 86400000, 'migration does not restart or extend the original 90-day pass');
  assert.ok(await accountVerificationReady(ctx, legacyApprovedAccount), 'the migrated badge passes the same archive and ownership readiness checks');

  await assert.rejects(() => archive.backfillAccount.handler(ctx, { token: 'backfill-test', accountId: 'missing-account' }), /Account not found/);
  console.log('PASS archive backfill: bounded continuations, legacy ownership and retention fences, boolean-only badge denial, original-timestamp recovery, open claims, unknown closure, deleted-byte protection and retry dedupe.');
})().catch(error => { console.error(error); process.exitCode = 1; });
