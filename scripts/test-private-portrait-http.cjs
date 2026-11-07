const assert = require('node:assert/strict');
const { createHash, webcrypto } = require('node:crypto');
const harness = require('./lib/rentalTestHarness.cjs');
global.crypto ??= webcrypto;
const routes = [];
harness.setMock('convex/server', { ...require('convex/server'), httpRouter: () => ({ route: route => routes.push(route) }) });
harness.setMock('./lib/accountVerificationReady', { accountVerificationReady: async () => true });
harness.setMock('./verificationArchive', { archiveRetention: async () => ({ viewable: true }), documentCopyAvailable: async () => true });
harness.load('convex/http.ts');
const portrait = harness.load('convex/privateVerificationPortrait.ts');
const route = routes.find(item => item.path === '/admin-private-portrait' && item.method === 'POST');
const now = Date.now(), token = 'fixture-admin', bytes = Buffer.from('synthetic-image');
process.env.ADMIN_TOKEN = token;
process.env.PRIVATE_VERIFICATION_PHOTO_ENABLED = 'true';
const account = harness.put('accounts', { email: 'portrait@example.invalid', createdAt: now - 90000000, privateVerificationPortraitNoticeVersion: '2026-11-06', privateVerificationPortraitConsentVersion: '2026-11-06', privateVerificationPortraitNotifiedAt: now - 10000, privateVerificationPortraitConsentedAt: now - 9000 });
const booking = harness.put('bookings', { accountId: account._id, diditSessionId: 'fixture' });
account.rentalVerification = { sourceBookingId: booking._id };
const archive = harness.put('verification_archives', { accountId: account._id, bookingId: booking._id, sessionId: 'fixture', status: 'complete' });
const document = harness.put('verification_documents', { accountId: account._id, bookingId: booking._id, archiveId: archive._id, kind: 'selfie-0-reference_image', contentType: 'image/png' });
let revokeDuringRead = false;
const ctx = {
  runQuery: async (ref, args) => { assert.equal(ref, 'privateVerificationPortrait.selected'); return portrait.selected.handler({ db: harness.db }, args); },
  runMutation: async (ref, args) => { assert.equal(ref, 'verificationArchive.downloadAccess'); assert.equal(args.documentId, document._id); return { storageId: 'fixture', size: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'), contentType: 'image/png' }; },
  storage: { get: async () => { if (revokeDuringRead) await harness.db.patch(account._id, { privateVerificationPortraitConsentVersion: undefined }); return new Blob([bytes]); } },
};
const request = (auth = token, accountId = account._id, documentId = document._id) => new Request('https://fixture.convex.site/admin-private-portrait', { method: 'POST', headers: { origin: 'https://dbcinemarentals.com', authorization: `Bearer ${auth}`, 'content-type': 'application/json' }, body: JSON.stringify({ accountId, documentId }) });
(async () => {
  const success = await route.handler(ctx, request());
  assert.equal(success.status, 200); assert.match(success.headers.get('cache-control'), /no-store/); assert.deepEqual(Buffer.from(await success.arrayBuffer()), bytes);
  assert.equal((await route.handler(ctx, request('not-admin'))).status, 403);
  assert.equal((await route.handler(ctx, request(token, account._id, 'other-document'))).status, 403);
  revokeDuringRead = true;
  assert.equal((await route.handler(ctx, request())).status, 403, 'Withdrawal while bytes are read must prevent delivery');
  assert.equal((await route.handler(ctx, request())).status, 403, 'Withdrawn consent cannot retrieve the portrait again');
  console.log('PASS private portrait HTTP route: authorization, selected document, integrity and withdrawal during read; synthetic data only.');
})().catch(error => { console.error(error); process.exitCode = 1; });
