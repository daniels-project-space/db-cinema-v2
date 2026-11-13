const assert = require("node:assert/strict");
const { load, db, put, setMock } = require("./lib/rentalTestHarness.cjs");
const policy = load("shared/rentalSecurity.ts");
const refunds = new Map();
const intents = new Map();
const refundCalls = [];
const securityClaimCalls = [];
const cancelCalls = [];
let cancelFailures = 0;
let loseRefundResponse = false;
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
      if (loseRefundResponse) { loseRefundResponse = false; throw new Error("Lost provider response after refund creation"); }
      return row;
    },
  };
  paymentIntents = {
    retrieve: async (id) => intents.get(id),
    cancel: async (id, _params, options) => {
      cancelCalls.push({ id, idempotencyKey: options?.idempotencyKey });
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
const ownerClaimFixture = "a".repeat(64);
process.env.OWNER_RETURN_CLAIM_TOKEN = ownerClaimFixture;
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
    if (ref === "securityChargeState.prepareFromReturnDecision") {
      securityClaimCalls.push({ mode: "notice", args });
      return `charge_fixture_${securityClaimCalls.length}`;
    }
    if (!ref.startsWith("bookings.")) throw Error(`Unexpected mutation ${ref}`);
    return bookings[ref.split(".")[1]].handler(ctx, args);
  },
  runAction: async (ref,args) => {
    if (ref === "checkout.markReturned") return checkout.markReturned.handler(ctx,args);
    if (ref === "securityCharges.submitReturnDecisionClaim") {
      const booking = await db.get(args.bookingId);
      assert(Number.isSafeInteger(booking?.returnDecision?.ownerClaimAuthorizedAt), "Only a previously owner-authorized return can use the internal retry path.");
      assert.equal("ownerClaimToken" in args, false, "The internal retry uses the durable authorization receipt, not a persisted owner secret.");
      securityClaimCalls.push({ mode: "immediate", args });
      return { id: `charge_fixture_${securityClaimCalls.length}`, status: "paid" };
    }
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
function withOwnerClaim(value) { return { ...value, ownerClaimToken: ownerClaimFixture }; }
(async () => {
  const noClaim = rental();
  assert.ok(lateFeeQuote(noClaim.lineItems, noClaim.returnTime, now).amount > 0, "the no-claim fixture must be late by the objective quote");
  const claimsBeforeCleanReturn = securityClaimCalls.length;
  const result = await checkout.markReturned.handler(ctx, selection(noClaim));
  assert.equal(securityClaimCalls.length, claimsBeforeCleanReturn, "A return without an explicit claim never prepares or charges a saved card.");
  assert.equal(result.lateAmount, 0);
  assert.equal(noClaim.lateFeeAmount, 0);
  assert.equal(noClaim.lateFeeWaivedAmount, undefined);
  assert.equal(noClaim.returnDecision.lateClaimPolicyVersion, "owner-claim-v1");
  assert.equal(noClaim.depositRefundAmount, 50);
  assert.equal(noClaim.returnStatement.lateAssessed, 0);
  assert.equal(noClaim.returnStatement.lateWaived, 0);

  const claimWithoutOwner = rental();
  const noOwnerClaim = selection(claimWithoutOwner, true, "Documented late return claim for the fixture.");
  const claimCallsBeforeOwnerGate = securityClaimCalls.length;
  const refundCallsBeforeOwnerGate = refundCalls.length;
  await assert.rejects(checkout.markReturned.handler(ctx, noOwnerClaim), /Only the account owner can authorize/);
  assert.equal(claimWithoutOwner.returnDecision, undefined, "Missing owner authorization must reject before recording return or settlement state.");
  assert.equal(securityClaimCalls.length, claimCallsBeforeOwnerGate, "Missing owner authorization must not create a saved-card charge.");
  assert.equal(refundCalls.length, refundCallsBeforeOwnerGate, "Missing owner authorization must not create a Stripe refund.");

  const wrongOwner = rental();
  await assert.rejects(checkout.markReturned.handler(ctx, { ...selection(wrongOwner, true, "Documented late return claim for the fixture."), ownerClaimToken: "b".repeat(64) }), /Only the account owner can authorize/);
  assert.equal(wrongOwner.returnDecision, undefined, "Wrong owner authorization must also reject before mutation.");

  const configuredOwnerToken = process.env.OWNER_RETURN_CLAIM_TOKEN;
  delete process.env.OWNER_RETURN_CLAIM_TOKEN;
  const cleanWithoutConfiguredOwner = rental(0);
  await checkout.markReturned.handler(ctx, selection(cleanWithoutConfiguredOwner));
  assert.equal(cleanWithoutConfiguredOwner.status, "returned", "A clean return must remain automatic if owner-only claims are not configured.");
  const unconfiguredClaim = rental();
  await assert.rejects(checkout.markReturned.handler(ctx, withOwnerClaim(selection(unconfiguredClaim, true, "Documented late return claim for the fixture."))), /Owner-only return claims are not configured/);
  assert.equal(unconfiguredClaim.returnDecision, undefined, "Missing server-side owner configuration must prevent any claim mutation.");
  process.env.OWNER_RETURN_CLAIM_TOKEN = configuredOwnerToken;

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
  await checkout.markReturned.handler(ctx, withOwnerClaim(selection(claimed, true, "Owner claim for equipment returned after the agreed time.")));
  assert.equal(claimed.lateFeeAmount, 100);
  assert.equal(claimed.lateFeeClaimReason, "Owner claim for equipment returned after the agreed time.");
  assert.equal(claimed.returnStatement.lateClaimReason, claimed.lateFeeClaimReason);
  assert(Number.isSafeInteger(claimed.returnDecision.ownerClaimAuthorizedAt), "The frozen claim stores a non-secret owner authorization receipt.");
  assert.equal("ownerClaimToken" in claimed.returnDecision, false, "The authorization receipt never stores the owner secret.");

  const recoverClaim = rental();
  recoverClaim.lineItems[0].dailyRate = 10;
  const recoverClaimSelection = withOwnerClaim(selection(recoverClaim, true, "The kit came back after the agreed London return time."));
  loseRefundResponse = true;
  const refundCallsBeforeClaimRecovery = refundCalls.length;
  await assert.rejects(checkout.markReturned.handler(ctx, recoverClaimSelection), /Lost provider response after refund creation/);
  assert(Number.isSafeInteger(recoverClaim.returnDecision.ownerClaimAuthorizedAt));
  assert.equal(recoverClaim.depositRefunded, false, "The ambiguous refund remains incomplete until its original provider receipt is recovered.");
  const originalClaimRefund = [...refunds.values()].find(row => row.metadata?.dbc_deposit_return_booking === String(recoverClaim._id));
  assert(originalClaimRefund, "The fixture stores the provider-created refund before simulating the lost response.");
  const authorizationReceiptAt = recoverClaim.returnDecision.ownerClaimAuthorizedAt;
  const configuredOwnerTokenForRecovery = process.env.OWNER_RETURN_CLAIM_TOKEN;
  delete process.env.OWNER_RETURN_CLAIM_TOKEN;
  const recoveredClaim = await checkout.reconcileDepositRefund.handler(ctx, { refundId: originalClaimRefund.id });
  process.env.OWNER_RETURN_CLAIM_TOKEN = configuredOwnerTokenForRecovery;
  assert.equal(recoveredClaim.ok, true, "A Stripe refund webhook resumes the exact frozen owner-authorized decision without the owner secret.");
  assert.equal(recoverClaim.depositRefunded, true);
  assert.equal(recoverClaim.depositRefundAmount, 50);
  assert.equal(recoverClaim.lateFeeClaimReason, recoverClaimSelection.lateClaimReason);
  assert.equal(recoverClaim.returnDecision.ownerClaimAuthorizedAt, authorizationReceiptAt, "Recovery preserves the original immutable authorization receipt.");
  assert.equal(refundCalls.length, refundCallsBeforeClaimRecovery + 1, "Webhook recovery observes the original refund instead of creating a duplicate.");

  await assert.rejects(checkout.markReturned.handler(ctx, {
    ...selection(recoverClaim), damageKept: 1, depositKept: 1, damageNote: "A different claim after the original return was frozen.",
    inspection: [{ key: "legacy:0:0", condition: "issue", details: "A different claim after the original return was frozen.", openCase: false }],
  }), /saved (?:deposit|return) decision/i, "A stored receipt cannot authorize changed claim amounts or evidence.");
  const newClaimWithoutOwner = rental(0);
  await assert.rejects(checkout.markReturned.handler(ctx, selection(newClaimWithoutOwner, true, "A new claim without owner confirmation.")), /Only the account owner can authorize/);
  assert.equal(newClaimWithoutOwner.returnDecision, undefined, "An authorization receipt for another rental cannot authorize a new claim.");

  const immediateClaim = rental(0);
  immediateClaim.securityPolicyVersion = policy.IMMEDIATE_CLAIM_SECURITY_POLICY_VERSION;
  immediateClaim.savedCardLimit = 50;
  immediateClaim.lineItems[0].dailyRate = 10;
  immediateClaim.stripePaymentIntentId = undefined;
  immediateClaim.paymentSources = [];
  const immediateSelection = withOwnerClaim(selection(immediateClaim, true, "The kit came back after the agreed London return time."));
  const beforeImmediateClaim = securityClaimCalls.length;
  const immediateResult = await checkout.markReturned.handler(ctx, immediateSelection);
  assert.equal(securityClaimCalls.length, beforeImmediateClaim + 1);
  assert.equal(securityClaimCalls.at(-1).mode, "immediate");
  assert.equal(securityClaimCalls.at(-1).args.kind, "late");
  assert.equal(securityClaimCalls.at(-1).args.reason, immediateSelection.lateClaimReason);
  assert.equal(immediateResult.claims[0].status, "paid");
  const immediateRequestId = securityClaimCalls.at(-1).args.requestId;
  await checkout.markReturned.handler(ctx, immediateSelection);
  assert.equal(securityClaimCalls.at(-1).args.requestId, immediateRequestId, "Retry reuses the immutable return-claim request key.");

  const damageClaim = rental(0);
  damageClaim.securityPolicyVersion = policy.IMMEDIATE_CLAIM_SECURITY_POLICY_VERSION;
  damageClaim.savedCardLimit = 50;
  damageClaim.stripePaymentIntentId = undefined;
  damageClaim.paymentSources = [];
  const damageSelection = selection(damageClaim);
  damageSelection.actualReturnedAt = Date.UTC(2026, 10, 3, 19, 0);
  damageSelection.damageKept = 25;
  damageSelection.damageNote = "Severe permanent marks on the lens barrel; repair quote £25.";
  damageSelection.claimBasis = "severe_cosmetic_damage";
  damageSelection.inspection = [{ key: "legacy:0:0", condition: "issue", details: damageSelection.damageNote, openCase: false }];
  damageSelection.ownerClaimToken = ownerClaimFixture;
  const beforeDamageClaim = securityClaimCalls.length;
  const damageResult = await checkout.markReturned.handler(ctx, damageSelection);
  assert.equal(securityClaimCalls.length, beforeDamageClaim + 1);
  assert.equal(securityClaimCalls.at(-1).args.kind, "damage");
  assert.equal(securityClaimCalls.at(-1).args.amount, 25);
  assert.equal(securityClaimCalls.at(-1).args.claimBasis, "severe_cosmetic_damage");
  assert.equal(damageClaim.returnDecision.claimBasis, "severe_cosmetic_damage");
  assert.equal(damageResult.claims[0].status, "paid");

  const noticeOnlyClaim = rental(0);
  noticeOnlyClaim.securityPolicyVersion = policy.SETUP_INTENT_SECURITY_POLICY_VERSION;
  noticeOnlyClaim.savedCardLimit = 50;
  noticeOnlyClaim.lineItems[0].dailyRate = 10;
  noticeOnlyClaim.stripePaymentIntentId = undefined;
  noticeOnlyClaim.paymentSources = [];
  const noticeSelection = withOwnerClaim(selection(noticeOnlyClaim, true, "The kit came back after the agreed London return time."));
  const beforeNoticeClaim = securityClaimCalls.length;
  const noticeResult = await checkout.markReturned.handler(ctx, noticeSelection);
  assert.equal(securityClaimCalls.length, beforeNoticeClaim + 1);
  assert.equal(securityClaimCalls.at(-1).mode, "notice");
  assert.equal(securityClaimCalls.at(-1).args.immediate, false, "Older signed terms keep the agreed notice period.");
  assert.equal(noticeResult.claims[0].status, "notice_pending");

  const noDamageBasis = rental(0);
  noDamageBasis.securityPolicyVersion = policy.IMMEDIATE_CLAIM_SECURITY_POLICY_VERSION;
  noDamageBasis.savedCardLimit = 50;
  noDamageBasis.stripePaymentIntentId = undefined;
  noDamageBasis.paymentSources = [];
  const missingBasis = selection(noDamageBasis);
  missingBasis.damageKept = 1;
  missingBasis.damageNote = "Permanent damage documented on the camera body.";
  await assert.rejects(checkout.markReturned.handler(ctx, missingBasis), /Choose whether the saved-card claim/);
  assert.equal(noDamageBasis.returnDecision, undefined, "A policy basis is required before a claim can be saved.");

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
  assert.equal(cardHold.returnStatement.holdAmount, 50, "The return record preserves the signed temporary authorisation amount");
  assert.equal(cardHold.returnStatement.securityPolicyVersion, policy.CARD_HOLD_SECURITY_POLICY_VERSION, "The return receipt retains its card-hold policy branch");
  const cardHoldEmail = returnStatementEmail(cardHold.returnStatement).html;
  assert.match(cardHoldEmail, /Temporary card authorisation hold: £50\.00; cancelled without a charge/);
  assert.doesNotMatch(cardHoldEmail, /No security payment or card hold was taken|refund issued/);

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

  const savedCardClaimHold = rental(0);
  savedCardClaimHold.securityPolicyVersion = policy.IMMEDIATE_CLAIM_SECURITY_POLICY_VERSION;
  savedCardClaimHold.savedCardLimit = 50;
  savedCardClaimHold.lineItems[0].dailyRate = 10;
  savedCardClaimHold.depositHoldAmount = 50;
  savedCardClaimHold.stripeDepositIntentId = "pi_saved_claim_hold";
  savedCardClaimHold.depositHoldStatus = "held";
  savedCardClaimHold.depositHoldRenewalIntentId = "pi_saved_claim_renewal";
  savedCardClaimHold.depositHoldPreviousIntentIds = ["pi_saved_claim_superseded"];
  savedCardClaimHold.stripePaymentIntentId = undefined;
  savedCardClaimHold.paymentSources = [];
  for (const id of ["pi_saved_claim_hold", "pi_saved_claim_renewal", "pi_saved_claim_superseded"])
    intents.set(id, { id, status: "requires_capture", amount_capturable: 5000, amount_received: 0 });
  const savedCardClaimSelection = withOwnerClaim(selection(savedCardClaimHold, true, "The kit came back after the agreed return time."));
  const savedClaimCallsBeforeReleaseFailure = securityClaimCalls.length;
  const savedClaimCancelCallsBeforeReleaseFailure = cancelCalls.length;
  cancelFailures = 1;
  await assert.rejects(checkout.markReturned.handler(ctx, savedCardClaimSelection), /transient cancellation failure/);
  assert(Number.isSafeInteger(savedCardClaimHold.returnDecision?.ownerClaimAuthorizedAt), "The scheduled retry is tied to a frozen owner-authorized claim.");
  assert.equal(securityClaimCalls.length, savedClaimCallsBeforeReleaseFailure, "A failed hold release stops before the saved-card claim is submitted.");
  assert(scheduled.some(([, ref, args]) => ref === "checkout.recoverDepositReturn" && args.bookingId === savedCardClaimHold._id), "A saved-card claim with hold cleanup failure schedules bounded recovery.");
  const savedClaimReceipt = savedCardClaimHold.returnDecision.ownerClaimAuthorizedAt;
  const ownerTokenBeforeSavedClaimRecovery = process.env.OWNER_RETURN_CLAIM_TOKEN;
  delete process.env.OWNER_RETURN_CLAIM_TOKEN;
  await checkout.recoverDepositReturn.handler(ctx, { bookingId: savedCardClaimHold._id, attempt: 0 });
  process.env.OWNER_RETURN_CLAIM_TOKEN = ownerTokenBeforeSavedClaimRecovery;
  assert.equal(savedCardClaimHold.status, "returned", "Recovery completes the exact frozen return after the hold provider recovers.");
  assert.equal(savedCardClaimHold.returnDecision.ownerClaimAuthorizedAt, savedClaimReceipt, "Recovery does not replace the authorization receipt.");
  for (const id of ["pi_saved_claim_hold", "pi_saved_claim_renewal", "pi_saved_claim_superseded"])
    assert.equal(intents.get(id).status, "canceled", `The saved-card return releases ${id}.`);
  assert.deepEqual(savedCardClaimHold.depositHoldPreviousIntentIds, [], "Released superseded holds are cleared only after Stripe confirms cancellation.");
  assert.equal(securityClaimCalls.length, savedClaimCallsBeforeReleaseFailure + 1, "The claim is submitted only after all authorizations are released.");
  const savedClaimRequestId = securityClaimCalls.at(-1).args.requestId;
  assert.equal(securityClaimCalls.at(-1).args.kind, "late");
  const primaryReleaseAttempts = cancelCalls.filter((call) => call.id === "pi_saved_claim_hold");
  assert.equal(primaryReleaseAttempts.length, 2, "The failed primary cancellation is retried, not treated as released.");
  assert.equal(new Set(primaryReleaseAttempts.map((call) => call.idempotencyKey)).size, 1, "Retry preserves the primary hold cancellation idempotency key.");
  await checkout.recoverDepositReturn.handler(ctx, { bookingId: savedCardClaimHold._id, attempt: 1 });
  assert.equal(cancelCalls.length, savedClaimCancelCallsBeforeReleaseFailure + 4, "A replay observes canceled holds without canceling them again.");
  assert.equal(securityClaimCalls.at(-1).args.requestId, savedClaimRequestId, "A replay keeps the deterministic claim key for the frozen decision.");

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
  await checkout.markReturned.handler(ctx, withOwnerClaim(selection(claimedHold, true, "The late return caused additional agreed rental time.")));
  assert.equal(claimedHold.lateFeeAmount, 100);
  assert.equal(claimedHold.lateFeeClaimReason, "The late return caused additional agreed rental time.");
  assert.equal(intents.get("pi_explicit_late_claim_hold").status, "requires_capture", "only a documented, explicit claim may leave the hold available for review");

  const claimedHoldWithAux = rental(0);
  claimedHoldWithAux.securityPolicyVersion = policy.LEGACY_TEN_PERCENT_HOLD_POLICY;
  claimedHoldWithAux.depositHoldAmount = 50;
  claimedHoldWithAux.stripeDepositIntentId = "pi_claim_primary";
  claimedHoldWithAux.depositHoldStatus = "held";
  claimedHoldWithAux.depositHoldRenewalIntentId = "pi_claim_renewal";
  claimedHoldWithAux.depositHoldRenewalStatus = "renewed";
  claimedHoldWithAux.depositHoldPreviousIntentIds = ["pi_claim_previous"];
  claimedHoldWithAux.stripePaymentIntentId = undefined;
  claimedHoldWithAux.paymentSources = [];
  for (const id of ["pi_claim_primary", "pi_claim_renewal", "pi_claim_previous"])
    intents.set(id, { id, status: "requires_capture", amount_capturable: 5000, amount_received: 0 });
  const claimedAuxSelection = selection(claimedHoldWithAux, true, "The equipment return was late; the agreed additional rental time is itemised.");
  const cancelStart = cancelCalls.length;
  cancelFailures = 1;
  await assert.rejects(checkout.markReturned.handler(ctx, withOwnerClaim(claimedAuxSelection)), /transient cancellation failure/);
  assert.deepEqual(claimedHoldWithAux.depositHoldPreviousIntentIds, ["pi_claim_previous"], "A failed auxiliary cancellation keeps its receipt linked for recovery.");
  assert.equal(claimedHoldWithAux.depositHoldRenewalIntentId, "pi_claim_renewal", "A failed renewal cancellation is not cleared from the booking.");
  assert.equal(intents.get("pi_claim_primary").status, "requires_capture", "The explicitly claimed current authorization remains available for the late claim.");
  const ownerTokenForAuxRetry = process.env.OWNER_RETURN_CLAIM_TOKEN;
  delete process.env.OWNER_RETURN_CLAIM_TOKEN;
  try { await checkout.markReturned.handler(ctx, claimedAuxSelection); }
  finally { process.env.OWNER_RETURN_CLAIM_TOKEN = ownerTokenForAuxRetry; }
  const auxCancelAttempts = cancelCalls.slice(cancelStart).filter(row => row.id === "pi_claim_renewal");
  assert.equal(auxCancelAttempts.length, 2, "The failed renewal release is retried from the saved owner-authorized decision.");
  assert.equal(auxCancelAttempts[0].idempotencyKey, auxCancelAttempts[1].idempotencyKey, "A cancellation retry reuses its stable provider key exactly once.");
  assert.equal(intents.get("pi_claim_renewal").status, "canceled");
  assert.equal(intents.get("pi_claim_previous").status, "canceled");
  assert.equal(claimedHoldWithAux.depositHoldRenewalStatus, "released");
  assert.deepEqual(claimedHoldWithAux.depositHoldPreviousIntentIds, [], "Only provider-confirmed cancellations are removed from the saved record.");

  const releaseEmail=returnStatementEmail({number:"DBC-R-TEST",issuedAt:now,actualReturnedAt:now,supplierName:"Db Cinema Rentals",customerEmail:"renter@example.invalid",lineItems:[],subtotal:0,discount:0,deliveryFee:0,creditApplied:0,checkoutPaid:0,securityPaid:0,securityRefunded:0,holdStatus:"released",damageTotal:0,damageFromHold:0,lateAssessed:0,lateWaived:0,lateBreakdown:[]});
  assert.match(releaseEmail.html,/Any unused card authorisation holds for this rental have been released/);
  assert.match(releaseEmail.html,/They were not charges or refunds/);
  console.log("PASS return settlement: unclaimed late amounts stay zero, cash deposits return in full, late claims require reasons, and current, renewal, superseded and saved-card holds release automatically with bounded retry.");
})().catch((error) => { console.error(error); process.exitCode = 1; });
