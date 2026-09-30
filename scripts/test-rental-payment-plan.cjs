const assert = require("node:assert/strict");
const { load } = require("./lib/rentalTestHarness.cjs");
const plan = load("convex/lib/rentalPaymentPlan.ts");
const payments = [
  {
    paymentIntentId: "pi_original",
    availablePence: 12000,
    securityPence: 2000,
  },
  { paymentIntentId: "pi_addition", availablePence: 7500, securityPence: 2500 },
];
assert.deepEqual(plan.rentalRefundPlan(payments, 13000), [
  { paymentIntentId: "pi_original", amountPence: 10000 },
  { paymentIntentId: "pi_addition", amountPence: 3000 },
]);
assert.throws(
  () => plan.rentalRefundPlan(payments, 15001),
  /available rental payment/,
);
assert.deepEqual(plan.cancellationPaymentPlan("store_credit", payments, 3000), {
  allocations: [
    { paymentIntentId: "pi_original", amountPence: 2000 },
    { paymentIntentId: "pi_addition", amountPence: 2500 },
  ],
  refundPence: 4500,
  creditPence: 18000,
});
assert.equal(
  plan.cancellationPaymentPlan("full_refund", payments, 3000).refundPence,
  19500,
);
assert.deepEqual(plan.securityReturnPlan(payments, 3000), [
  { paymentIntentId: "pi_original", amountPence: 2000 },
  { paymentIntentId: "pi_addition", amountPence: 1000 },
]);
assert.throws(
  () => plan.securityReturnPlan(payments, 4501),
  /exceeds captured/,
);
assert.throws(
  () => plan.rentalRefundPlan([...payments, payments[0]], 1),
  /Invalid rental payment/,
);
for (let i = 0; i < 100; i++) {
  const rows = Array.from({ length: 3 }, (_, j) => ({
    paymentIntentId: `pi_${j}`,
    availablePence: 1000 + i * 11 + j * 103,
    securityPence: j * 50,
  }));
  const total = rows.reduce((n, p) => n + p.availablePence, 0);
  const r = plan.cancellationPaymentPlan("store_credit", rows, 0);
  assert.equal(r.refundPence + r.creditPence, total);
  assert.ok(
    r.allocations.every(
      (p) =>
        p.amountPence <=
        rows.find((x) => x.paymentIntentId === p.paymentIntentId)
          .availablePence,
    ),
  );
}
console.log(
  "PASS split rental payments: cash/credit conservation; full and partial rental refunds preserve security; multi-payment security returns; invalid/duplicate sources and excess amounts rejected.",
);
