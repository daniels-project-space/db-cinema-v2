const assert = require("node:assert/strict");
const { load, db, put, setMock } = require("./lib/rentalTestHarness.cjs");
const policy = load("shared/rentalSecurity.ts");
const refunds = new Map();
const intents = new Map();
const refundCalls = [];
class StripeFixture {
  refunds = {
    retrieve: async (id) => [...refunds.values()].find((row) => row.id === id),
    list: (args) => ({ [Symbol.asyncIterator]: async function* () { for (const row of refunds.values()) if (row.payment_intent === args.payment_intent) yield row; } }),
    create: async (args, options) => {
      refundCalls.push({ args, options });
      let row = refunds.get(options.idempotencyKey);
      if (!row) {
        row = { ...args, id: `re_fixture_${refunds.size}`, status: "succeeded", currency: "gbp" };
        refunds.set(options.idempotencyKey, row);
      }
      return row;
    },
  };
  paymentIntents = {
    retrieve: async (id) => intents.get(id),
    cancel: async (id) => {
      const intent = intents.get(id);
      intent.status = "canceled";
      intent.amount_capturable = 0;
      return intent;
    },
  };
}
setMock("stripe", { default: StripeFixture });
process.env.STRIPE_SECRET_KEY = "sk_test_fixture";
process.env.ADMIN_TOKEN = "return-release-fixture";
const checkout = load("convex/checkout.ts");
const bookings = load("convex/bookings.ts");
const admin = load("convex/adminAuth.ts");
const inspections = load("convex/returnInspections.ts");
const cards = load("convex/savedCardState.ts");
const scheduled = [];
const now = Date.now();
const date = new Date(now);
const today = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
const ctx = {
  db,
  scheduler: { runAfter: async (...args) => scheduled.push(args) },
  runQuery: async (ref, args) => {
    if (ref === "bookings.getForRefund") return bookings.getForRefund.handler(ctx, args);
    if (ref === "returnInspections.validate") return inspections.validate.handler(ctx, args);
    throw Error(`Unexpected query ${ref}`);
  },
  runMutation: async (ref, args) => {
    if (ref === "adminAuth.assertAdminInternal") return admin.assertAdminInternal.handler(ctx, args);
    if (ref === "savedCardState.markReturn") return cards.markReturn.handler(ctx, args);
    if (!ref.startsWith("bookings.")) throw Error(`Unexpected mutation ${ref}`);
    return bookings[ref.split(".")[1]].handler(ctx, args);
  },
};
function rental(deposit = 50) {
  return put("bookings", {
    status: "active", guestEmail: "return@example.invalid", guestName: "Return fixture", fulfilment: "pickup",
    lineItems: [{ listingId: "camera", title: "Camera", qty: 1, start: today - 86400000, end: today - 86400000, lineTotal: 100, dailyRate: 100 }],
    subtotal: 100, total: 100 + deposit, depositAmount: deposit, depositHoldAmount: 0,
    stripePaymentIntentId: `pi_fixture_${Math.random()}`, securityPolicyVersion: policy.REFUNDABLE_DEPOSIT_POLICY_VERSION,
    savedCardStatus: "saved", savedCardLimit: 100, replacementValues: [{ listingId: "camera", unitPence: 100000 }],
    pickedUpAt: now - 86400000, returnTime: "20:00",
  });
}
function selection(booking, chargeLate = false, lateClaimReason) {
  return {
    token: process.env.ADMIN_TOKEN, bookingId: booking._id, actualReturnedAt: now,
    damageKept: 0, ...(policy.hasCashDepositPolicy(booking.securityPolicyVersion) ? { depositKept: 0 } : {}), chargeLate, lateClaimReason,
    inspection: [{ key: "legacy:0:0", condition: "good", details: "", openCase: false }],
  };
}
(async () => {
  const noClaim = rental();
  const result = await checkout.markReturned.handler(ctx, selection(noClaim));
  assert.equal(result.lateAmount, 0);
  assert.equal(noClaim.lateFeeAmount, 0);
  assert.equal(noClaim.lateFeeWaivedAmount, undefined);
  assert.equal(noClaim.returnDecision.lateClaimPolicyVersion, "owner-claim-v1");
  assert.equal(noClaim.depositRefundAmount, 50);
  assert.equal(noClaim.returnStatement.lateAssessed, 0);
  assert.equal(noClaim.returnStatement.lateWaived, 0);

  const missingReason = rental();
  const callsBeforeMissingReason = refundCalls.length;
  await assert.rejects(checkout.markReturned.handler(ctx, selection(missingReason, true)), /reason for claiming/);
  assert.equal(missingReason.returnDecision, undefined);
  assert.equal(refundCalls.length, callsBeforeMissingReason);

  const claimed = rental();
  await checkout.markReturned.handler(ctx, selection(claimed, true, "Owner claim for equipment returned after the agreed time."));
  assert.equal(claimed.lateFeeAmount, 100);
  assert.equal(claimed.lateFeeClaimReason, "Owner claim for equipment returned after the agreed time.");
  assert.equal(claimed.returnStatement.lateClaimReason, claimed.lateFeeClaimReason);

  const held = rental(0);
  held.securityPolicyVersion = "security-hold-v2";
  held.depositHoldAmount = 50;
  held.stripeDepositIntentId = "pi_active_hold";
  held.depositHoldStatus = "held";
  held.depositHoldExpiresAt = now + 86400000;
  held.stripePaymentIntentId = undefined;
  held.paymentSources = [];
  intents.set("pi_active_hold", { id: "pi_active_hold", status: "requires_capture", amount_capturable: 5000, amount_received: 0 });
  await checkout.markReturned.handler(ctx, selection(held));
  assert.equal(intents.get("pi_active_hold").status, "canceled");
  assert.equal(held.depositHoldStatus, "released");
  assert.equal(held.lateFeeAmount, 0);
  console.log("PASS return settlement: unclaimed late amount stays zero, cash deposit returns in full, reason is required for a late claim, claim reason is recorded, and an unused active hold is released.");
})().catch((error) => { console.error(error); process.exitCode = 1; });
