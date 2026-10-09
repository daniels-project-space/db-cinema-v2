const assert = require('node:assert/strict');
const { load, db, put, setMock } = require('./lib/rentalTestHarness.cjs');
const intents = new Map(), events = [];
let cancelFailure = null, badReceipt = false, onSetup = null, configurationActive = true, serial = 0;
class StripeFixture {
  paymentIntents = {
    retrieve: async id => intents.get(id),
    cancel: async id => { events.push(['cancel', id]); if (cancelFailure === id) throw Error('Controlled cancellation failure'); const intent = intents.get(id); intent.status = 'canceled'; return badReceipt ? { ...intent, amount_received: 100 } : intent; },
  };
  paymentMethodConfigurations = { retrieve: async () => ({ active: configurationActive, card: { display_preference: { value: 'on' } }, apple_pay: { display_preference: { value: 'off' } }, google_pay: { display_preference: { value: 'off' } }, link: { display_preference: { value: 'off' } } }) };
  checkout = { sessions: { create: async args => { const session = { id: 'cs-' + ++serial, url: 'https://controlled.example.invalid/setup' }; events.push(['setup', args, session.id]); if (onSetup) await onSetup(); return session; } } };
}
setMock('stripe', { default: StripeFixture }); setMock('./lib/mailer', { sendMail: async () => true });
process.env.STRIPE_SECRET_KEY = 'sk_test_controlled'; process.env.STRIPE_RENTAL_PAYMENT_METHOD_CONFIGURATION_ID = 'pmc_controlled'; process.env.APP_URL = 'https://rental.example.invalid';
const pickup = load('convex/pickupSecurity.ts'), holds = load('convex/holdRenewal.ts'), bookings = load('convex/bookings.ts'), accounts = load('convex/accounts.ts');
const { PICKUP_HOLD_POLICY, pickupHoldAt } = load('shared/pickupSecurity.ts');
const owner = put('accounts', { email: 'owner@example.invalid' }), other = put('accounts', { email: 'other@example.invalid' });
put('sessions', { token: 'owner', accountId: owner._id, expiresAt: Date.now() + 86400000 }); put('sessions', { token: 'foreign', accountId: other._id, expiresAt: Date.now() + 86400000 });
const modules = { pickupSecurity: pickup, holdRenewal: holds, bookings, accounts };
const mutationCtx = { db, scheduler: { runAfter: async (delay, ref, args) => events.push(['job', ref, args]), runAt: async (when, ref, args) => { events.push(['scheduled', ref, args]); return 'job-' + ++serial; } } };
const ctx = { runQuery: async (ref, args) => { const [m, f] = ref.split('.'); return modules[m][f].handler({ db }, args); }, runMutation: async (ref, args) => { const [m, f] = ref.split('.'); return modules[m][f].handler(mutationCtx, args); } };
function fixture(pending = false) {
  events.length = 0; cancelFailure = null; badReceipt = false; onSetup = null; configurationActive = true;
  const start = Math.floor(Date.now() / 86400000) * 86400000;
  const b = put('bookings', { accountId: owner._id, guestEmail: owner.email, status: 'confirmed', depositHoldStatus: 'failed', depositHoldAmount: 100, securityHoldPolicyVersion: PICKUP_HOLD_POLICY, securityHoldGeneration: 1, securityHoldCustomerId: 'cus_owner', securityHoldPaymentMethodId: 'pm_old', lineItems: [{ start, end: start + 86400000, pickupTime: '00:00' }], depositHoldRenewalStatus: 'requires_action', depositHoldRenewalAt: Date.now() });
  b.securityHoldDueAt = pickupHoldAt(b);
  const old = { id: 'original-' + b._id, status: 'canceled', amount: 10000, amount_capturable: 0, amount_received: 0, capture_method: 'manual', currency: 'gbp', customer: 'cus_owner', payment_method: 'pm_old', metadata: { bookingId: b._id, purpose: 'pickup_security_hold', generation: '1' } };
  const next = { ...old, id: 'renewal-' + b._id, status: pending ? 'requires_action' : 'canceled', metadata: { bookingId: b._id, purpose: 'security_hold_renewal', replaces: old.id } };
  intents.set(old.id, old); intents.set(next.id, next); b.stripeDepositIntentId = pending ? old.id : next.id; b.depositHoldRenewalIntentId = next.id;
  return { b, old, next };
}
async function update(f) { return holds.updatePickupCard.handler(ctx, { token: 'owner', bookingId: f.b._id }); }
async function finish(f) { return pickup.recoverCard.handler(mutationCtx, { bookingId: f.b._id, sessionId: f.b.securityHoldRecoverySessionId, customerId: 'cus_owner', paymentMethodId: 'pm_new' }); }
(async () => {
  for (const pending of [false, true]) {
    const f = fixture(pending); f.b.depositHoldPreviousIntentIds = ['earlier-unresolved']; await update(f);
    assert.equal(f.next.status, 'canceled', 'A separate pending renewal is retired before card setup');
    assert.equal(events.find(e => e[0] === 'setup')[1].mode, 'setup');
    if (pending) assert(events.findIndex(e => e[0] === 'cancel' && e[1] === f.next.id) < events.findIndex(e => e[0] === 'setup'));
    assert.equal(await finish(f), true); assert.equal(f.b.securityHoldGeneration, 2); assert.equal(f.b.securityHoldPaymentMethodId, 'pm_new');
    assert.equal(f.b.depositHoldStatus, 'scheduled'); assert.equal(f.b.depositHoldRenewalIntentId, undefined); assert.equal(f.b.depositHoldRenewalStatus, undefined); assert.equal(f.b.depositHoldRenewalAt, undefined);
    assert.deepEqual(f.b.depositHoldPreviousIntentIds, ['earlier-unresolved'], 'Unrelated release receipts must remain recorded');
    assert.equal((await accounts.myBookings.handler({ db }, { token: 'owner' })).find(row => row._id === f.b._id).depositHoldReleasePending, true);
    assert.equal(await finish(f), false, 'Card setup is one-time and cannot advance generation twice');
    f.b.depositHoldStatus = 'failed'; f.b.securityHoldRecoverySessionId = 'old-session'; f.b.securityHoldRecoveryGeneration = 2; f.b.securityHoldRecoveryReleasedIntentId = undefined; f.b.securityHoldRecoveryRenewalIntentId = undefined; f.b.depositHoldRenewalIntentId = 'new-pending';
    assert.equal(await pickup.recoverCard.handler(mutationCtx, { bookingId: f.b._id, sessionId: 'old-session', customerId: 'cus_owner', paymentMethodId: 'pm_unwanted' }), false, 'A changed pending authorisation blocks a stale setup receipt');
  }
  for (const status of ['processing', 'requires_capture', 'succeeded']) {
    const f = fixture(true); f.next.status = status; await assert.rejects(update(f), /held, charged or still processing/); assert.equal(events.length, 0, 'Unsafe pending renewal must block before any cancellation or setup');
  }
  for (const [field, value] of [['customer', 'cus_foreign'], ['payment_method', 'pm_foreign'], ['amount', 1], ['currency', 'usd'], ['capture_method', 'automatic']]) {
    const f = fixture(true); f.next[field] = value; await assert.rejects(update(f), /does not match/); assert.equal(events.length, 0);
  }
  { const f = fixture(true); f.next.amount_received = 100; await assert.rejects(update(f), /held, charged/); assert.equal(events.length, 0); }
  { const f = fixture(true); cancelFailure = f.next.id; await assert.rejects(update(f), /cancellation failure/); assert(!events.some(e => e[0] === 'setup')); }
  { const f = fixture(true); badReceipt = true; await assert.rejects(update(f), /has not been released/); assert(!events.some(e => e[0] === 'setup')); }
  { const f = fixture(true); configurationActive = false; await assert.rejects(update(f), /configured reusable/); assert.equal(events.length, 0, 'Invalid card configuration must not retire authorisations'); }
  { const f = fixture(true); onSetup = () => { f.b.depositHoldRenewalIntentId = 'raced-renewal'; }; await assert.rejects(update(f), /security changed/); assert.equal(f.b.securityHoldRecoverySessionId, undefined); }
  { const f = fixture(true); await update(f); f.b.depositHoldRenewalIntentId = 'raced-renewal'; assert.equal(await finish(f), false); assert.equal(f.b.securityHoldPaymentMethodId, 'pm_old'); }
  { const f = fixture(true); await assert.rejects(holds.updatePickupCard.handler(ctx, { token: 'foreign', bookingId: f.b._id }), /access denied/); assert.equal(events.length, 0); }
  console.log('PASS actual card recovery/reset: linked and pending renewals retired with proven uncaptured receipts, setup-only recovery clears obsolete challenge state, preserves earlier releases, one-time generation and pending-intent races; malformed/foreign/held/processing/captured/configuration/cancel failures deny safely. Controlled Stripe; no provider writes.');
})().catch(e => { console.error(e); process.exitCode = 1; });
