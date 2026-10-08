const assert = require('node:assert/strict');
const { load, db, put, setMock } = require('./lib/rentalTestHarness.cjs');
const refunds = new Map();
let creates = 0, approvalGets = 0, approvalState = 'pending_approval', transientGet = false;
class Stripe {
  constructor() {
    this.paymentIntents = { retrieve: async id => id === 'pi_hold' ? { id, status: 'canceled', amount_received: 0 } : { id, status: 'succeeded', amount_received: 4500 } };
    this.refunds = {
      list: ({ payment_intent }) => ({ async *[Symbol.asyncIterator]() { for (const r of refunds.values()) if (r.payment_intent === payment_intent) yield r; } }),
      retrieve: async id => { if (!refunds.has(id)) throw Error('Missing receipt'); return refunds.get(id); },
      create: async () => { creates++; throw { raw: { code: 'approval_required', message: 'Approval required: https://dashboard.stripe.com/settings/approvals/requests/apreq_fixture' } }; },
    };
  }
  async rawRequest(method, path, body, options) {
    approvalGets++; assert.equal(method, 'GET'); assert.equal(path, '/v2/core/approval_requests/apreq_fixture');
    assert.equal(options.apiVersion, '2026-08-26.preview');
    if (transientGet) throw Error('Provider read temporarily unavailable');
    return { id: 'apreq_fixture', object: 'v2.core.approval_request', action: 'refund.create', status: approvalState,
      dashboard_url: 'https://dashboard.stripe.com/acct_fixture/settings/approvals/requests/apreq_fixture?statuses[0]=pending_approval',
      status_details: approvalState === 'succeeded' ? { succeeded: { result: { id: 're_approved', object: 'refund' } } } : {} };
  }
}
setMock('stripe', { default: Stripe });
process.env.STRIPE_SECRET_KEY = 'sk_test_fixture'; process.env.ADMIN_TOKEN = 'fixture-owner';
const recovery = load('convex/cancellationRecovery.ts'), bookings = load('convex/bookings.ts'), checkout = load('convex/checkout.ts');
const helper = load('convex/lib/approvedRefund.ts');
const account = put('accounts', { email: 'changed@rental-test.invalid' });
const b = put('bookings', { accountId: account._id, status: 'confirmed', guestEmail: 'old@rental-test.invalid',
  stripePaymentIntentId: 'pi_main', stripeDepositIntentId: 'pi_hold', depositHoldStatus: 'held', depositHoldAmount: 100,
  total: 45, depositAmount: 25, currency: 'GBP', lineItems: [{ listingId: 'camera', title: 'Camera', qty: 1,
    lineTotal: 20, start: Date.UTC(2030, 10, 1), end: Date.UTC(2030, 10, 2) }] });
