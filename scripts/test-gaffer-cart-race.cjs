const assert = require('node:assert/strict');
const { load, setMock } = require('./lib/rentalTestHarness.cjs');
for (const [name, file] of Object.entries({ '@/lib/pricing': 'src/lib/pricing.ts', '@/lib/dates': 'src/lib/dates.ts', '@/lib/voiceDates': 'src/lib/voiceDates.ts', '@cvx/lib/gafferDiscount': 'convex/lib/gafferDiscount.ts' })) setMock(name, load(file));
const refs = [];
let cursor = 0, delayed = false, resolveStock, routes = [], emails = [], challenges = [];
let cart = { items: [{ key: 'camera', listingId: 'camera', title: 'Camera', start: '2026-11-20', end: '2026-11-21', pickupTime: '10:00', returnTime: '17:00', days: 2, perDay: 30, total: 60, deposit: 50 }], count: 1, subtotal: 60, depositTotal: 50, close() {} };
const convex = {
  query: async (name) => {
    if (name === 'availability.forCart') return delayed ? new Promise(resolve => { resolveStock = resolve; }) : { camera: { ok: true } };
    throw Error(`Unexpected query: ${name}`);
  },
  action: async (name, args) => {
    if (name === 'checkoutCarts.email') { emails.push(args); return { shareKey: `share-${emails.length}` }; }
    if (name === 'accountCodes.request') { challenges.push(args); return { challenge: 'challenge' }; }
    throw Error(`Unexpected action: ${name}`);
  },
};
setMock('react', { useRef: value => refs[cursor++] ?? (refs[cursor - 1] = { current: value }), useCallback: fn => fn, useMemo: fn => fn(), useEffect: () => {} });
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
  await tools.email_checkout_cart({ email: 'renter@example.invalid' });
  cart = { ...cart, items: [{ ...cart.items[0], pickupTime: '12:00' }] };
  tools = render();
  await tools.setup_account({ email: 'renter@example.invalid', name: 'Test Renter', phone: '07123456789' });
  assert.equal(emails.length, 2);
  assert.equal(emails[1].lines[0].pickupTime, '12:00');
  assert.equal(challenges[0].cartKey, 'share-2');
  cart = { ...cart, items: [], count: 0 };
  tools = render();
  await tools.setup_account({ email: 'renter@example.invalid', name: 'Test Renter', phone: '07123456789' });
  assert.equal(challenges[1].cartKey, undefined);
  console.log('PASS Gaffer checkout rejects stale availability and requires a fresh review; account links use the current basket.');
})().catch(error => { console.error(error); process.exitCode = 1; });
