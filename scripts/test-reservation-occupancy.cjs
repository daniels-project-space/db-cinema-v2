const assert = require('node:assert/strict');
const { load, db, put, tables } = require('./lib/rentalTestHarness.cjs');
const availability = load('convex/availability.ts'), replacements = load('convex/cartReplacements.ts');
const { assertRentalInventory } = load('convex/lib/rentalInventory.ts');
const bookings = load('convex/bookings.ts'), sync = load('convex/sync.ts');
const realNow = Date.now, realFetch = global.fetch;
process.env.RMV2_WEBHOOK_URL='https://fixture-manager.convex.site/dbcinema/booking-sync';process.env.RMV2_WEBHOOK_SECRET='fixture-read-service';
const now = Date.UTC(2026, 9, 8, 12), day = 86400000, start = now + 90 * day, end = start + day;
Date.now = () => now;
const ctx = { db }, owned = put('inventory_units', { name: 'Owned camera', quantityOwned: 1, rmv2ItemId: 'master-camera' });
const camera = put('listings', { title: 'Sony FX3 body', slug: 'sony-fx3', category: 'Cameras', itemType: 'camera-body', active: true, components: [{ inventoryUnitId: owned._id, qty: 1 }], pricing: { daily: 40 }, depositAmount: 1000 });
const lines = [{ listingId: camera._id, qty: 1, start, end }];
const proposed = put('bookings', { status: 'pending_payment', lineItems: lines });
const marketing = put('listings', { ...camera, _id: 'marketing-camera', title: 'Sony FX6 camera body', marketingOnly: true });
const requested = [{ key: 'replacement', listingId: marketing._id, start, end }];
async function blocked() {
  assert.equal((await availability.forListing.handler(ctx, { listingId: camera._id, start, end })).available, 0);
  assert.equal((await availability.forCart.handler(ctx, { items: lines }))[camera._id].ok, false);
  await assert.rejects(() => assertRentalInventory(ctx, lines), /already reserved/);
  await assert.rejects(() => bookings.placeHolds.handler(ctx, { bookingId: proposed._id, ttlMs: 60000 }), /already reserved/);
  assert.equal((await replacements.forCart.handler(ctx, { items: requested })).replacement.length, 0);
}
(async () => {
  try {
    const out = put('reservations', { inventoryUnitId: owned._id, start: now - 40 * day, end: now - 30 * day, qty: 1, status: 'active' });
    const plannedEnd = out.end;
    await blocked(); assert.equal(out.end, plannedEnd, 'Stock checks must not rewrite a booked return date');
    out.status = 'returned';
    assert.equal((await availability.forListing.handler(ctx, { listingId: camera._id, start, end })).available, 1);
    assert.equal((await replacements.forCart.handler(ctx, { items: requested })).replacement[0].listingId, camera._id);
    const pending = put('bookings', { status: 'pending_payment' });
    const hold = put('reservations', { inventoryUnitId: owned._id, bookingId: pending._id, start, end, qty: 1, status: 'hold', holdExpiresAt: now - 1 });
    await blocked(); pending.status = 'cancelled';
    assert.equal((await availability.forCart.handler(ctx, { items: lines }))[camera._id].ok, true, 'A terminal reconciled payment releases an expired hold');
    await assertRentalInventory(ctx, lines); hold.status = 'cancelled';
    const upstream = [
      { _id: 'overdue', status: 'confirmed', order_step: 'DELIVERED', start_date: '2026-08-01', end_date: '2026-08-02', resolved_items: [{ item_id: 'master-camera', qty: 1 }] },
      { _id: 'returned', status: 'confirmed', order_step: 'RETURNED', start_date: '2026-10-08', end_date: '2027-05-01', resolved_items: [{ item_id: 'master-camera', qty: 1 }] },
      { _id: 'completed', status: 'completed', order_step: 'DELIVERED', start_date: '2026-10-08', end_date: '2027-05-01', resolved_items: [{ item_id: 'master-camera', qty: 1 }] },
    ];
    global.fetch = async (_url, options) => ({ ok: true, json: async () => ({ protocolVersion: 1, path: JSON.parse(options.body).path, status: 'success', value: upstream }) });
    const result = await sync.syncHyggloReservations.handler({ ...ctx, runMutation: async (_ref, args) => sync.applyHygglo.handler(ctx, args) }, {});
    assert.equal(result.mirrored, 1);
    const mirrored = tables.get('reservations').find(r => r.source === 'hygglo');
    assert.equal(mirrored.status, 'active'); assert.equal(mirrored.end, Date.parse('2026-08-02'));
    await blocked();
    upstream[0].order_step = 'RETURNED';
    assert.equal((await sync.syncHyggloReservations.handler({ ...ctx, runMutation: async (_ref, args) => sync.applyHygglo.handler(ctx, args) }, {})).mirrored, 0);
    assert.equal((await availability.forListing.handler(ctx, { listingId: camera._id, start, end })).available, 1);
    console.log('PASS actual occupancy/feed/cart/replacement/hold handlers: overdue custody preserved, planned dates intact, unresolved payment TTL retained, reconciled return/payment release and no returned/completed mirror stock.');
  } finally { Date.now = realNow; global.fetch = realFetch; }
})().catch(error => { console.error(error); process.exitCode = 1; });
