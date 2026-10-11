const assert = require('node:assert/strict');
const h = require('./lib/rentalTestHarness.cjs');
const archive = h.load('convex/verificationArchive.ts');
const day = 86400000, originalNow = Date.now;
let now = Date.UTC(2035, 0, 1); Date.now = () => now;
const pending = [], pages = [], deleted = [];
let failedStorageId;
const db = { ...h.db, query(table) {
  const query = h.db.query(table);
  if (table === 'verification_archives') {
    query.collect = async () => { throw Error('Cleanup must not collect the entire archive table'); };
    const withIndex = query.withIndex.bind(query), paginate = query.paginate.bind(query);
    query.withIndex = (index, range) => { assert.equal(index, 'by_creation_time'); return withIndex(index, range); };
    query.paginate = async options => {
      assert(options.numItems <= 20); assert(options.maximumRowsRead <= 20);
      assert(options.maximumBytesRead <= 256 * 1024);
      const page = await paginate(options); pages.push(page.page.map(row => row._id)); return page;
    };
  }
  return query;
} };
const ctx = { db, storage: { delete: async id => {
  if (id === failedStorageId) throw Error('Private storage temporarily unavailable');
  deleted.push(id);
} },
  scheduler: { runAfter: async (delay, ref, args) => {
    assert.equal(delay, 1000); assert.equal(ref, 'verificationArchive.purgeExpired'); pending.push(args);
  } } };
function fixture(kind = 'expired', extra = {}) {
  const booking = h.put('bookings', { status: kind === 'active' ? 'active' : 'returned',
    actualReturnedAt: now - 31 * day, returnedAt: now - day });
  const row = h.put('verification_archives', { bookingId: booking._id, status: 'complete',
    sessionId: 'isolated-retention', source: 'didit', ...extra });
  const document = h.put('verification_documents', { archiveId: row._id, storageId: 'private-' + row._id, sha256: 'a'.repeat(64) });
  if (kind === 'case') h.put('rental_damage_cases', { bookingId: booking._id, status: 'open' });
  if (kind === 'manual') row.retentionHoldReason = 'Insurance evidence remains necessary';
  if (kind === 'unknown') booking.actualReturnedAt = now + day;
  if (kind === 'boundary') booking.actualReturnedAt = now - 30 * day + 10000;
  if (kind === 'reused') h.put('bookings', { status: 'active', verificationReusedFrom: booking._id });
  return { booking, row, document, kind };
}
async function drain() {
  let removed = 0, count = 0;
  while (pending.length) {
    assert(++count < 100, 'Cleanup must finish its frozen window');
    removed += await archive.purgeExpired.handler(ctx, pending.shift());
  }
  return removed;
}
(async () => {
  // Existing tombstones can fill entire pages: a zero-removal page must advance.
  const tombstones = Array.from({ length: 40 }, () => fixture('expired', { status: 'deleted' }));
  const expired = Array.from({ length: 87 }, (_, i) => fixture('expired', { status: ['complete', 'pending', 'attention', 'legacy-state'][i % 4] }));
  expired[0].booking.status = 'cancelled'; expired[0].booking.cancelledAt = now - 31 * day;
  expired[0].booking.actualReturnedAt = now + day;
  expired[1].row.source = 'drone';
  const preserved = ['active', 'case', 'manual', 'unknown', 'boundary', 'reused'].map(kind => fixture(kind));
  let removed = await archive.purgeExpired.handler(ctx, {});
  assert.equal(removed, 0); assert.equal(pending.length, 1);
  const cutoff = pending[0].cutoff; assert.equal(cutoff, now);
  now += 2000;
  const arrival = fixture('expired', { _creationTime: cutoff + 1 });
  // Actual retention is re-read on later pages, after concurrent admin/rental changes.
  const lateCase = h.put('rental_damage_cases', { bookingId: expired[70].booking._id, status: 'open' });
  expired[71].row.retentionHoldReason = 'New insurance hold added during the sweep';
  const lateReuse = h.put('bookings', { status: 'active', verificationReusedFrom: expired[72].booking._id });
  removed += await drain();
  assert.equal(removed, 84, 'Every eligible expired archive beyond the old 25-per-day cap is processed');
  assert.equal(deleted.length, 84);
  assert.equal(arrival.row.status, 'complete', 'New arrivals are outside the frozen sweep');
  assert(pages.length > 6); assert(pages.every(page => page.length <= 20));
  assert.equal(new Set(pages.flat()).size, 133, 'Every pre-existing archive is visited once despite status changes');
  for (const item of preserved) assert.notEqual(item.row.status, 'deleted', item.kind + ' must preserve documents');
  for (const index of [70, 71, 72]) assert.notEqual(expired[index].row.status, 'deleted');
  for (const item of tombstones) assert(!deleted.includes(item.document.storageId), 'Existing tombstones never delete bytes again');
  assert(expired.every(item => item.document.sha256 === 'a'.repeat(64)), 'Document integrity audit remains after byte deletion');
  lateCase.status = 'closed'; expired[71].row.retentionHoldReason = undefined;
  lateReuse.status = 'returned'; lateReuse.actualReturnedAt = now - 31 * day;
  const previousDeletes = deleted.length;
  removed = await archive.purgeExpired.handler(ctx, {}) + await drain();
  assert.equal(removed, 4, 'Next sweep handles the deferred arrival and newly released holds');
  assert.equal(deleted.length - previousDeletes, 4, 'Replaying a full sweep does not repeat tombstone deletions');
  assert.equal(arrival.row.status, 'deleted');
  const failed = fixture(); failedStorageId = failed.document.storageId;
  h.put('_storage', { _id: failedStorageId, size: 100 });
  await archive.purgeExpired.handler(ctx, {});
  await assert.rejects(drain(), /Private storage temporarily unavailable/);
  assert.equal(failed.row.status, 'complete', 'Storage failure must not mark retained evidence as deleted');
  assert.equal(pending.length, 0, 'Failed page does not schedule an automatic failure loop');
  failedStorageId = undefined;
  removed = await archive.purgeExpired.handler(ctx, {}) + await drain();
  assert.equal(removed, 1, 'The next scheduled sweep recovers a failed deletion without duplicating prior deletions');
  assert.equal(failed.row.status, 'deleted');
  await assert.rejects(archive.purgeExpired.handler(ctx, { cutoff: now + day }), /Invalid archive cleanup window/);
  console.log('PASS actual bounded retention sweep: 133 rows, tombstone-only pages, all statuses, cancelled/drone copies, frozen arrivals, live claim/manual/reuse changes, storage failure recovery, full backlog coverage, safe replay and retained audit. No provider writes.');
})().finally(() => { Date.now = originalNow; }).catch(error => { console.error(error); process.exitCode = 1; });
