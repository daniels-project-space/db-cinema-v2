const assert = require('node:assert/strict');
const { load, db, put } = require('./lib/rentalTestHarness.cjs');
const archive = load('convex/verificationArchive.ts');

(async () => {
  const now = Date.now();
  const expiredAt = now - 91 * 86400000;
  const deletedFiles = [];
  const continuations = [];
  const ctx = {
    db,
    storage: { delete: async id => deletedFiles.push(id) },
    scheduler: { runAfter: async (delay, ref, args) => continuations.push({ delay, ref, args }) },
  };

  for (let index = 0; index < 30; index++) {
    const booking = put('bookings', { status: 'returned', returnedAt: expiredAt });
    const archiveRecord = put('verification_archives', {
      bookingId: booking._id,
      sessionId: `expired-session-${index}`,
      source: 'didit',
      status: 'complete',
      attempts: 1,
      dueAt: 0,
      createdAt: expiredAt,
    });
    const storageId = `expired-file-${index}`;
    put('verification_documents', {
      archiveId: archiveRecord._id,
      bookingId: booking._id,
      sessionId: archiveRecord.sessionId,
      kind: 'identity-front',
      storageId,
      sha256: 'a'.repeat(64),
      size: 1,
      contentType: 'image/jpeg',
      savedAt: expiredAt,
    });
  }

  assert.equal(await archive.purgeExpired.handler(ctx, {}), 25);
  assert.equal(deletedFiles.length, 25, 'Each purge transaction is capped at one indexed page');
  assert.equal(continuations.length, 1, 'More due records continue through the scheduler');
  assert.match(String(continuations[0].ref), /purgeExpired/);

  assert.equal(await archive.purgeExpired.handler(ctx, continuations.shift().args), 5);
  assert.equal(deletedFiles.length, 30);
  assert.equal(continuations.length, 0, 'The continuation stops when the indexed page is done');
  assert.equal(await archive.purgeExpired.handler(ctx, {}), 0, 'Repeated sweeps are idempotent');
  console.log('PASS verification archive purge pagination: bounded indexed due pages, complete expiry coverage and idempotent replay.');
})().catch(error => { console.error(error); process.exitCode = 1; });
