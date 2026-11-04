const assert = require('node:assert/strict');
const { load, db, put } = require('./lib/rentalTestHarness.cjs');
const collective = load('convex/collective.ts');
const ctx = { db, scheduler: { runAfter: async () => {} }, storage: { generateUploadUrl: async () => { throw new Error('unexpected upload'); } } };
const account = put('accounts', { email: 'member@example.invalid' });
const other = put('accounts', { email: 'other@example.invalid' });
const blocked = put('accounts', { email: 'blocked@example.invalid', blockedAt: Date.now() });
const unverified = put('accounts', { email: 'unverified@example.invalid', emailVerificationRequired: true });
const app = put('collective_applications', { email: account.email, status: 'approved', fullName: 'Synthetic Member', kind: 'professional' });
for (const [token, owner, expiresAt] of [
  ['valid', account, Date.now() + 60000], ['expired', account, Date.now() - 1],
  ['blocked', blocked, Date.now() + 60000], ['unverified', unverified, Date.now() + 60000],
  ['other', other, Date.now() + 60000], ['legacy', account, undefined],
]) put('sessions', { token, accountId: owner._id, expiresAt });
const bank = token => ({ token, accountName: 'Synthetic', sortCode: '112233', accountNumber: '12345678' });
(async () => {
  assert.equal((await collective.saveBankDetails.handler(ctx, bank('valid'))).ok, true);
  assert.equal((await collective.myMembership.handler(ctx, { token: 'valid' })).bankLast4, '5678');
  assert.equal((await collective.myMembership.handler(ctx, { token: 'legacy' })).bankLast4, '5678');
  for (const token of ['expired', 'blocked', 'unverified', 'missing']) {
    assert.equal(await collective.myMembership.handler(ctx, { token }), null);
    await assert.rejects(collective.saveBankDetails.handler(ctx, bank(token)), /sign in/i);
    await assert.rejects(collective.idUploadUrl.handler(ctx, { token }), /sign in/i);
    await assert.rejects(collective.attachId.handler(ctx, { token, storageId: '_storage-foreign' }), /sign in/i);
  }
  assert.equal(await collective.myMembership.handler(ctx, { token: 'other' }), null);
  await assert.rejects(collective.saveBankDetails.handler(ctx, bank('other')), /No approved membership/);
  await assert.rejects(collective.idUploadUrl.handler(ctx, { token: 'valid' }), /temporarily unavailable/i);
  await assert.rejects(collective.attachId.handler(ctx, { token: 'valid', storageId: '_storage-foreign' }), /temporarily unavailable/i);
  assert.equal(app.bankAccountNumber, '12345678');
  assert.equal(app.idStorageId, undefined);
  const application = { kind: 'professional', fullName: 'Synthetic Applicant', email: 'applicant@example.invalid', phone: '0000000000', termsAgreed: true };
  await assert.rejects(collective.applicantUploadUrl.handler(ctx, {}), /temporarily unavailable/i);
  await assert.rejects(collective.apply.handler(ctx, { ...application, headshotStorageId: '_storage-foreign' }), /without a photo/i);
  assert.equal((await collective.apply.handler(ctx, application)).ok, true);
  assert.equal((await db.query('collective_applications').collect()).filter(row => row.email === application.email).length, 1);
  console.log('PASS collective session guard: valid and legacy sessions, expired, blocked, unverified, missing and foreign accounts; unsafe legacy uploads disabled.');
})().catch(error => { console.error(error); process.exitCode = 1; });
