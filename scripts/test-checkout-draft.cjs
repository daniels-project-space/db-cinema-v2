const assert = require('node:assert/strict');
const { load } = require('./lib/rentalTestHarness.cjs');
const { readCheckoutDraft, saveCheckoutDraft, checkoutDraftKey } = load('src/lib/checkoutDraft.ts');
const values = new Map();
const storage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
const now = Date.UTC(2026, 9, 8);
const draft = { email: 'renter@example.invalid', name: 'Fixture Renter', phone: '07000000000',
  billingAddress: '123 Fixture Street, London', fulfilment: 'delivery', address: '123 Fixture Street, London',
  postcode: 'SW1A 1AA', protection: 'deposit', pickupTime: '10:00', returnTime: '18:00', agreed: true, deliveryAgreed: true };
saveCheckoutDraft(storage, 'guest', 'current-documents', { ...draft, signature: 'NEVER STORE ME', quote: 1,
  requestId: 'do-not-replay', accountToken: 'do-not-store', recovery: {} }, now);
assert.deepEqual(readCheckoutDraft(storage, 'guest', 'current-documents', now + 100), draft);
const raw = storage.getItem(checkoutDraftKey('guest'));
for (const secret of ['NEVER STORE ME', 'do-not-replay', 'do-not-store', 'quote', 'recovery']) assert(!raw.includes(secret));
assert.equal(readCheckoutDraft(storage, 'account:second', 'current-documents', now), null);
saveCheckoutDraft(storage, 'account:first', 'current-documents', { ...draft, email: 'first@example.invalid' }, now);
saveCheckoutDraft(storage, 'account:second', 'current-documents', { ...draft, email: 'second@example.invalid' }, now);
assert.equal(readCheckoutDraft(storage, 'account:first', 'current-documents', now).email, 'first@example.invalid');
assert.equal(readCheckoutDraft(storage, 'account:second', 'current-documents', now).email, 'second@example.invalid');
assert.deepEqual(readCheckoutDraft(storage, 'guest', 'new-legal-version', now), { ...draft, agreed: false, deliveryAgreed: false });
assert.equal(readCheckoutDraft(storage, 'guest', 'current-documents', now + 86400001), null);
assert.equal(readCheckoutDraft(storage, 'guest', 'current-documents', now - 60001), null);
values.set(checkoutDraftKey('guest'), '{corrupt');
assert.equal(readCheckoutDraft(storage, 'guest', 'current-documents', now), null);
saveCheckoutDraft(storage, 'guest', 'current-documents', { ...draft, pickupTime: '04:00', returnTime: 'oops',
  fulfilment: 'invalid', protection: 'invalid', agreed: 'yes', deliveryAgreed: 'yes' }, now);
assert.deepEqual(readCheckoutDraft(storage, 'guest', 'current-documents', now), { ...draft, pickupTime: '', returnTime: '',
  fulfilment: 'pickup', protection: 'verify', agreed: false, deliveryAgreed: false });
const denied = { getItem() { throw Error('Storage denied'); }, setItem() { throw Error('Quota exceeded'); } };
assert.equal(readCheckoutDraft(denied, 'guest', 'terms', now), null);
assert.doesNotThrow(() => saveCheckoutDraft(denied, 'guest', 'terms', draft, now));
assert.equal(readCheckoutDraft(null, 'guest', 'terms', now), null);
assert.doesNotThrow(() => saveCheckoutDraft(null, 'guest', 'terms', draft, now));
console.log('PASS checkout draft: bounded tab/session storage, account isolation, legal version expiry, valid slots, corruption/storage recovery, and no saved signature/payment attempt/pricing.');
