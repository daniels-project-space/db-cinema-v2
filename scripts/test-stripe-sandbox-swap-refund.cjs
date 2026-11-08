const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const Stripe = require("stripe");
const { load } = require("./lib/rentalTestHarness.cjs");
const { recoverApprovedRefund } = load("convex/lib/approvedRefund.ts");
const { remainingRentalPayment } = load("convex/lib/rentalStripeBalance.ts");

(async () => {
  const key = process.env.STRIPE_TEST_SECRET_KEY;
  if (!/^(sk|rk)_test_/.test(key ?? "")) throw Error("A Stripe test-mode secret or restricted key is required; no live key is accepted.");
  const stripe = new Stripe(key);
  const fixture = randomUUID();
  const payment = await stripe.paymentIntents.create({
    amount: 1000, currency: "gbp", payment_method: "pm_card_visa", confirm: true,
    automatic_payment_methods: { enabled: true, allow_redirects: "never" },
    metadata: { fixture: "dbc_swap_refund_test", run: fixture },
  }, { idempotencyKey: `dbc-swap-fixture-payment-${fixture}` });
  assert.equal(payment.livemode, false);
  assert.equal(payment.status, "succeeded");
  assert.equal(await remainingRentalPayment(stripe, payment, 1000), 1000);
  const initial = { paymentIntentId: payment.id, amountPence: 400, attemptedAt: Date.now(), status: "unknown" };
  const options = { currency: "GBP", now: Date.now(), maxRefunds: 100, idempotencyKey: `dbc-swap-fixture-refund-${fixture}`, metadata: { fixture: "dbc_swap_refund_test", run: fixture }, persist: async () => {} };
  const receipt = await recoverApprovedRefund(stripe, initial, options);
  assert.equal(receipt.status, "succeeded");
  const replay = await recoverApprovedRefund(stripe, initial, options);
  assert.equal(replay.stripeRefundId, receipt.stripeRefundId, "ambiguous retry must recover the existing test refund");
  assert.equal((await stripe.refunds.list({ payment_intent: payment.id })).data.length, 1);
  assert.equal(await remainingRentalPayment(stripe, payment, 1000), 600);
  console.log("PASS Stripe test mode: partial refund, provider receipt recovery and remaining rental balance; no live funds or customer data.");
})().catch(error => { console.error(error.message); process.exitCode = 1; });
