const assert = require("node:assert/strict");
const { load, db, put, setMock } = require("./lib/rentalTestHarness.cjs");
const receipts = new Map();
let created = 0,
  refundListCalls = 0;
class Stripe {
  constructor() {
    this.paymentIntents = {
      retrieve: async () => ({ id: "pi_fixture", amount_received: 12000 }),
    };
    this.refunds = {
      list: () => ({
        async *[Symbol.asyncIterator]() {
          refundListCalls++;
          for (const r of receipts.values()) yield r;
        },
      }),
      create: async (args, { idempotencyKey }) => {
        if (receipts.has(idempotencyKey)) {
          const prior = receipts.get(idempotencyKey);
          assert.equal(
            prior.amount,
            args.amount,
            "retry uses original frozen amount",
          );
          return prior;
        }
        created++;
        const r = {
          id: "re_fixture",
          status: "succeeded",
          amount: args.amount,
        };
        receipts.set(idempotencyKey, r);
        return r;
      },
    };
  }
}
setMock("stripe", { default: Stripe });
process.env.STRIPE_SECRET_KEY = "sk_test_fixture";
process.env.ADMIN_TOKEN = "fixture-owner";
const bookings = load("convex/bookings.ts"),
  checkout = load("convex/checkout.ts");
put("accounts", { email: "cancellation@rental-test.invalid" });
const b = put("bookings", {
  status: "confirmed",
  guestEmail: "cancellation@rental-test.invalid",
  stripePaymentIntentId: "pi_fixture",
  total: 120,
  depositAmount: 20,
  currency: "GBP",
  lineItems: [
    {
      listingId: "fixture-listing",
      title: "Camera",
      qty: 1,
      lineTotal: 100,
      start: Date.UTC(2030, 10, 1),
      end: Date.UTC(2030, 10, 2),
    },
  ],
});
let failFinalize = true;
const ctx = {
  db,
  scheduler: { runAfter: async () => {} },
  runQuery: async (ref, args) => {
    if (ref === "bookings.getForCancel")
      return bookings.getForCancel.handler(ctx, args);
    throw Error(ref);
  },
  runMutation: async (ref, args) => {
    if (ref === "adminAuth.assertAdminInternal")
      return load("convex/adminAuth.ts").assertAdminInternal.handler(ctx, args);
    if (ref === "bookings._finalizeCancellation" && failFinalize) {
      failFinalize = false;
      throw Error("Simulated database outage after Stripe success");
    }
    if (ref.startsWith("bookings."))
      return bookings[ref.split(".")[1]].handler(ctx, args);
    throw Error(ref);
  },
};
(async () => {
  const args = {
    token: process.env.ADMIN_TOKEN,
    bookingId: b._id,
    reason: "Owner cancellation request",
  };
  await assert.rejects(
    checkout.cancelByAdmin.handler(ctx, args),
    /database outage/,
  );
  assert.equal(created, 1);
  assert.equal(b.status, "confirmed");
  assert.equal(b.cancellationDecision.quote.refundAmount, 120);
  await checkout.cancelByAdmin.handler(ctx, args);
  assert.equal(created, 1, "one provider refund across retry");
  assert.equal(
    refundListCalls,
    1,
    "retry does not reprice against already refunded balance",
  );
  assert.equal(b.status, "cancelled");
  assert.equal(b.refundAmount, 120);
  console.log(
    "PASS cancellation: Stripe succeeded/database failed; original quote reused; one cash refund; retry finalizes once.",
  );
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
