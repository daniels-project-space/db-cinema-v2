const assert = require("node:assert/strict");
const { load, setMock } = require("./lib/rentalTestHarness.cjs");
const calls = [];
let currentSession, currentRefund, refundPartStatus = "succeeded";
setMock("stripe", { default: class {
  webhooks = { constructEvent: (body, signature) => { if (signature !== "fixture-signature") throw Error("bad signature"); return JSON.parse(body); } };
  checkout = { sessions: { retrieve: async () => currentSession } };
  refunds = { retrieve: async () => currentRefund };
} });
process.env.STRIPE_SECRET_KEY = "sk_test_fixture";
process.env.STRIPE_WEBHOOK_SECRET = "whsec_fixture";
const checkout = load("convex/checkout.ts");
const ctx = {
  runAction: async (ref, args) => { calls.push({ ref, args }); return { bookingId: "bookings-fixture", paid: true, swapStatus: "applied" }; },
  runQuery: async (ref, args) => { calls.push({ ref, args }); return { _id: "rental_refunds-fixture", bookingId: "bookings-fixture", requestId: "swap-rental_item_swaps-fixture", createdAt: 100, allocations: [{ paymentIntentId: "pi_fixture", amountPence: 500 }], refundReceipts: [{ paymentIntentId: "pi_fixture", amountPence: 500, attemptedAt: 100, status: "pending" }] }; },
  runMutation: async (ref, args) => { calls.push({ ref, args }); return ref === "rentalOperations.recordRefundPart" ? { status: refundPartStatus } : ref === "rentalSwapState.asyncPaymentFailed" ? { recorded: true } : undefined; },
  scheduler: { runAfter: async (delay, ref, args) => { calls.push({ ref, args, delay }); } },
};
const deliver = (type, session, signature = "fixture-signature") => checkout.stripeWebhook.handler(ctx, { body: JSON.stringify({ type, data: { object: session } }), sig: signature });

(async () => {
  currentSession = { id: "cs_fixture", status: "complete", payment_status: "paid", amount_total: 1200, currency: "gbp", metadata: { itemSwapId: "rental_item_swaps-fixture" } };
  assert.equal(await deliver("checkout.session.completed", currentSession, "invalid"), false);
  assert.equal(calls.length, 0);
  assert.equal(await deliver("checkout.session.completed", currentSession), true);
  assert.deepEqual(calls.pop(), { ref: "rentalSwapPayments.finalize", args: { sessionId: "cs_fixture" } });
  assert.equal(await deliver("checkout.session.async_payment_succeeded", currentSession), true);
  assert.deepEqual(calls.pop(), { ref: "rentalSwapPayments.finalize", args: { sessionId: "cs_fixture" } });
  await deliver("checkout.session.completed", { ...currentSession, payment_status: "unpaid" });
  assert.equal(calls.length, 0, "an unpaid event cannot apply the equipment change");
  await deliver("checkout.session.async_payment_failed", { ...currentSession, payment_status: "unpaid" });
  assert.deepEqual(calls.splice(-2), [
    { ref: "rentalSwapState.asyncPaymentFailed", args: { id: "rental_item_swaps-fixture", sessionId: "cs_fixture", amountPence: 1200, currency: "gbp" } },
    { ref: "rentalSwapPayments.reconcileAsyncPaymentFailure", args: { id: "rental_item_swaps-fixture" } },
  ], "an asynchronous payment failure triggers a server-side Stripe recheck before stock can be released");
  const result = await checkout.finalize.handler(ctx, { sessionId: "cs_fixture" });
  assert.equal(result.swapStatus, "applied");
  assert.deepEqual(calls.pop(), { ref: "rentalSwapPayments.finalize", args: { sessionId: "cs_fixture" } });
  currentRefund = { id: "re_fixture", payment_intent: "pi_fixture", amount: 500, currency: "gbp", status: "succeeded", metadata: { rentalRefundId: "rental_refunds-fixture", rentalPaymentIntent: "pi_fixture", bookingId: "bookings-fixture" } };
  refundPartStatus = "succeeded";
  assert.deepEqual(await checkout.reconcileRentalRefund.handler(ctx, { refundId: currentRefund.id }), { status: "succeeded" });
  assert.deepEqual(calls.pop(), { ref: "rentalSwapPayments.reconcileRefundWebhook", args: { id: "rental_item_swaps-fixture" }, delay: 0 }, "A settled swap refund schedules immediate stock and booking reconciliation");
  currentRefund = { ...currentRefund, status: "pending" };
  refundPartStatus = "pending";
  assert.deepEqual(await checkout.reconcileRentalRefund.handler(ctx, { refundId: currentRefund.id }), { status: "pending" });
  assert.equal(calls.some(call => call.ref === "rentalSwapPayments.reconcileRefundWebhook"), false, "A pending refund cannot trigger swap application");
  console.log("PASS equipment payment routing: signature, paid events, asynchronous failure and success-page recovery.");
})().catch(error => { console.error(error); process.exitCode = 1; });
