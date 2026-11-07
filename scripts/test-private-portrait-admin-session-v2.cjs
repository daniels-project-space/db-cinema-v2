const assert = require('node:assert/strict');
const { webcrypto, createHash } = require('node:crypto');
const harness = require('./lib/rentalTestHarness.cjs');
global.crypto ??= webcrypto;
const access = harness.load('convex/adminAccountSessionV2.ts');
harness.setMock('./adminAccountSessionV2', { ...access, adminSessionMigrationReady: () => true });
const portrait = harness.load('convex/privateVerificationPortrait.ts');
const sessions = harness.load('convex/adminSessionsV2.ts');
const hash = value => createHash('sha256').update(value).digest('hex');
const identity = 'https://identity.example|portrait-fixture', readToken = 'a'.repeat(64), writeToken = 'b'.repeat(64);
const account = harness.put('accounts', { email: 'portrait-test@example.invalid' });
let reads = 0;
const db = { ...harness.db, get: async id => { reads++; return harness.db.get(id); } };
const ctx = { db, auth: { getUserIdentity: async () => ({ tokenIdentifier: identity }) } };
process.env.ADMIN_TOKEN = 'legacy-portrait-admin';
process.env.PRIVATE_VERIFICATION_PHOTO_ENABLED = 'true';
process.env.ADMIN_SESSION_VERIFICATION_V2 = 'enabled';
process.env.ADMIN_SESSION_SCOPES_V2 = JSON.stringify({ [identity]: ['verification:read', 'verification:write'] });

(async () => {
  for (const [token, scopes] of [[readToken, ['verification:read']], [writeToken, ['verification:write']]])
    await sessions.createSession.handler(ctx, { tokenDigest: hash(token), principalId: `admin:${hash(identity)}`, scopes, expiresAt: Date.now() + 60000 });
  assert.equal(access.adminSessionMigrationReady(), false, 'The real readiness gate is closed');
  assert.equal(await portrait.availability.handler(ctx, { token: readToken }), true);
  for (const token of [writeToken, process.env.ADMIN_TOKEN, 'wrong']) {
    reads = 0;
    assert.equal(await portrait.availability.handler(ctx, { token }), false);
    assert.equal(await portrait.selected.handler(ctx, { token, accountId: account._id, refresh: 1 }), null);
    assert.equal(reads, 0, 'Unauthorized portrait selection must not read the account');
  }
  const wrongIdentity = { ...ctx, auth: { getUserIdentity: async () => ({ tokenIdentifier: 'other' }) } };
  assert.equal(await portrait.availability.handler(wrongIdentity, { token: readToken }), false);
  process.env.ADMIN_SESSION_SCOPES_V2 = JSON.stringify({ [identity]: ['verification:write'] });
  assert.equal(await portrait.availability.handler(ctx, { token: readToken }), false);
  process.env.ADMIN_SESSION_SCOPES_V2 = JSON.stringify({ [identity]: ['verification:read'] });
  reads = 0;
  assert.equal(await portrait.selected.handler(ctx, { token: readToken, accountId: account._id, refresh: 1 }), null);
  assert.equal(reads, 1, 'Authorized selection reaches the account eligibility check');
  await sessions.revoke.handler(ctx, { tokenDigest: hash(readToken) });
  assert.equal(await portrait.availability.handler(ctx, { token: readToken }), false);
  delete process.env.ADMIN_SESSION_VERIFICATION_V2;
  assert.equal(await portrait.availability.handler(ctx, { token: process.env.ADMIN_TOKEN }), true, 'Legacy behavior stays unchanged until migration');
  console.log('PASS staged private portrait: closed readiness gate, scoped identity, authorization before account read, scope removal and revocation.');
})().catch(error => { console.error(error); process.exitCode = 1; });
