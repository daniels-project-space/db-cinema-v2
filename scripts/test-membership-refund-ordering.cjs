const assert = require('node:assert/strict');
const { load, db, put, tables, setMock } = require('./lib/rentalTestHarness.cjs');

process.env.STRIPE_SECRET_KEY = 'sk_test_fixture';
process.env.MEMBERSHIP_HISTORICAL_INVOICE_CREDIT_V1 = 'disabled';

const invoices = new Map();
const paymentIntents = new Map();
const invoiceByPayment = new Map();
const refundedByPayment = new Map();
const subscription = {
  id: 'sub_ordering',
  customer: 'cus_ordering',
  status: 'active',
  created: 1800000000,
  metadata: { accountEmail: 'ordering@example.invalid', membershipTier: 'pro' },
  items: { data: [{ id: 'si_ordering' }] },
};
const line = {
  id: 'il_ordering', amount: 1900, currency: 'gbp',
  parent: { type: 'subscription_item_details', subscription_item_details: { subscription: subscription.id, subscription_item: 'si_ordering', proration: false } },
  period: { start: 1800000000, end: 1802592000 }, discount_amounts: [],
};

class FixtureStripe {
  constructor() {
    this.paymentIntents = { retrieve: async id => paymentIntents.get(id) };
    this.refunds = { list: async function* ({ payment_intent: id }) { for (const refund of refundedByPayment.get(id) ?? []) yield refund; } };
    this.invoicePayments = { list: async ({ payment }) => ({ data: [{ invoice: invoiceByPayment.get(payment.payment_intent) }], has_more: false }) };
    this.invoices = {
      retrieve: async id => invoices.get(id),
      listLineItems: async function* () { yield line; },
    };
    this.subscriptions = { retrieve: async () => subscription };
    this.creditNotes = { list: async function* () {}, listLineItems: async function* () {} };
  }
}
setMock('stripe', { default: FixtureStripe });

const membership = load('convex/membershipBenefits.ts');
const checkout = load('convex/checkout.ts');
const account = put('accounts', {
  email: 'ordering@example.invalid', stripeCustomerId: subscription.customer,
  membershipTier: 'pro',
});
const ctx = {
  db,
  runQuery: async (ref, args) => {
    if (ref === 'accounts._byEmail') return args.email === account.email ? account : null;
    throw Error(`Unexpected query ${ref}`);
  },
  runMutation: async (ref, args) => {
    if (ref === 'membershipBenefits.grantPaidInvoice') return membership.grantPaidInvoice.handler(ctx, args);
    if (ref === 'membershipBenefits.revokeRefundedInvoice') return membership.revokeRefundedInvoice.handler(ctx, args);
    if (ref === 'membershipBenefits.syncSubscription') return membership.syncSubscription.handler(ctx, args);
    throw Error(`Unexpected mutation ${ref}`);
  },
};

function addPaidInvoice(key) {
  const invoiceId = `in_${key}`;
  const paymentId = `pi_${key}`;
  const invoice = {
    id: invoiceId, status: 'paid', amount_paid: 1900, billing_reason: 'subscription_cycle',
    currency: 'gbp', customer: subscription.customer,
    parent: { subscription_details: { subscription: subscription.id } },
  };
  invoices.set(invoiceId, invoice);
  paymentIntents.set(paymentId, { id: paymentId, amount_received: 1900, currency: 'gbp', customer: subscription.customer });
  invoiceByPayment.set(paymentId, invoiceId);
  refundedByPayment.set(paymentId, [{ id: `re_${key}`, status: 'succeeded', amount: 1900, currency: 'gbp', payment_intent: paymentId }]);
  return { invoice, paymentId, refund: { id: `re_${key}`, status: 'succeeded', payment_intent: paymentId } };
}

function assertFullyReversed(invoiceId, message) {
  const grant = tables.get('membership_credit_grants').find(row => row.invoiceId === invoiceId);
  assert(grant, 'the paid invoice still receives one accounting receipt');
  assert.equal(grant.membershipRefundedPence, grant.paidMembershipPence, message);
  assert.equal(grant.revokedPence, grant.earnedCreditPence, 'the refunded invoice cannot leave spendable plan credit');
  const credit = tables.get('credits').find(row => row.membershipInvoiceId === invoiceId);
  assert(credit);
  assert.equal(credit.remaining, 0);
  assert.equal(credit.status, 'spent');
}

(async () => {
  const refundFirst = addPaidInvoice('refund_first');
  await checkout.reconcileFullyRefundedMembership(ctx, refundFirst.refund);
  assert.equal(account.stripeSubscriptionId, subscription.id, 'a refund-first event links the Stripe-verified subscription to its matching unbound account');
  assertFullyReversed(refundFirst.invoice.id, 'a full refund delivered before invoice.paid is recorded atomically');
  await checkout.grantStripeMembershipInvoice(ctx, refundFirst.invoice, subscription);
  assertFullyReversed(refundFirst.invoice.id, 'a replayed invoice.paid cannot recreate refunded credit');

  const paidFirst = addPaidInvoice('paid_first');
  await checkout.grantStripeMembershipInvoice(ctx, paidFirst.invoice, subscription);
  const beforeRefund = tables.get('credits').find(row => row.membershipInvoiceId === paidFirst.invoice.id);
  assert(beforeRefund.remaining > 0, 'a successfully paid, not-yet-refunded invoice earns credit');
  await checkout.reconcileFullyRefundedMembership(ctx, paidFirst.refund);
  assertFullyReversed(paidFirst.invoice.id, 'a later full refund atomically reverses an existing grant');
  await checkout.reconcileFullyRefundedMembership(ctx, paidFirst.refund);
  await checkout.grantStripeMembershipInvoice(ctx, paidFirst.invoice, subscription);
  assertFullyReversed(paidFirst.invoice.id, 'refund and paid-invoice replays do not duplicate or restore credit');

  const wrongCustomerRefund = addPaidInvoice('wrong_customer_refund');
  account.stripeCustomerId = 'cus_wrong';
  await assert.rejects(
    checkout.reconcileFullyRefundedMembership(ctx, wrongCustomerRefund.refund),
    /Stripe membership customer does not match the account/,
    'refund-first reconciliation must not issue an invoice grant to an account whose Stripe customer link differs',
  );
  assert.equal(tables.get('membership_credit_grants').some(row => row.invoiceId === wrongCustomerRefund.invoice.id), false,
    'a mismatched customer cannot create a credit-grant ledger receipt');
  account.stripeCustomerId = subscription.customer;
  assert.equal(tables.get('membership_credit_grants').filter(row => row.invoiceId === refundFirst.invoice.id || row.invoiceId === paidFirst.invoice.id).length, 2);
  console.log('PASS membership refund ordering: paid/refund event order, invoice/refund replay and spendable-credit reversal; synthetic Stripe only.');
})().catch(error => { console.error(error); process.exitCode = 1; });
