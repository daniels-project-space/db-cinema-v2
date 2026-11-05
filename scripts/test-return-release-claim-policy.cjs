const assert = require("node:assert/strict");
const { load, db, put, setMock } = require("./lib/rentalTestHarness.cjs");
const policy = load("shared/rentalSecurity.ts");
const refunds = new Map();
const intents = new Map();
const refundCalls = [];
let cancelFailures = 0;
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
      if (cancelFailures > 0) { cancelFailures -= 1; throw new Error("Stripe fixture transient cancellation failure"); }
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
const { lateFeeQuote } = load("convex/lib/lateFee.ts");
const { returnStatementEmail } = load("shared/returnStatement.ts");
const scheduled = [];
const now = Date.UTC(2026, 10, 4, 10, 0);
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
  runAction: async (ref,args) => {
    if (ref === "checkout.markReturned") return checkout.markReturned.handler(ctx,args);
    throw Error(`Unexpected action ${ref}`);
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
  assert.ok(lateFeeQuote(noClaim.lineItems, noClaim.returnTime, now).amount > 0, "the no-claim fixture must be late by the objective quote");
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

  const zeroValueLateClaim = rental();
  const onTimeSelection = selection(zeroValueLateClaim, true, "No late amount should be claimable.");
  onTimeSelection.actualReturnedAt = Date.UTC(2026, 10, 3, 19, 30);
  assert.equal(lateFeeQuote(zeroValueLateClaim.lineItems, zeroValueLateClaim.returnTime, onTimeSelection.actualReturnedAt).amount, 0);
  await assert.rejects(checkout.markReturned.handler(ctx, onTimeSelection), /There is no calculated late amount to claim/);
  assert.equal(zeroValueLateClaim.returnDecision, undefined);

  const unexplainedRetention = rental();
  const retentionSelection = selection(unexplainedRetention);
  retentionSelection.depositKept = 1;
  await assert.rejects(checkout.markReturned.handler(ctx, retentionSelection), /evidence and reason for a damage deduction/);
  assert.equal(unexplainedRetention.returnDecision, undefined);

  const claimed = rental();
  await checkout.markReturned.handler(ctx, selection(claimed, true, "Owner claim for equipment returned after the agreed time."));
  assert.equal(claimed.lateFeeAmount, 100);
  assert.equal(claimed.lateFeeClaimReason, "Owner claim for equipment returned after the agreed time.");
  assert.equal(claimed.returnStatement.lateClaimReason, claimed.lateFeeClaimReason);

  const held = rental(0);
  held.securityPolicyVersion = policy.LEGACY_TEN_PERCENT_HOLD_POLICY;
  held.depositHoldAmount = 50;
  held.stripeDepositIntentId = "pi_active_hold";
  held.depositHoldStatus = "held";
  held.depositHoldExpiresAt = now + 86400000;
  held.depositHoldRenewalIntentId = "pi_renewal_hold";
  held.depositHoldRenewalStatus = "starting";
  held.depositHoldPreviousIntentIds = ["pi_superseded_hold"];
  held.stripePaymentIntentId = undefined;
  held.paymentSources = [];
  assert.ok(lateFeeQuote(held.lineItems, held.returnTime, now).amount > 0, "the hold fixture must have an objectively calculated late amount");
  intents.set("pi_active_hold", { id: "pi_active_hold", status: "requires_capture", amount_capturable: 5000, amount_received: 0 });
  intents.set("pi_renewal_hold", { id: "pi_renewal_hold", status: "requires_capture", amount_capturable: 5000, amount_received: 0 });
  intents.set("pi_superseded_hold", { id: "pi_superseded_hold", status: "requires_capture", amount_capturable: 5000, amount_received: 0 });
  await checkout.markReturned.handler(ctx, selection(held));
  assert.equal(intents.get("pi_active_hold").status, "canceled");
  assert.equal(intents.get("pi_renewal_hold").status, "canceled");
  assert.equal(intents.get("pi_superseded_hold").status, "canceled");
  assert.equal(held.depositHoldStatus, "released");
  assert.deepEqual(held.depositHoldPreviousIntentIds, []);
  assert.equal(held.lateFeeAmount, 0);

  const cardHold = rental(0);
  cardHold.securityPolicyVersion = policy.CARD_HOLD_SECURITY_POLICY_VERSION;
  cardHold.depositHoldAmount = 50;
  cardHold.stripeDepositIntentId = "pi_card_hold_release";
  cardHold.depositHoldStatus = "held";
  cardHold.stripePaymentIntentId = undefined;
  cardHold.paymentSources = [];
  intents.set("pi_card_hold_release", { id: "pi_card_hold_release", status: "requires_capture", amount_capturable: 5000, amount_received: 0 });
  const cardHoldRefundCalls = refundCalls.length;
  await checkout.markReturned.handler(ctx, selection(cardHold));
  assert.equal(intents.get("pi_card_hold_release").status, "canceled", "the new card-hold policy releases its Stripe authorization on an issue-free return");
  assert.equal(cardHold.depositHoldStatus, "released");
  assert.equal(cardHold.depositRefunded, undefined, "releasing a hold is not recorded as a cash refund");
  assert.equal(refundCalls.length, cardHoldRefundCalls, "an uncaptured authorization release creates no refund");
  assert.equal(cardHold.returnStatement.holdStatus, "released");

  const transient = rental(0);
  transient.securityPolicyVersion = policy.LEGACY_TEN_PERCENT_HOLD_POLICY;
  transient.depositHoldAmount = 50;
  transient.stripeDepositIntentId = "pi_transient_hold";
  transient.depositHoldStatus = "held";
  transient.stripePaymentIntentId = undefined;
  transient.paymentSources = [];
  intents.set("pi_transient_hold", { id: "pi_transient_hold", status: "requires_capture", amount_capturable: 5000, amount_received: 0 });
  cancelFailures = 1;
  await assert.rejects(checkout.markReturned.handler(ctx, selection(transient)), /transient cancellation failure/);
  assert(transient.returnDecision);
  assert(scheduled.some(([, ref, args]) => ref === "checkout.recoverDepositReturn" && args.bookingId === transient._id));
  await checkout.recoverDepositReturn.handler(ctx, { bookingId: transient._id, attempt: 0 });
  assert.equal(intents.get("pi_transient_hold").status, "canceled");
  assert.equal(transient.depositHoldStatus, "released");
  assert.equal(transient.lateFeeAmount, 0);

  const cardHoldTransient = rental(0);
  cardHoldTransient.securityPolicyVersion = policy.CARD_HOLD_SECURITY_POLICY_VERSION;
  cardHoldTransient.depositHoldAmount = 50;
  cardHoldTransient.stripeDepositIntentId = "pi_card_hold_transient";
  cardHoldTransient.depositHoldStatus = "held";
  cardHoldTransient.stripePaymentIntentId = undefined;
  cardHoldTransient.paymentSources = [];
  intents.set("pi_card_hold_transient", { id: "pi_card_hold_transient", status: "requires_capture", amount_capturable: 5000, amount_received: 0 });
  cancelFailures = 1;
  await assert.rejects(checkout.markReturned.handler(ctx, selection(cardHoldTransient)), /transient cancellation failure/);
  assert(cardHoldTransient.returnDecision);
  await checkout.recoverDepositReturn.handler(ctx, { bookingId: cardHoldTransient._id, attempt: 0 });
  assert.equal(intents.get("pi_card_hold_transient").status, "canceled", "bounded recovery finds the new primary hold field and retries its release");
  assert.equal(cardHoldTransient.depositHoldStatus, "released");
  assert.equal(cardHoldTransient.lateFeeAmount, 0);

  const savedPolicy = rental(0);
  savedPolicy.securityPolicyVersion = policy.SECURITY_POLICY_VERSION;
  savedPolicy.depositHoldAmount = 50;
  savedPolicy.stripeDepositIntentId = "pi_saved_policy_hold";
  savedPolicy.depositHoldStatus = "held";
  savedPolicy.stripePaymentIntentId = undefined;
  savedPolicy.paymentSources = [];
  intents.set("pi_saved_policy_hold", { id: "pi_saved_policy_hold", status: "requires_capture", amount_capturable: 5000, amount_received: 0 });
  const originalMutation = ctx.runMutation;
  ctx.runMutation = async (ref,args) => ref === "savedCardState.markReturn" ? undefined : originalMutation(ref,args);
  try { await checkout.markReturned.handler(ctx, selection(savedPolicy)); } finally { ctx.runMutation = originalMutation; }
  assert.equal(intents.get("pi_saved_policy_hold").status, "canceled");
  assert.equal(savedPolicy.depositHoldStatus, "released");
  assert.equal(savedPolicy.lateFeeAmount, 0);

  const expiredHold = rental(0);
  expiredHold.securityPolicyVersion = policy.LEGACY_TEN_PERCENT_HOLD_POLICY;
  expiredHold.depositHoldAmount = 50;
  expiredHold.stripeDepositIntentId = "pi_expired_hold";
  expiredHold.depositHoldStatus = "held";
  expiredHold.stripePaymentIntentId = undefined;
  expiredHold.paymentSources = [];
  intents.set("pi_expired_hold", { id: "pi_expired_hold", status: "canceled", amount_capturable: 0, amount_received: 0 });
  await checkout.markReturned.handler(ctx, selection(expiredHold));
  assert.equal(expiredHold.depositHoldStatus, "released", "an already expired provider authorization is recorded as released without retaining a late fee");
  assert.equal(expiredHold.lateFeeAmount, 0);

  const claimedHold = rental(0);
  claimedHold.securityPolicyVersion = policy.LEGACY_TEN_PERCENT_HOLD_POLICY;
  claimedHold.depositHoldAmount = 50;
  claimedHold.stripeDepositIntentId = "pi_explicit_late_claim_hold";
  claimedHold.depositHoldStatus = "held";
  claimedHold.stripePaymentIntentId = undefined;
  claimedHold.paymentSources = [];
  intents.set("pi_explicit_late_claim_hold", { id: "pi_explicit_late_claim_hold", status: "requires_capture", amount_capturable: 5000, amount_received: 0 });
  await checkout.markReturned.handler(ctx, selection(claimedHold, true, "The late return caused additional agreed rental time."));
  assert.equal(claimedHold.lateFeeAmount, 100);
  assert.equal(claimedHold.lateFeeClaimReason, "The late return caused additional agreed rental time.");
  assert.equal(intents.get("pi_explicit_late_claim_hold").status, "requires_capture", "only a documented, explicit claim may leave the hold available for review");

  const releaseEmail=returnStatementEmail({number:"DBC-R-TEST",issuedAt:now,actualReturnedAt:now,supplierName:"Db Cinema Rentals",customerEmail:"renter@example.invalid",lineItems:[],subtotal:0,discount:0,deliveryFee:0,creditApplied:0,checkoutPaid:0,securityPaid:0,securityRefunded:0,holdStatus:"released",damageTotal:0,damageFromHold:0,lateAssessed:0,lateWaived:0,lateBreakdown:[]});
  assert.match(releaseEmail.html,/Any unused card authorisation holds for this rental have been released/);
  assert.match(releaseEmail.html,/They were not charges or refunds/);
  console.log("PASS return settlement: unclaimed late amounts stay zero, cash deposits return in full, late claims require reasons, and current, renewal, superseded and saved-card holds release automatically with bounded retry.");
})().catch((error) => { console.error(error); process.exitCode = 1; });
