const assert = require('node:assert/strict');
const { load, db, put, setMock } = require('./lib/rentalTestHarness.cjs');
const intents = new Map(), events = [];
class StripeFixture {
  paymentIntents = {
    retrieve: async id => intents.get(id),
    cancel: async id => { events.push(['cancel', id]); const intent = intents.get(id); intent.status = 'canceled'; return intent; },
  };
  webhooks = { constructEvent: (body, signature) => { assert.equal(signature, 'controlled-signature'); return JSON.parse(body); } };
}
setMock('stripe', { default: StripeFixture });
setMock('./lib/mailer', { sendMail: async () => true });
process.env.STRIPE_SECRET_KEY = 'sk_test_controlled';
process.env.STRIPE_WEBHOOK_SECRET = 'whsec_controlled';
const bookings = load('convex/bookings.ts'), holds = load('convex/holdRenewal.ts'), checkout = load('convex/checkout.ts'), accounts = load('convex/accounts.ts');
const modules = { bookings, holdRenewal: holds, accounts };
const mutationCtx = { db, scheduler: { runAfter: async (_, ref, args) => events.push(['job', ref, args]) } };
const ctx = {
  runQuery: async (ref, args) => { const [m, f] = ref.split('.'); return modules[m][f].handler({ db }, args); },
  runMutation: async (ref, args) => { events.push(['mutation', ref, args]); const [m, f] = ref.split('.'); return modules[m][f].handler(mutationCtx, args); },
  runAction: async (ref, args) => { const [m, f] = ref.split('.'); return modules[m][f].handler(ctx, args); },
};
const account = put('accounts', { email: 'owner@example.invalid' });
put('sessions', { token: 'owner', accountId: account._id, expiresAt: Date.now() + 3600000 });
function fixture(current = false) {
  const b = put('bookings', { accountId: account._id, guestEmail: account.email, status: 'confirmed', depositHoldAmount: 100, depositHoldStatus: current ? 'failed' : 'held', depositHoldExpiresAt: Date.now() + 3600000, depositHoldRenewalStatus: 'requires_action', lineItems: [], rmv2Revision: 1 });
  const old = { id: 'old-' + b._id, status: 'requires_capture', amount: 10000, amount_capturable: 10000, amount_received: 0, capture_method: 'manual', currency: 'gbp', customer: 'cus_owner', payment_method: 'pm_owner', metadata: { bookingId: b._id, purpose: 'pickup_security_hold' } };
  const next = { ...old, id: 'new-' + b._id, metadata: { bookingId: b._id, purpose: 'security_hold_renewal', replaces: old.id }, latest_charge: { payment_method_details: { card: { capture_before: (Date.now() + 7 * 86400000) / 1000 } } } };
  intents.set(old.id, old); intents.set(next.id, next);
  b.stripeDepositIntentId = current ? next.id : old.id;
  b.depositHoldRenewalIntentId = current ? undefined : next.id;
  return { b, old, next };
}
const deliver = f => checkout.stripeWebhook.handler(ctx, { body: JSON.stringify({ type: 'payment_intent.amount_capturable_updated', data: { object: f.next } }), sig: 'controlled-signature' });
(async () => {
  for (const flow of ['current-webhook', 'pending-webhook', 'pending-account']) {
    const current = flow === 'current-webhook';
    for (const amount of [0, 5000, 10001, undefined, NaN]) {
      const f = fixture(current); f.next.amount_capturable = amount;
      if (flow !== 'pending-account') await deliver(f); else await holds.sync.handler(ctx, { token: 'owner', bookingId: f.b._id });
      assert.equal(current ? f.b.depositHoldStatus : f.b.depositHoldRenewalStatus, 'failed', `A ${current ? 'current' : 'pending'} renewal with capturable ${amount} cannot count as a full hold`);
      assert.equal(f.old.status, 'requires_capture', 'The original hold must not be released for an incomplete replacement');
      assert.equal(f.b.stripeDepositIntentId, current ? f.next.id : f.old.id);
    }
    for (const expiry of [undefined, Date.now() / 1000 - 1, Infinity, NaN]) {
      const f = fixture(current); f.next.latest_charge.payment_method_details.card.capture_before = expiry;
      if (flow !== 'pending-account') await deliver(f); else await holds.sync.handler(ctx, { token: 'owner', bookingId: f.b._id });
      assert.equal(current ? f.b.depositHoldStatus : f.b.depositHoldRenewalStatus, 'failed', 'An unknown, expired or nonfinite hold cannot satisfy security');
      assert.equal(f.old.status, 'requires_capture');
    }
  }
  for (const current of [true, false]) {
    const f = fixture(current); f.next.amount_received = 100;
    const cancellations = events.filter(e => e[0] === 'cancel').length;
    if (current) { await deliver(f); assert.equal(f.b.depositHoldStatus, 'captured'); }
    else { await holds.sync.handler(ctx, { token: 'owner', bookingId: f.b._id }); assert.equal(f.b.depositHoldRenewalStatus, 'failed'); assert.equal(f.b.stripeDepositIntentId, f.old.id); }
    assert.equal(events.filter(e => e[0] === 'cancel').length, cancellations, 'Captured funds must not be cancelled or represented as an uncharged hold');
  }
  for (const current of [true, false]) {
    const f = fixture(current);
    if (current) { await deliver(f); assert.equal(f.b.depositHoldStatus, 'held'); assert.equal(f.b.rmv2Revision, 2); }
    else { const result = await holds.sync.handler(ctx, { token: 'owner', bookingId: f.b._id }); assert.equal(result.status, 'renewed'); assert.equal(f.b.stripeDepositIntentId, f.next.id); assert.equal(f.old.status, 'canceled'); }
  }
  for (const status of ['captured', 'released']) {
    const f = fixture(); f.b.depositHoldStatus = status;
    assert.equal(await bookings.replaceHold.handler(mutationCtx, { bookingId: f.b._id, oldIntentId: f.old.id, newIntentId: f.next.id, expiresAt: Date.now() + 86400000 }), false, 'A settled rental hold cannot be reopened by a delayed renewal');
    assert.equal(f.b.depositHoldStatus, status); assert.equal(f.b.rmv2Revision, 1);
  }
  for (const expiresAt of [Infinity, NaN, Date.now() - 1]) {
    const f = fixture(); assert.equal(await bookings.replaceHold.handler(mutationCtx, { bookingId: f.b._id, oldIntentId: f.old.id, newIntentId: f.next.id, expiresAt }), false);
  }
  console.log('PASS actual renewal actions/webhook/mutation: full capturable uncharged value and finite future expiry required; partial/missing/oversized/captured/expired evidence denied, original authorisation preserved, valid replacements and settled-state races checked. Controlled Stripe transport; no provider writes.');
})().catch(e => { console.error(e); process.exitCode = 1; });
