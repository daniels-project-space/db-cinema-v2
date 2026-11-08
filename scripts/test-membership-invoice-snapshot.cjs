const assert = require('node:assert/strict');
const { load } = require('./lib/rentalTestHarness.cjs');
const { resolveMembershipInvoiceSnapshot } = load('convex/lib/membershipInvoiceSnapshot.ts');
const account = 'acct_synthetic';
const snapshots = [
  { priceId: 'price_1UNwydAldg6Xs5hHBfS00Jjg', stripeAccountId: account, livemode: true, tier: 'plus', bonusPercent: 10, termsVersion: '2026-10-membership-v9' },
  { priceId: 'price_1UNwyeAldg6Xs5hHvA5dQ4nG', stripeAccountId: account, livemode: true, tier: 'pro', bonusPercent: 20, termsVersion: '2026-10-membership-v9' },
  { priceId: 'price_1UNwyeAldg6Xs5hHaCT2A18g', stripeAccountId: account, livemode: true, tier: 'studio', bonusPercent: 30, termsVersion: '2026-10-membership-v9' },
];
const invoice = { status: 'paid', amount_paid: 11900, billing_reason: 'subscription_cycle', currency: 'gbp', livemode: true, customer: 'cus_synthetic', parent: { subscription_details: { subscription: 'sub_synthetic' } } };
const line = { amount: 1900, currency: 'gbp', parent: { type: 'subscription_item_details', subscription_item_details: { subscription: 'sub_synthetic', subscription_item: 'si_previous', proration: false } }, pricing: { price_details: { price: snapshots[0].priceId } }, period: { start: 1800000000, end: 1802592000 }, discount_amounts: [] };
const resolve = (bill = invoice, rows = [line], catalog = snapshots, connectedAccount = account) => resolveMembershipInvoiceSnapshot(bill, rows, 'sub_synthetic', 'cus_synthetic', connectedAccount, catalog);
const ready = resolve();
assert.equal(ready.state, 'ready');
assert.equal(ready.snapshot.tier, 'plus');
assert.equal(ready.earnedCreditPence, 2090, 'A delayed Starter invoice uses Starter terms rather than a current Studio tier');
assert.equal(resolve({ ...invoice, livemode: false }).reason, 'price_snapshot', 'Live prices never qualify in a test environment');
assert.equal(resolve(invoice, [line], snapshots, 'acct_other').reason, 'price_snapshot');
assert.equal(resolve({ ...invoice, customer: 'cus_other' }).reason, 'invoice_identity');
assert.equal(resolve({ ...invoice, parent: { subscription_details: { subscription: 'sub_other' } } }).reason, 'invoice_identity');
assert.equal(resolve(invoice, [{ ...line, parent: { ...line.parent, subscription_item_details: { ...line.parent.subscription_item_details, subscription: 'sub_other' } } }]).reason, 'line_identity');
assert.equal(resolve(invoice, [{ ...line, pricing: { price_details: { price: 'price_unrecognised' } } }]).reason, 'price_snapshot');
assert.equal(resolve(invoice, [line], [...snapshots, { ...snapshots[0], tier: 'studio' }]).reason, 'price_snapshot', 'Ambiguous immutable mappings cannot award credit');
assert.equal(resolve(invoice, [line, line]).reason, 'recurring_lines', 'Multiple positive subscription lines require review');
assert.equal(resolve(invoice, [{ ...line, discount_amounts: [{ amount: 100 }] }]).earnedCreditPence, 1980);
assert.equal(resolve(invoice, [{ ...line, discount_amounts: [{ amount: 1901 }] }]).reason, 'discount_invalid');
assert.equal(resolve({ ...invoice, status: 'open' }).state, 'not_applicable');
assert.equal(resolve({ ...invoice, amount_paid: 0 }).state, 'not_applicable');
console.log('PASS membership invoice snapshot: historical tier, exact price/account/mode, ownership, ambiguity, discounts and no-payment cases; no billing or customer writes.');
