const assert = require('node:assert/strict');
const { load, put, db } = require('./lib/rentalTestHarness.cjs');
const catalog = load('convex/catalog.ts');
const row = (slug, title, extra = {}) => put('listings', {
  slug, title, itemType: 'camera-body', category: 'Cameras', active: true,
  stockMappingStatus: 'complete', components: [{ inventoryUnitId: 'fixture-unit', qty: 1 }], pricing: { daily: 25 }, depositAmount: 0,
  sourceImages: ['https://example.com/camera.jpg'], ...extra,
});

(async () => {
  const owned = row('owned', 'Sony FX6 Camera', { marketingOnly: false, marketingOnlySource: 'admin' });
  const marketing = row('hidden', 'Marketing Camera', { marketingOnly: true, marketingOnlySource: 'admin' });
  const suppressed = row('suppressed', 'Suppressed Camera', { suppressed: true });
  const automatic = row('automatic', 'Canon R5 Camera');
  const unconfirmed = row('unconfirmed', 'Sony FX3 Request Kit', { stockMappingStatus: 'incomplete' });
  const emptyMapping = row('empty-mapping', 'Camera with Missing Stock Mapping', { components: [] });
  const ctx = { db };
  const args = { paginationOpts: { cursor: null, numItems: 100 } };
  const listings = await catalog.listListings.handler(ctx, {});
  assert(listings.some(item => item._id === owned._id));
  assert.equal(listings.find(item => item._id === unconfirmed._id).bookable, false);
  assert.equal(listings.find(item => item._id === emptyMapping._id).bookable, false, 'A listing without physical components cannot be presented as bookable');
  assert.equal((await catalog.bestSellers.handler(ctx, {})).find(item => item._id === unconfirmed._id).bookable, false);
  assert.equal((await catalog.featured.handler(ctx, {})).find(item => item._id === unconfirmed._id).bookable, false);
  assert.equal((await catalog.byItemType.handler(ctx, { types: ['camera-body'] })).find(item => item._id === unconfirmed._id).bookable, false);
  assert.equal((await catalog.byItemTypeInternal.handler(ctx, { types: ['camera-body'] })).length, 6);
  const byId = await catalog.listingsByIds.handler(ctx, { ids: [owned._id, marketing._id, suppressed._id, automatic._id, unconfirmed._id, emptyMapping._id] });
  assert.deepEqual(byId.map(item => item._id), [owned._id, unconfirmed._id, emptyMapping._id]);
  assert.equal(byId.find(item => item._id === unconfirmed._id).bookable, false);
  assert.equal(byId.find(item => item._id === emptyMapping._id).bookable, false);
  assert((await catalog.allBasic.handler(ctx, {})).some(item => item._id === unconfirmed._id));
  assert.deepEqual((await catalog.allSlugs.handler(ctx, {})).map(item => item.slug), ['owned', 'unconfirmed', 'empty-mapping']);
  assert.deepEqual(await catalog.categories.handler(ctx, {}), [{ name: 'Cameras', count: 3 }]);
  assert.equal(await catalog.getListingBySlug.handler(ctx, { slug: 'hidden' }), null);
  assert.equal(await catalog.getListingBySlug.handler(ctx, { slug: 'suppressed' }), null);
  assert.equal((await catalog.getListingBySlug.handler(ctx, { slug: 'owned' }))._id, owned._id);
  assert.equal((await catalog.getListingBySlug.handler(ctx, { slug: 'unconfirmed' })).bookable, false);
  assert.equal((await catalog.getListingBySlug.handler(ctx, { slug: 'empty-mapping' })).bookable, false);
  const adminListings = await catalog.adminListListings.handler(ctx, { token: process.env.ADMIN_TOKEN = 'fixture-token', ...args });
  assert(adminListings.page.some(item => item._id === marketing._id));
  assert(adminListings.page.some(item => item._id === unconfirmed._id), 'Admin retains access to repair unverified stock mappings');
  assert(adminListings.page.some(item => item._id === emptyMapping._id), 'Admin retains access to repair missing stock components');
  assert(!(await catalog.listForMigration.handler(ctx, {})).some(item => item.slug === 'hidden'));
  assert((await catalog.listForMigration.handler(ctx, { token: process.env.ADMIN_TOKEN })).some(item => item.slug === 'hidden'), 'Authorized image migration still sees hidden catalogue records');
  marketing.marketingOnly = false;
  assert((await catalog.listListings.handler(ctx, {})).some(item => item._id === marketing._id), 'Explicitly unmarked gear reappears without changing its label');
  assert.equal((await catalog.getListingBySlug.handler(ctx, { slug: 'hidden' }))._id, marketing._id);
  console.log('PASS request-only stock labels, public catalogue projections, admin repair access and restored listing');
})().catch(error => { console.error(error); process.exitCode = 1; });
