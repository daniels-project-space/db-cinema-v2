const assert = require('node:assert/strict');
const { load, put, tables, setMock } = require('./lib/rentalTestHarness.cjs');

process.env.STRIPE_SECRET_KEY = 'sk_test_fixture';
process.env.STRIPE_WEBHOOK_SECRET = 'whsec_fixture';
process.env.MEMBERSHIP_HISTORICAL_INVOICE_CREDIT_V1 = 'disabled';

const account = put('accounts', {
  email: 'recurring@example.invalid',
  stripeCustomerId: 'cus_recurring',
  stripeSubscriptionId: 'sub_recurring',
  membershipTier: 'pro',
});
const subscription = {
  id: 'sub_recurring',
  customer: account.stripeCustomerId,
  status: 'active',
  created: Math.floor(Date.now() / 1000),
  cancel_at_period_end: false,
  metadata: { accountEmail: account.email, membershipTier: 'pro' },
  items: { data: [{ id: 'si_recurring' }] },
};
let event;
let invoice;
const line = {
  id: 'il_recurring', amount: 4900, currency: 'gbp', discount_amounts: [],
  parent: { type: 'subscription_item_details', subscription_item_details: {
    subscription: subscription.id, subscription_item: 'si_recurring', proration: false,
  } },
  period: { start: Math.floor(Date.now() / 1000), end: Math.floor((Date.now() + 30 * 86400000) / 1000) },
};

class FixtureStripe {
  constructor() {
    this.webhooks = { constructEvent: () => event };
    this.subscriptions = { retrieve: async id => {
      assert.equal(id, subscription.id, 'invoice webhook retrieves the subscription named in Invoice.parent');
      return subscription;
    } };
    this.invoices = {
      retrieve: async id => {
        assert.equal(id, invoice.id);
        return invoice;
      },
      listLineItems: async function* () { yield line; },
    };
    this.creditNotes = { list: async function* () {} };
  }
}
setMock('stripe', { default: FixtureStripe });

const membership = load('convex/membershipBenefits.ts');
const checkout = load('convex/checkout.ts');
const ctx = {
  db: require('./lib/rentalTestHarness.cjs').db,
  runQuery: async (ref, args) => {
    if (ref === 'accounts._byEmail') return args.email === account.email ? account : null;
    throw Error(`Unexpected query ${ref}`);
  },
  runMutation: async (ref, args) => {
    if (ref === 'membershipBenefits.syncSubscription') return membership.syncSubscription.handler(ctx, args);
    if (ref === 'membershipBenefits.grantPaidInvoice') return membership.grantPaidInvoice.handler(ctx, args);
    throw Error(`Unexpected mutation ${ref}`);
  },
};

function setInvoice(id, overrides = {}) {
  invoice = {
    id, status: 'paid', amount_paid: 4900, billing_reason: 'subscription_cycle',
    currency: 'gbp', customer: account.stripeCustomerId,
    parent: { subscription_details: { subscription: subscription.id } },
    ...overrides,
  };
  event = { id: `evt_${id}`, type: 'invoice.paid', data: { object: { id } } };
}

(async () => {
  setInvoice('in_recurring_1');
  assert.equal(await checkout.stripeWebhook.handler(ctx, { body: 'fixture', sig: 'fixture' }), true);
  assert.equal(tables.get('membership_credit_grants').length, 1, 'invoice.paid grants a recurring credit through the real webhook handler');
  assert.equal(tables.get('credits').filter(row => row.membershipInvoiceId === invoice.id).length, 1);
  assert.equal(tables.get('credits').find(row => row.membershipInvoiceId === invoice.id).amount, 58.8);

  assert.equal(await checkout.stripeWebhook.handler(ctx, { body: 'fixture', sig: 'fixture' }), true);
  assert.equal(tables.get('membership_credit_grants').length, 1, 'duplicate invoice.paid delivery reuses the invoice receipt');
  assert.equal(tables.get('credits').filter(row => row.membershipInvoiceId === invoice.id).length, 1, 'duplicate delivery cannot mint a second monthly credit');

  setInvoice('in_wrong_customer', { customer: 'cus_other' });
  await checkout.stripeWebhook.handler(ctx, { body: 'fixture', sig: 'fixture' });
  assert.equal(tables.get('membership_credit_grants').length, 1, 'wrong-customer invoice fails closed');

  const existingCreditCount = tables.get('credits').length;
  setInvoice('in_failed', { status: 'open', amount_paid: 0 });
  event = { id: 'evt_invoice_failed', type: 'invoice.payment_failed', data: { object: { id: invoice.id } } };
  await checkout.stripeWebhook.handler(ctx, { body: 'fixture', sig: 'fixture' });
  assert.equal(tables.get('membership_credit_grants').length, 1, 'failed invoice cannot create a grant');
  assert.equal(tables.get('credits').length, existingCreditCount, 'failed invoice cannot create spendable credit');

  setInvoice('in_one_off', { billing_reason: 'manual', parent: undefined });
  await checkout.stripeWebhook.handler(ctx, { body: 'fixture', sig: 'fixture' });
  assert.equal(tables.get('membership_credit_grants').length, 1, 'one-off invoice without a subscription parent cannot create a grant');

  console.log('PASS recurring membership webhook: paid invoice, duplicate delivery, failed invoice, wrong customer and one-off invoice; synthetic Stripe only.');
})().catch(error => { console.error(error); process.exitCode = 1; });