const stock = put('reservations', { bookingId: b._id, source: 'site', status: 'confirmed' });
put('sessions', { token: 'renter', accountId: account._id, expiresAt: Date.now() + 60000 });
const other = put('accounts', { email: 'old@rental-test.invalid' });
put('sessions', { token: 'other', accountId: other._id, expiresAt: Date.now() + 60000 });
const ctx = { db, scheduler: { runAfter: async () => {} },
  runQuery: async (ref, args) => {
    if (ref.startsWith('bookings.')) return bookings[ref.split('.')[1]].handler(ctx, args);
    if (ref.startsWith('cancellationRecovery.')) return recovery[ref.split('.')[1]].handler(ctx, args);
    throw Error(ref);
  },
  runMutation: async (ref, args) => {
    if (ref === 'adminAuth.assertAdminInternal') return load('convex/adminAuth.ts').assertAdminInternal.handler(ctx, args);
    if (ref.startsWith('bookings.')) return bookings[ref.split('.')[1]].handler(ctx, args);
    if (ref.startsWith('cancellationRecovery.')) return recovery[ref.split('.')[1]].handler(ctx, args);
    throw Error(ref);
  },
};
(async () => {
  const args = { token: process.env.ADMIN_TOKEN, bookingId: b._id, reason: 'Explicit owner cancellation' };
  transientGet = true;
  await assert.rejects(checkout.cancelByAdmin.handler(ctx, args), /temporarily unavailable/);
  let job = await db.query('rental_cancellations').withIndex('by_booking', q => q.eq('bookingId', b._id)).unique();
  assert.equal(job.receipts[0].approvalRequestId, 'apreq_fixture', 'approval ID survives a failed approval GET');
  assert.equal(b.status, 'confirmed'); assert.equal(stock.status, 'confirmed'); assert.equal(creates, 1);
  transientGet = false;
  await assert.rejects(checkout.cancelByAdmin.handler(ctx, args), e => e.data?.code === 'CANCELLATION_PENDING');
  assert.equal(creates, 1, 'approval polling never POSTs a second refund');
  assert.equal(job.accountId, account._id, 'cancellation stays tethered to canonical account after email changes');
  assert.equal((await recovery.ownerStatus.handler(ctx, args)).refunds[0].approvalUrl, 'https://dashboard.stripe.com/acct_fixture/settings/approvals/requests/apreq_fixture');
  assert.deepEqual(await recovery.renterStatus.handler(ctx, { token: 'renter', bookingId: b._id }), { status: 'processing' });
  await assert.rejects(recovery.ownerStatus.handler(ctx, { token: 'renter', bookingId: b._id }), /unauthorized/);
  await assert.rejects(recovery.renterStatus.handler(ctx, { token: 'other', bookingId: b._id }), /not available/);
  await assert.rejects(bookings._finalizeCancellation.handler(ctx, { bookingId: b._id, accountId: account._id,
    mode: 'refund', refundAmount: 45, creditAmount: 0, currency: 'GBP' }), /incomplete/);
  // Human approval executes Stripe's refund. Its original idempotent POST still errors forever.
  approvalState = 'succeeded'; refunds.set('re_approved', { id: 're_approved', object: 'refund', status: 'pending',
    amount: 4500, currency: 'gbp', payment_intent: 'pi_main' });
  job.retryAt = Date.now() - 1;
  await checkout.reconcileCancellations.handler(ctx, {});
  assert.equal(b.status, 'confirmed', 'pending bank refund cannot be called refunded/cancelled');
  assert.equal(job.receipts[0].stripeRefundId, 're_approved');
  refunds.get('re_approved').status = 'succeeded'; job.retryAt = Date.now() - 1;
  await checkout.reconcileCancellations.handler(ctx, {});
  assert.equal(b.status, 'cancelled'); assert.equal(stock.status, 'cancelled'); assert.equal(b.refundAmount, 45);
  assert.equal(b.depositHoldStatus, 'released', 'an already-canceled Stripe hold reconciles locally');
  assert.equal(job.status, 'succeeded'); assert.equal(job.retryAt, undefined); assert.equal(creates, 1);
  const reads = approvalGets; await checkout.reconcileCancellations.handler(ctx, {}); assert.equal(approvalGets, reads);

  const receipt = { paymentIntentId: 'pi_main', amountPence: 4500, attemptedAt: Date.now(), status: 'unknown' };
  const sb = new Stripe(), base = { currency: 'GBP', idempotencyKey: 'fixture', now: Date.now(), persist: async () => {} };
  for (const patch of [{ payment_intent: 'pi_else' }, { amount: 4501 }, { currency: 'usd' }, { id: 'not_a_refund' }]) {
    const original = refunds.get('re_approved'); refunds.set('re_approved', { ...original, ...patch });
    await assert.rejects(helper.recoverApprovedRefund(sb, { ...receipt, approvalRequestId: 'apreq_fixture' }, base), /does not match/);
    refunds.set('re_approved', original);
  }
  const validRaw = sb.rawRequest.bind(sb);
  for (const patch of [{ id: 'apreq_else' }, { action: 'payment_intent.create' }, { object: 'wrong' }, { status_details: {} }]) {
    sb.rawRequest = async (...args) => ({ ...await validRaw(...args), ...patch });
    await assert.rejects(helper.recoverApprovedRefund(sb, { ...receipt, approvalRequestId: 'apreq_fixture' }, base), /match|valid refund/);
  }
  sb.rawRequest = validRaw;
  for (const status of ['rejected', 'expired', 'failed', 'canceled']) {
    approvalState = status;
    assert.equal((await helper.recoverApprovedRefund(sb, { ...receipt, approvalRequestId: 'apreq_fixture' }, base)).status, 'failed');
  }
  const priorCreates = creates;
  await assert.rejects(helper.recoverApprovedRefund(sb, { ...receipt, attemptedAt: Date.now() - 24 * 3600000 }, base), /older Stripe refund/);
  assert.equal(creates, priorCreates, 'an expired idempotency request is not recreated');
  refunds.set('re_meta', { id: 're_meta', status: 'succeeded', amount: 4500, currency: 'gbp', payment_intent: 'pi_main', metadata: { rentalCancellationId: 'job' } });
  assert.equal((await helper.recoverApprovedRefund(sb, { ...receipt, attemptedAt: Date.now() - 24 * 3600000 }, { ...base, metadata: { rentalCancellationId: 'job' } })).stripeRefundId, 're_meta');
  assert.equal(creates, priorCreates, 'a matching durable metadata receipt is recovered without POST');
  refunds.set('re_duplicate', { ...refunds.get('re_meta'), id: 're_duplicate' });
  await assert.rejects(helper.recoverApprovedRefund(sb, receipt, { ...base, metadata: { rentalCancellationId: 'job' } }), /Multiple Stripe receipts/);
  const leased = put('bookings', { status: 'confirmed', cancellationDecision: { kind: 'full_refund', createdAt: Date.now(),
    quote: { mode: 'refund', refundAmount: 45, creditAmount: 0, paymentIntentId: 'pi_main', allocations: [{ paymentIntentId: 'pi_main', amountPence: 4500 }] } } });
  const first = await recovery.claim.handler(ctx, { bookingId: leased._id, legacy: false });
  assert.equal(await recovery.claim.handler(ctx, { bookingId: leased._id, legacy: false }), null, 'simultaneous requests cannot obtain two leases');
  first.leaseUntil = 0; const oldGeneration = first.generation;
  const second = await recovery.claim.handler(ctx, { bookingId: leased._id, legacy: false });
  await assert.rejects(recovery.receipt.handler(ctx, { id: first._id, generation: oldGeneration, receipt: { ...first.receipts[0], status: 'pending' } }), /binding changed/);
  await recovery.finishAttempt.handler(ctx, { id: first._id, generation: oldGeneration, complete: false });
  assert(second.leaseUntil > Date.now(), 'stale completion cannot release a newer lease');
  await assert.rejects(bookings._finalizeCancellation.handler(ctx, { bookingId: b._id, accountId: account._id,
    mode: 'refund', refundAmount: 450, creditAmount: 0, currency: 'GBP' }), /frozen cancellation/);
  const captured = put('bookings', { accountId: account._id, guestEmail: account.email, status: 'confirmed',
    stripeDepositIntentId: 'pi_captured_security', depositHoldAmount: 100, depositHoldStatus: 'held', total: 0,
    depositAmount: 0, currency: 'GBP', lineItems: b.lineItems });
  await assert.rejects(checkout.cancelByAdmin.handler(ctx, { ...args, bookingId: captured._id }), /captured charge/);
  const capturedJob = await db.query('rental_cancellations').withIndex('by_booking', q => q.eq('bookingId', captured._id)).unique();
  assert.equal(capturedJob.status, 'attention'); assert.equal(capturedJob.retryAt, undefined);
  assert.equal(captured.status, 'confirmed', 'captured security cannot be mislabelled as a released hold');
  console.log('PASS approved cancellation: persisted approval, cached-error recovery, pending/succeeded bank truth, exact receipt binding, canonical ownership, private status, no duplicate money.');
})().catch(e => { console.error(e); process.exitCode = 1; });
