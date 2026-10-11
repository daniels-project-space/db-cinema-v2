const assert = require('node:assert/strict');
const { pbkdf2Sync } = require('node:crypto');
const { ConvexError } = require('convex/values');
const { load, db, put, tables } = require('./lib/rentalTestHarness.cjs');
const accounts = load('convex/accounts.ts');
const { accountAuthErrorMessage, ACCOUNT_AUTH_MESSAGES } = load('shared/accountAuth.ts');
const ctx = { db,
  runQuery: async (ref, args) => accounts[ref.split('.')[1]].handler(ctx, args),
  runMutation: async (ref, args) => accounts[ref.split('.')[1]].handler(ctx, args),
};
const salt = '09ab23cd45ef67890123456789abcdef';
const password = 'FixturePassword123';
const account = put('accounts', {
  email: 'person@example.invalid', name: 'Fixture Renter', createdAt: 1,
  salt, hash: pbkdf2Sync(password, Buffer.from(salt, 'hex'), 100000, 32, 'sha256').toString('hex'),
  emailVerifiedAt: 1,
});
async function expectError(args, code) {
  const before = (tables.get('sessions') ?? []).length;
  await assert.rejects(accounts.signIn.handler(ctx, args), error => {
    assert(error instanceof ConvexError, 'Expected errors must survive production Convex error redaction');
    assert.deepEqual(error.data, { code, message: ACCOUNT_AUTH_MESSAGES[code] });
    assert.equal(accountAuthErrorMessage(error, 'Fallback'), ACCOUNT_AUTH_MESSAGES[code]);
    return true;
  });
  assert.equal((tables.get('sessions') ?? []).length, before, 'Failed authentication must never create a session');
}
(async () => {
  await expectError({ email: '', password }, 'INVALID_INPUT');
  await expectError({ email: 'person@example.invalid', password: '' }, 'INVALID_INPUT');
  await expectError({ email: 'bad@email', password }, 'INVALID_INPUT');
  await expectError({ email: 'missing@example.invalid', password }, 'INVALID_CREDENTIALS');
  await expectError({ email: account.email, password: 'WrongPassword123' }, 'INVALID_CREDENTIALS');
  const login = await accounts.signIn.handler(ctx, { email: ' PERSON@EXAMPLE.INVALID ', password });
  assert.equal((await accounts.me.handler(ctx, { token: login.token }))._id, account._id,
    'Normalized email and reset-compatible PBKDF2 must authenticate the original permanent account');
  assert.equal((tables.get('accounts') ?? []).length, 1, 'Signing in never creates a replacement account');
  await db.patch(account._id, { blockedAt: Date.now() });
  await expectError({ email: account.email, password }, 'ACCOUNT_BLOCKED');
  await db.patch(account._id, { blockedAt: undefined, emailVerificationRequired: true, emailVerifiedAt: undefined });
  await expectError({ email: account.email, password }, 'EMAIL_VERIFICATION_REQUIRED');
  await assert.rejects(accounts._session.handler(ctx, { accountId: account._id, token: 'unverified' }),
    error => error.data?.code === 'EMAIL_VERIFICATION_REQUIRED');
  await db.patch(account._id, { emailVerificationRequired: false, emailVerifiedAt: 1, hash: undefined, salt: undefined });
  await expectError({ email: account.email, password }, 'PASSWORD_NOT_SET');
  await assert.rejects(accounts.signUp.handler(ctx, { email: account.email, password }),
    error => error.data?.code === 'ACCOUNT_EXISTS');
  await assert.rejects(accounts.signUp.handler(ctx, { email: 'bad', password: '123' }),
    error => error.data?.code === 'SIGNUP_INVALID_INPUT');
  for (const error of [null, {}, new Error('[CONVEX A(accounts:signIn)] [Request ID: private] Server Error'),
    { data: { code: 'UNKNOWN', message: 'private backend stack trace' } }, { data: { code: 'toString' } }]) {
    assert.equal(accountAuthErrorMessage(error, 'Safe fallback'), 'Safe fallback', 'Unexpected errors must not leak internal details');
  }
  console.log('PASS account sign-in: production-safe errors, normalized email, existing password compatibility and account ownership, no session on failure, verified-only access and safe UI fallback.');
})().catch(error => { console.error(error); process.exitCode = 1; });
