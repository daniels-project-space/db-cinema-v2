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
    const parent=put('bookings',{status:'confirmed'});
    const extension=put('booking_change_requests',{bookingId:parent._id,type:'extend',status:'approved'});
    const amendment=put('reservations',{inventoryUnitId:owned._id,bookingId:parent._id,extensionRequestId:extension._id,start,end,qty:1,status:'hold',source:'site',holdExpiresAt:now-1});
    for(const status of ['approved','awaiting_payment','refund_pending','pending','unknown']){
      extension.status=status;await blocked();await bookings.releaseExpiredHolds.handler(ctx,{});assert(await db.get(amendment._id),'Unresolved extension survives cleanup: '+status);
    }
    extension.status='expired';assert.equal((await availability.forCart.handler(ctx,{items:lines}))[camera._id].ok,true);await bookings.releaseExpiredHolds.handler(ctx,{});assert.equal(await db.get(amendment._id),null,'Provider-attested terminal extension permits cleanup');
    const addition=put('rental_additions',{bookingId:parent._id,status:'prepared'});
    const added=put('reservations',{inventoryUnitId:owned._id,bookingId:parent._id,externalRef:`addition:${addition._id}`,start,end,qty:1,status:'hold',source:'site',holdExpiresAt:now-1});
    for(const status of ['prepared','awaiting_payment','paid','refund_pending','unknown']){
      addition.status=status;await blocked();await bookings.releaseExpiredHolds.handler(ctx,{});assert(await db.get(added._id),'Unresolved addition survives cleanup: '+status);
    }
    addition.status='refunded';assert.equal((await availability.forCart.handler(ctx,{items:lines}))[camera._id].ok,true);await bookings.releaseExpiredHolds.handler(ctx,{});assert.equal(await db.get(added._id),null);
    const orphan=put('reservations',{inventoryUnitId:owned._id,bookingId:parent._id,extensionRequestId:'missing-request',start,end,qty:1,status:'hold',source:'site',holdExpiresAt:now-1});
    await blocked();await bookings.releaseExpiredHolds.handler(ctx,{});assert(await db.get(orphan._id),'Unknown binding requires reconciliation instead of stock release');orphan.status='cancelled';
    const foreign=put('booking_change_requests',{bookingId:'other-booking',type:'extend',status:'refunded'});
    const wrong=put('reservations',{inventoryUnitId:owned._id,bookingId:parent._id,extensionRequestId:foreign._id,start,end,qty:1,status:'hold',source:'site',holdExpiresAt:now-1});
    await blocked();await bookings.releaseExpiredHolds.handler(ctx,{});assert(await db.get(wrong._id),'Another rental\'s terminal amendment cannot free this reservation');wrong.status='cancelled';
    const upstream={version:1,checkedAt:now,units:[{masterItemId:'master-camera',active:true,quantityOwned:1,windows:[{start:Date.parse('2026-08-01'),end:Date.parse('9999-12-31'),qty:1}]}]};
    global.fetch = async (_url, options) => ({ ok: true, json: async () => ({ protocolVersion: 1, path: JSON.parse(options.body).path, status: 'success', value: [upstream] }) });
    const result = await sync.syncHyggloReservations.handler({ ...ctx, runMutation: async (_ref, args) => sync.applySharedStock.handler(ctx, args) }, {});
    assert.equal(result.mirrored, 1);
    const mirrored = tables.get('reservations').find(r => r.source === 'hygglo');
    assert.equal(mirrored.status, 'confirmed'); assert.equal(mirrored.endExclusive,true);
    await blocked();
    upstream.units[0].windows=[];upstream.checkedAt=now+1;
    assert.equal((await sync.syncHyggloReservations.handler({ ...ctx, runMutation: async (_ref, args) => sync.applySharedStock.handler(ctx, args) }, {})).mirrored, 0);
    assert.equal((await availability.forListing.handler(ctx, { listingId: camera._id, start, end })).available, 1);
    console.log('PASS actual occupancy/feed/cart/replacement/hold handlers: overdue custody preserved, planned dates intact, unresolved payment TTL retained, reconciled return/payment release and canonical shared-source release.');
  } finally { Date.now = realNow; global.fetch = realFetch; }
})().catch(error => { console.error(error); process.exitCode = 1; });
