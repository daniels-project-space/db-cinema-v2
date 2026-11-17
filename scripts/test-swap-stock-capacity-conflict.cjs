const assert = require('node:assert/strict');
const { load, setMock } = require('./lib/rentalTestHarness.cjs');

process.env.STRIPE_SECRET_KEY = 'sk_test_capacity_conflict_fixture';
const paymentId = 'pi_capacity_conflict_fixture';
const sessionId = 'cs_capacity_conflict_fixture';
const swapId = 'swap-capacity-conflict-fixture';
const swap = {
  _id: swapId,
  bookingId: 'booking-capacity-conflict-fixture',
  status: 'awaiting_payment',
  acceptedAt: Date.now() - 1000,
  sessionId,
  quote: { deltaPence: 500 },
  compensationStartedAt: undefined,
};
const session = {
  id: sessionId,
  status: 'complete',
  payment_status: 'paid',
  currency: 'gbp',
  amount_total: 500,
  payment_intent: paymentId,
  url: 'https://example.invalid/fixture',
  metadata: { itemSwapId: swapId },
};
let refundReceipt;
const events = [];

setMock('stripe', { default: class {
  constructor() {
    this.checkout = { sessions: { retrieve: async id => { assert.equal(id, sessionId); return session; } } };
    this.paymentIntents = { retrieve: async id => {
      assert.equal(id, paymentId);
      return { id, status: 'succeeded', currency: 'gbp', amount_received: 500, metadata: { itemSwapId: swapId } };
    } };
  }
} });
setMock('./lib/approvedRefund', {
  RefundReviewRequired: class RefundReviewRequired extends Error {},
  recoverApprovedRefund: async (_stripe, initial, options) => {
    const receipt = { ...initial, stripeRefundId: 're_capacity_conflict_fixture', approvalRequestId: 'approval_capacity_conflict_fixture', status: 'awaiting_approval' };
    await options.persist(receipt);
    refundReceipt = receipt;
    return receipt;
  },
});

const payments = load('convex/rentalSwapPayments.ts');
const ctx = {
  runQuery: async (ref, args) => {
    events.push(`query:${ref}`);
    if (ref === 'rentalSwapState.context') return { swap, booking: { _id: swap.bookingId } };
    if (ref === 'swapStockOperations.read') return {
      state: 'confirmed',
      request: { operation: 'beginExecution', args: { id: 'manager-claim-fixture', fingerprint: 'fingerprint-fixture', executionKey: `swap_execution_${swapId}` } },
    };
    throw Error(`Unexpected query ${ref}`);
  },
  runMutation: async (ref, args) => {
    events.push(`mutation:${ref}`);
    if (ref === 'rentalSwapState.bindSession') {
      assert.equal(args.id, swapId);
      assert.equal(args.sessionId, sessionId);
      assert.equal(args.paymentIntentId, paymentId);
      swap.sessionId = args.sessionId;
      swap.paymentIntentId = args.paymentIntentId;
      return;
    }
    if (ref === 'swapStockOperations.prepareSwapClaim') return 'claim-operation-fixture';
    if (ref === 'swapStockOperations.prepare') return 'execution-operation-fixture';
    if (ref === 'rentalSwapState.beginCompensation') {
      assert.equal(args.paymentIntentId, paymentId);
      assert.equal(args.amountPence, 500);
      swap.status = 'refund_compensating';
      swap.compensationStartedAt = Date.now();
      swap.paymentIntentId = paymentId;
      return { compensating: true };
    }
    if (ref === 'rentalSwapState.recordCompensation') { swap.compensationReceipt = args.receipt; return; }
    if (ref === 'rentalSwapState.notifyApproval') return;
    throw Error(`Unexpected mutation ${ref}`);
  },
  runAction: async (ref, args) => {
    events.push(`action:${ref}`);
    if (ref === 'swapStockOperations.recover') return { status: 'confirmed' };
    if (ref === 'sharedStockBridge.send') return { status: 'capacity_conflict' };
    throw Error(`Unexpected action ${ref}`);
  },
};

(async () => {
  const result = await payments.finalize.handler(ctx, { sessionId });
  assert.equal(result.paid, true);
  assert.equal(result.swapStatus, 'pending');
  assert.equal(swap.status, 'refund_compensating');
  assert.equal(swap.compensationReceipt.status, 'awaiting_approval');
  assert.equal(refundReceipt.status, 'awaiting_approval');
  assert(events.includes('mutation:rentalSwapState.beginCompensation'), 'a deterministic stock conflict enters the idempotent refund path');
  assert(!events.includes('mutation:rentalSwapState.recordPaidStockReview'), 'a known capacity conflict is not left as an unexplained paid-stock review');
  console.log('PASS paid swap capacity conflict: no equipment change is applied; original payment enters existing Stripe refund approval/recovery. Synthetic only.');
})().catch(error => { console.error(error); process.exitCode = 1; });
