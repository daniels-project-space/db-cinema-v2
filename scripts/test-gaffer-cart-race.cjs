const assert = require('node:assert/strict');
const { load, setMock } = require('./lib/rentalTestHarness.cjs');
for (const [name, file] of Object.entries({ '@/lib/pricing': 'src/lib/pricing.ts', '@/lib/dates': 'src/lib/dates.ts', '@/lib/voiceDates': 'src/lib/voiceDates.ts', '@cvx/lib/gafferDiscount': 'convex/lib/gafferDiscount.ts' })) setMock(name, load(file));
const refs = [];
let cursor = 0, delayed = false, resolveStock, routes = [], emails = [], challenges = [], failNextCartEmailResponse = false;
let catalogMatches = [], categoryRows = [], availabilityResults = { camera: { ok: true } }, addedItems = [];
let cart = { items: [{ key: 'camera', listingId: 'camera', title: 'Camera', start: '2026-11-20', end: '2026-11-21', pickupTime: '10:00', returnTime: '17:00', days: 2, perDay: 30, total: 60, deposit: 50 }], count: 1, subtotal: 60, depositTotal: 50, has: id => cart.items.some(item => item.listingId === id), add: item => addedItems.push(item), close() {}, open() {} };
const convex = {
  query: async (name) => {
    if (name === 'availability.forCart') return delayed ? new Promise(resolve => { resolveStock = resolve; }) : availabilityResults;
    if (name === 'voiceCatalog.search') return { matches: catalogMatches };
    if (name === 'voiceCatalog.byCategory') return categoryRows;
    throw Error(`Unexpected query: ${name}`);
  },
  action: async (name, args) => {
    if (name === 'checkoutCarts.email') {
      emails.push(args);
      if (failNextCartEmailResponse) { failNextCartEmailResponse = false; throw Error('The response was lost after email delivery.'); }
      return { shareKey: args.shareKey };
    }
    if (name === 'accountCodes.request') { challenges.push(args); return { challenge: 'challenge' }; }
    throw Error(`Unexpected action: ${name}`);
  },
};
setMock('react', { useRef: value => refs[cursor++] ?? (refs[cursor - 1] = { current: value }), useState: initial => [initial, () => {}], useCallback: fn => fn, useMemo: fn => fn(), useEffect: () => {} });
setMock('next/navigation', { useRouter: () => ({ push: route => routes.push(route) }) });
setMock('convex/react', { useConvex: () => convex, useQuery: name => name === 'settings.get' ? {} : name === 'catalog.listListings' ? [] : {} });
setMock('@/components/cart/CartProvider', { useCart: () => cart });
setMock('@/components/account/AccountProvider', { useAccount: () => ({}) });
setMock('@/components/account/useCreditBalance', { useCreditBalance: () => undefined });
setMock('@/components/gaffer/GafferFocus', { useGafferFocus: () => ({ focus() {}, suggest: async () => false, suggestedIds: [], focusedId: null }), scrollToId: async () => false });
const { useGafferTools } = load('src/components/gaffer/useGafferTools.ts');
function render() { cursor = 0; return useGafferTools().clientTools; }
(async () => {
  let tools = render();
  delayed = true;
  const pending = tools.go_to_checkout();
  cart = { ...cart, items: [{ ...cart.items[0], pickupTime: '11:00' }] };
  tools = render();
  resolveStock({ camera: { ok: true } });
  assert.match(await pending, /basket changed/i);
  assert(!routes.includes('/checkout'));
  delayed = false;
  assert.match(await tools.go_to_checkout(), /full breakdown/i);
  assert.equal(routes.at(-1), '/cart');
  cart = { ...cart, items: [{ ...cart.items[0], returnTime: '18:00' }] };
  tools = render();
  assert.match(await tools.go_to_checkout(), /full breakdown/i);
  assert.equal(routes.at(-1), '/cart');
  assert.match(await tools.go_to_checkout(), /taking them to checkout/i);
  assert.equal(routes.at(-1), '/checkout');
  failNextCartEmailResponse = true;
  assert.match(await tools.email_checkout_cart({ email: 'renter@example.invalid' }), /response was lost/);
  const firstShareKey = emails[0].shareKey;
  assert.match(firstShareKey, /^[A-Za-z0-9_-]{43}$/);
  assert.match(await tools.email_checkout_cart({ email: 'renter@example.invalid' }), /was emailed/);
  assert.equal(emails[1].shareKey, firstShareKey, 'uncertain retries reuse the same idempotency key');
  assert.match(await tools.email_checkout_cart({ email: 'renter@example.invalid' }), /avoided sending a duplicate/);
  assert.equal(emails.length, 2, 'a completed cart email is not sent again on a duplicate tool call');
  cart = { ...cart, items: [{ ...cart.items[0], pickupTime: '12:00' }] };
  tools = render();
  await tools.setup_account({ email: 'renter@example.invalid', name: 'Test Renter', phone: '07123456789' });
  assert.equal(emails.length, 3, 'a changed basket receives a separate email link');
  assert.equal(emails[2].lines[0].pickupTime, '12:00');
  assert.notEqual(emails[2].shareKey, firstShareKey, 'a changed basket cannot reuse the earlier idempotency key');
  assert.equal(challenges[0].cartKey, emails[2].shareKey);
  cart = { ...cart, items: [], count: 0 };
  tools = render();
  await tools.setup_account({ email: 'renter@example.invalid', name: 'Test Renter', phone: '07123456789' });
  assert.equal(challenges[1].cartKey, undefined);

  const requested = { id: 'requested', title: 'Requested camera', slug: 'requested-camera', category: 'Cameras', daily: 40, minDays: 1 };
  const alternative = { id: 'alternative', title: 'Alternative camera', slug: 'alternative-camera', category: 'Cameras', daily: 25, minDays: 1 };
  catalogMatches = [requested];
  categoryRows = [requested, alternative];
  cart = { ...cart, items: [], count: 0, subtotal: 0, depositTotal: 0 };
  availabilityResults = { requested: { ok: false, available: 0 }, alternative: {} };
  tools = render();
  const unconfirmedAdd = await tools.add_to_basket({ item: requested.title, start: '2035-11-20', end: '2035-11-21' });
  assert.match(unconfirmedAdd, /booked out/i);
  assert.match(unconfirmedAdd, /couldn't confirm whether any other items are free/i);
  assert.doesNotMatch(unconfirmedAdd, /nothing else.*free/i, 'an unknown alternative query must not be reported as no free inventory');
  assert.equal(addedItems.length, 0, 'a booked-out item is not added while alternatives are being checked');

  tools = render();
  const unconfirmedSuggestion = await tools.suggest_alternatives({ item: requested.title, start: '2035-11-20', end: '2035-11-21' });
  assert.match(unconfirmedSuggestion, /couldn't confirm whether other Cameras items are free/i);
  assert.doesNotMatch(unconfirmedSuggestion, /nothing else.*free/i, 'unknown inventory must stay distinct from confirmed zero stock');

  availabilityResults = { requested: { ok: false, available: 0 }, alternative: { ok: false, available: 0 } };
  tools = render();
  const confirmedEmpty = await tools.suggest_alternatives({ item: requested.title, start: '2035-11-20', end: '2035-11-21' });
  assert.match(confirmedEmpty, /Nothing else in Cameras is free/i, 'confirmed zero availability can be stated plainly');

  availabilityResults = { requested: { ok: false, available: 0 }, alternative: { ok: true, available: 2 } };
  tools = render();
  const confirmedAlternative = await tools.suggest_alternatives({ item: requested.title, start: '2035-11-20', end: '2035-11-21' });
  assert.match(confirmedAlternative, /Alternative camera at £25 a day/);
  console.log('PASS Gaffer preserves unknown availability, distinguishes confirmed empty alternatives, rejects stale checkout checks and keeps account links current.');
})().catch(error => { console.error(error); process.exitCode = 1; });
