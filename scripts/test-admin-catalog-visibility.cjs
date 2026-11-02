const assert = require('node:assert/strict');
const { load, put, db, tables } = require('./lib/rentalTestHarness.cjs');

process.env.ADMIN_TOKEN = 'catalog-visibility-test-token';
const catalog = load('convex/catalog.ts');
const row = (title, extra = {}) => put('listings', {
  slug: title.toLowerCase().replaceAll(' ', '-'), title, category: 'Cameras',
  active: true, components: [], pricing: { daily: 25 }, depositAmount: 0, ...extra,
});

(async () => {
  const available = row('Owned camera', { marketingOnly: false, marketingOnlySource: 'admin' });
  const marketing = row('Marketing camera', { marketingOnly: true, marketingOnlySource: 'admin' });
  const suppressed = row('Suppressed camera', { active: false, suppressed: true, sourceImages: ['https://example.com/camera.jpg'] });
  const ctx = { db: { ...db, query(table) {
    const query = db.query(table);
    query.withSearchIndex = (_name, build) => {
      let term = '';
      build({ search: (_field, value) => { term = value.toLowerCase(); } });
      const rows = (tables.get(table) ?? []).filter(item => item.title.toLowerCase().includes(term));
      return { paginate: async ({ cursor, numItems }) => {
        const start = Number(cursor ?? 0);
        return { page: rows.slice(start, start + numItems), isDone: start + numItems >= rows.length, continueCursor: String(start + numItems) };
      } };
    };
    return query;
  } } };
  const page = (cursor = null, numItems = 100) => ({ cursor, numItems });
  await assert.rejects(catalog.adminListListings.handler(ctx, { token: 'wrong', paginationOpts: page() }), /Unauthorized/);
  const rows = (await catalog.adminListListings.handler(ctx, { token: process.env.ADMIN_TOKEN, paginationOpts: page() })).page;
  assert(rows.some(item => item._id === available._id));
  assert(rows.some(item => item._id === marketing._id));
  assert(rows.some(item => item._id === suppressed._id));
  const search = await catalog.adminListListings.handler(ctx, { token: process.env.ADMIN_TOKEN, search: 'marketing', paginationOpts: page() });
  assert.deepEqual(search.page.map(item => item._id), [marketing._id]);
  const first = await catalog.adminListListings.handler(ctx, { token: process.env.ADMIN_TOKEN, paginationOpts: page(null, 1) });
  const second = await catalog.adminListListings.handler(ctx, { token: process.env.ADMIN_TOKEN, paginationOpts: page(first.continueCursor, 1) });
  assert.notEqual(first.page[0]._id, second.page[0]._id);
  await assert.rejects(catalog.adminListListings.handler(ctx, { token: process.env.ADMIN_TOKEN, paginationOpts: page(null, 101) }), /page size/);
  console.log('PASS authorized admin listing access, hidden items and scoped search');
})().catch(error => { console.error(error); process.exitCode = 1; });
