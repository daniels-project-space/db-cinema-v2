const assert = require("node:assert/strict");
const { load, db, put, setMock } = require("./lib/rentalTestHarness.cjs");
const policy = load("shared/rentalSecurity.ts");
const refunds = new Map();
const intents = new Map();
const refundCalls = [];
const securityClaimCalls = [];
const cancelCalls = [];
const captureCalls = [];
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
    capture: async (id, params, options) => {
      captureCalls.push({ id, params, idempotencyKey: options?.idempotencyKey });
      const intent = intents.get(id);
      intent.status = "succeeded";
      intent.amount_received = params.amount_to_capture;
      intent.amount_capturable = 0;
      return intent;
    },
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
setMock("./mailer", { sendBusinessMailTracked: async mail => ({ sent: true, ambiguous: false, resendEmailId: `resend-${mail.deliveryKey}` }) });
setMock("./lib/mailer", { sendMail: async () => true });
process.env.STRIPE_SECRET_KEY = "sk_test_fixture";
process.env.ADMIN_TOKEN = "return-release-fixture";
process.env.INBOUND_REPLY_ADDRESS = "support@resend-inbox.example.invalid";
const ownerClaimFixture = "a".repeat(64);
process.env.OWNER_RETURN_CLAIM_TOKEN = ownerClaimFixture;
const checkout = load("convex/checkout.ts");
const bookings = load("convex/bookings.ts");
const admin = load("convex/adminAuth.ts");
const inspections = load("convex/returnInspections.ts");
const securityState = load("convex/securityChargeState.ts");
const emailInbox = load("convex/emailInbox.ts");
const attachments = load("convex/chatAttachments.ts");
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
    if (ref === "securityChargeState.evidenceOptions") return securityState.evidenceOptions.handler(ctx, args);
    throw Error(`Unexpected query ${ref}`);
  },
  runMutation: async (ref, args) => {
    if (ref === "adminAuth.assertAdminInternal") return admin.assertAdminInternal.handler(ctx, args);
    if (ref === "emailInbox.prepareRentalContextEmail") return emailInbox.prepareRentalContextEmail.handler(ctx, args);
    if (ref === "emailInbox.finishRentalContextEmail") return emailInbox.finishRentalContextEmail.handler(ctx, args);
    if (ref === "savedCardState.markReturn") return cards.markReturn.handler(ctx, args);
    if (ref === "securityChargeState.prepareFromReturnDecision" || ref === "securityChargeState.prepareFromFrozenReturnDecision") {
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
function manualHoldRental() {
  const booking = rental(0);
  booking.securityPolicyVersion = policy.CARD_HOLD_SECURITY_POLICY_VERSION;
  booking.depositHoldAmount = 50;
  booking.stripeDepositIntentId = `pi_damage_hold_${Math.random()}`;
  booking.depositHoldStatus = "held";
  booking.stripePaymentIntentId = undefined;
  booking.paymentSources = [];
  intents.set(booking.stripeDepositIntentId, { id: booking.stripeDepositIntentId, status: "requires_capture", amount_capturable: 5000, amount_received: 0 });
  const account = put("accounts", { email: `hold-${Math.random()}@example.invalid`, emailVerifiedAt: Date.now(), name: "Hold renter" });
  booking.accountId = account._id;
  booking.guestEmail = account.email;
  return booking;
}
function addRentalEvidence(booking, id = `chat_attachment_attempts-${Math.random()}`, evidenceBooking = booking, evidenceAccount = booking.accountId) {
  const messageId = `messages-${Math.random()}`;
  put("messages", { _id: messageId, accountId: evidenceAccount, bookingId: evidenceBooking._id, sender: "owner", text: "Attachment: condition.jpg", meta: { kind: "attachment", attachmentId: id }, at: now });
  put("chat_attachment_attempts", { _id: id, accountId: evidenceAccount, bookingId: evidenceBooking._id, admin: true, requestKey: `request-${Math.random()}`, marker: "image/jpeg", createdAt: now, status: "published", storageId: `storage-${Math.random()}`, messageId, name: "condition.jpg", contentType: "image/jpeg", sha256: "a".repeat(64), size: 1024 });
  return id;
}
function holdDamageSelection(booking, claimItemKey = "legacy:0:0") {
  const selected = withOwnerClaim(selection(booking));
  selected.damageKept = 25;
  selected.damageNote = "Scratches on the camera body; repair evidence supplied.";
  selected.claimItemKey = claimItemKey;
  selected.inspection = [{ key: "legacy:0:0", condition: "issue", details: selected.damageNote, openCase: false }];
  return selected;
}
(async () => {
  const unauthorized = rental();
  const unauthorizedCalls = { refund: refundCalls.length, claim: securityClaimCalls.length, cancel: cancelCalls.length };
  await assert.rejects(
    checkout.markReturned.handler(ctx, { ...selection(unauthorized), token: "not-an-admin-token" }),
    /unauthorized/i,
    "Only an authenticated administrator can mark a rental returned or release its hold.",
  );
  assert.equal(unauthorized.status, "active", "An unauthorized return leaves booking state untouched.");
  assert.equal(unauthorized.returnDecision, undefined, "An unauthorized return cannot freeze a settlement decision.");
  assert.deepEqual({ refund: refundCalls.length, claim: securityClaimCalls.length, cancel: cancelCalls.length }, unauthorizedCalls, "An unauthorized return cannot call Stripe or prepare a claim.");

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
  assert(scheduled.some(([, ref, args]) => ref === "invoice.returnSettlementEmail" && args.bookingId === noClaim._id), "a completed handover queues the renter's return statement");
  const concurrentCashReturn = rental(50);
  const concurrentRefundStart = refundCalls.length;
  const realNow = Date.now;
  let concurrentClock = realNow();
  Date.now = () => concurrentClock++;
  let concurrentResults;
  try {
    concurrentResults = await Promise.all([
      checkout.markReturned.handler(ctx, selection(concurrentCashReturn)),
      checkout.markReturned.handler(ctx, selection(concurrentCashReturn)),
    ]);
  } finally {
    Date.now = realNow;
  }
  assert(concurrentResults.every(returnResult => returnResult.released === 50 && returnResult.kept === 0), "concurrent clean-return requests settle the same saved decision");
  const concurrentRefundCalls = refundCalls.slice(concurrentRefundStart);
  assert(concurrentRefundCalls.length >= 1 && concurrentRefundCalls.every(call => call.options.idempotencyKey.startsWith(`dbc-deposit-release-${concurrentCashReturn._id}-`)), "concurrent retries use the booking's original-source refund key");
  assert.equal(new Set(concurrentRefundCalls.map(call => call.options.idempotencyKey)).size, 1, "concurrent return retries share one stable Stripe refund idempotency key");
  assert.equal([...refunds.values()].filter(refund => refund.metadata?.dbc_deposit_return_booking === String(concurrentCashReturn._id)).length, 1, "concurrent retries produce only one provider refund receipt");
  const completedRefundCallCount = refundCalls.length;
  await checkout.markReturned.handler(ctx, selection(concurrentCashReturn));
  assert.equal(refundCalls.length, completedRefundCallCount, "a completed replay does not request another refund");
  const setupIntentCleanReturn = rental(0);
  setupIntentCleanReturn.securityPolicyVersion = policy.SETUP_INTENT_SECURITY_POLICY_VERSION;
  setupIntentCleanReturn.savedCardLimit = 50;
  setupIntentCleanReturn.stripePaymentIntentId = undefined;
  setupIntentCleanReturn.paymentSources = [];
  setupIntentCleanReturn.stripeDepositIntentId = undefined;
  const setupRefundCallCount = refundCalls.length;
  const setupCaptureCallCount = captureCalls.length;
  const setupCancelCallCount = cancelCalls.length;
  const setupCleanResult = await checkout.markReturned.handler(ctx, selection(setupIntentCleanReturn));
  assert.equal(setupCleanResult.released, 0, "a SetupIntent stores the card for permitted future claims; it is not a deposit to refund");
  assert.equal(setupCleanResult.kept, 0);
  assert.equal(setupIntentCleanReturn.status, "returned");
  assert.equal(setupIntentCleanReturn.savedCardStatus, "closed");
  assert.equal(refundCalls.length, setupRefundCallCount, "a clean SetupIntent return does not issue a cash refund");
  assert.equal(captureCalls.length, setupCaptureCallCount, "a clean SetupIntent return never captures money");
  assert.equal(cancelCalls.length, setupCancelCallCount, "a card-on-file SetupIntent does not create an authorization hold to cancel");
  assert.match(returnStatementEmail(setupIntentCleanReturn.returnStatement).html, /No deposit or card hold was taken/);
  Object.assign(noClaim, { lateFeeAmount: 100, lateFeeStatus: "notice_sent", lateFeeNoticeAt: now - 8 * 86400000 });
  assert.equal(await bookings.claimLateCharge.handler(ctx, { bookingId: noClaim._id }), false, "the scheduled collector rejects a late fee without the explicit owner claim and reason");

  const unapprovedClaim = rental(0);
  Object.assign(unapprovedClaim, {
    status: "returned", actualReturnedAt: now, lateFeeAmount: 100, lateFeeStatus: "notice_sent",
    lateFeeNoticeAt: now - 8 * 86400000, lateFeeClaimReason: "The agreed return was missed.",
    returnDecision: { lateClaimPolicyVersion: "owner-claim-v1", chargeLate: true, lateClaimReason: "The agreed return was missed.", actualReturnedAt: now },
  });
  assert.equal(await bookings.claimLateCharge.handler(ctx, { bookingId: unapprovedClaim._id }), false, "a reason without owner authorization is insufficient for scheduled collection");
  const legacyLateClaim = put("bookings", {
    status: "returned", actualReturnedAt: now, lateFeeAmount: 100, lateFeeStatus: "notice_sent",
    lateFeeNoticeAt: now - 8 * 86400000, lateFeeClaimReason: "The old scheduled claim had a reason.",
    lateFeeBreakdown: [{ title: "Camera", days: 1, dailyRate: 100, amount: 100 }],
  });
  assert.equal(await bookings.claimLateCharge.handler(ctx, { bookingId: legacyLateClaim._id }), false, "legacy pending fees without a frozen owner-authorized return cannot auto-collect");
  assert.equal(legacyLateClaim.lateFeeStatus, "admin_review", "unproven legacy claims leave the automatic collection queue for owner review");

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
  const lateClaimEvidence = "attachment_fixture_late_claim";
  immediateSelection.claimEvidenceIds = [lateClaimEvidence];
  const beforeImmediateClaim = securityClaimCalls.length;
  const immediateResult = await checkout.markReturned.handler(ctx, immediateSelection);
  assert.equal(securityClaimCalls.length, beforeImmediateClaim + 1);
  assert.equal(securityClaimCalls.at(-1).mode, "immediate");
  assert.equal(securityClaimCalls.at(-1).args.kind, "late");
  assert.equal(securityClaimCalls.at(-1).args.reason, `Late fee 10.00: ${immediateSelection.lateClaimReason}`);
  assert.deepEqual(immediateClaim.returnDecision.claimEvidenceIds, [lateClaimEvidence], "late-claim evidence is frozen with the owner-authorized return decision");
  assert.deepEqual(securityClaimCalls.at(-1).args.evidenceIds, [lateClaimEvidence], "the late-claim caller forwards the selected evidence to claim preparation");
  assert.equal(immediateResult.claims[0].status, "paid");
  const immediateRequestId = securityClaimCalls.at(-1).args.requestId;
  await checkout.markReturned.handler(ctx, immediateSelection);
  assert.equal(securityClaimCalls.at(-1).args.requestId, immediateRequestId, "Retry reuses the immutable return-claim request key.");

  const legacyLateDecision = rental(0);
  legacyLateDecision.securityPolicyVersion = policy.IMMEDIATE_CLAIM_SECURITY_POLICY_VERSION;
  legacyLateDecision.savedCardLimit = 50;
  legacyLateDecision.lineItems[0].dailyRate = 10;
  legacyLateDecision.stripePaymentIntentId = undefined;
  legacyLateDecision.paymentSources = [];
  const legacyLateReason = "The kit came back after the agreed London return time.";
  legacyLateDecision.status = "returned";
  legacyLateDecision.actualReturnedAt = now;
  legacyLateDecision.lateFeeAmount = 100;
  legacyLateDecision.returnDecision = {
    actualReturnedAt: now, damageKept: 0, chargeLate: true, lateClaimReason: legacyLateReason,
    lateClaimPolicyVersion: "owner-claim-v1", ownerClaimAuthorizedAt: now,
    inspection: [{ key: "legacy:0:0", condition: "good", details: "", openCase: false }],
  };
  const legacyLateEvidence = "attachment_fixture_recovered_late_claim";
  const legacyLateReplay = { ...selection(legacyLateDecision, true, legacyLateReason), claimEvidenceIds: [legacyLateEvidence] };
  const beforeLegacyLateReplay = securityClaimCalls.length;
  await checkout.markReturned.handler(ctx, legacyLateReplay);
  assert.deepEqual(legacyLateDecision.returnDecision.claimEvidenceIds, [legacyLateEvidence], "a frozen owner-authorized legacy late claim can add its missing evidence once");
  assert.deepEqual(securityClaimCalls.at(-1).args.evidenceIds, [legacyLateEvidence], "legacy late-claim evidence is included on its retry");
  assert.equal(securityClaimCalls.length, beforeLegacyLateReplay + 1);

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

  const mixedReturn = rental(0);
  mixedReturn.securityPolicyVersion = policy.IMMEDIATE_CLAIM_SECURITY_POLICY_VERSION;
  mixedReturn.savedCardLimit = 100;
  mixedReturn.lineItems[0].dailyRate = 10;
  mixedReturn.stripePaymentIntentId = undefined;
  mixedReturn.paymentSources = [];
  const mixedDamageReason = "The camera housing is cracked; the repair estimate is attached.";
  const mixedLateReason = "The equipment was returned after the agreed London time.";
  const mixedSelection = withOwnerClaim(selection(mixedReturn, true, mixedLateReason));
  mixedSelection.damageKept = 25;
  mixedSelection.damageNote = mixedDamageReason;
  mixedSelection.claimBasis = "severe_cosmetic_damage";
  mixedSelection.claimItemKey = "legacy:0:0";
  mixedSelection.claimEvidenceIds = ["attachment_fixture_mixed_return"];
  mixedSelection.inspection = [{ key: "legacy:0:0", condition: "issue", details: mixedDamageReason, openCase: false }];
  const mixedBefore = securityClaimCalls.length;
  const mixedResult = await checkout.markReturned.handler(ctx, mixedSelection);
  assert.equal(securityClaimCalls.length, mixedBefore + 1, "damage and late fees enter the shared claim boundary once");
  const mixedClaim = securityClaimCalls.at(-1).args;
  assert.equal(mixedClaim.kind, "damage");
  assert.equal(mixedClaim.returnAssessment.damageAmountPence, 2500);
  assert.equal(mixedClaim.returnAssessment.lateAmountPence, Math.round(mixedResult.lateAmount * 100));
  assert.equal(mixedClaim.amount, 25 + mixedResult.lateAmount);
  assert(mixedClaim.reason.includes("Damage/loss 25.00:") && mixedClaim.reason.includes("Late fee "), "the single request carries both itemized assessment lines");
  const mixedRequestId = mixedClaim.requestId;
  await checkout.markReturned.handler(ctx, mixedSelection);
  assert.equal(securityClaimCalls.length, mixedBefore + 2, "a return retry re-enters only the one stable combined request");
  assert.equal(securityClaimCalls.at(-1).args.requestId, mixedRequestId);
  assert.equal(mixedResult.claims.length, 1);

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
  assert.equal((await db.query("rental_damage_cases").withIndex("by_booking", q => q.eq("bookingId", cardHold._id)).collect()).length, 0, "A clean hold release does not open a damage case.");
  const cardHoldEmail = returnStatementEmail(cardHold.returnStatement).html;
  assert.match(cardHoldEmail, /Temporary card authorisation hold: £50\.00; cancelled without a charge/);
  assert.doesNotMatch(cardHoldEmail, /No security payment or card hold was taken|refund issued/);

  const missingHoldEvidence = manualHoldRental();
  const missingHoldEvidenceSelection = holdDamageSelection(missingHoldEvidence);
  const holdCapturesBeforeEvidenceGate = captureCalls.length;
  await assert.rejects(checkout.previewReturned.handler(ctx, missingHoldEvidenceSelection), /Attach at least one supporting file/);
  await assert.rejects(checkout.markReturned.handler(ctx, missingHoldEvidenceSelection), /Attach at least one supporting file/);
  assert.equal(captureCalls.length, holdCapturesBeforeEvidenceGate, "A manual card-hold claim without attached evidence cannot capture funds.");
  assert.equal(missingHoldEvidence.returnDecision, undefined, "Missing evidence fails before the claim is frozen.");
  assert.equal(missingHoldEvidence.status, "active");

  const wrongRentalEvidence = manualHoldRental();
  const otherRental = rental(0);
  const wrongRentalEvidenceId = addRentalEvidence(wrongRentalEvidence, undefined, otherRental, wrongRentalEvidence.accountId);
  const wrongRentalSelection = holdDamageSelection(wrongRentalEvidence);
  wrongRentalSelection.claimEvidenceIds = [wrongRentalEvidenceId];
  await assert.rejects(checkout.markReturned.handler(ctx, wrongRentalSelection), /published in this rental's chat/);
  assert.equal(wrongRentalEvidence.returnDecision, undefined, "Evidence from another rental cannot authorize capture.");

  const wrongItemEvidence = manualHoldRental();
  const wrongItemEvidenceId = addRentalEvidence(wrongItemEvidence);
  const wrongItemSelection = holdDamageSelection(wrongItemEvidence, "legacy:0:1");
  wrongItemSelection.claimEvidenceIds = [wrongItemEvidenceId];
  await assert.rejects(checkout.markReturned.handler(ctx, wrongItemSelection), /inspected item that supports this card-hold damage claim/);
  assert.equal(wrongItemEvidence.returnDecision, undefined, "Evidence cannot be assigned to an item absent from this return inspection.");

  const evidencedHoldClaim = manualHoldRental();
  const validHoldEvidenceId = addRentalEvidence(evidencedHoldClaim);
  const evidencedHoldSelection = holdDamageSelection(evidencedHoldClaim);
  evidencedHoldSelection.claimEvidenceIds = [validHoldEvidenceId];
  const capturesBeforeValidHoldClaim = captureCalls.length;
  await checkout.markReturned.handler(ctx, evidencedHoldSelection);
  assert.equal(captureCalls.length, capturesBeforeValidHoldClaim + 1, "A properly authorized, item-bound claim may capture only after valid rental evidence is selected.");
  assert.equal(captureCalls.at(-1).id, evidencedHoldClaim.stripeDepositIntentId);
  assert.equal(captureCalls.at(-1).params.amount_to_capture, 2500);
  assert.equal(captureCalls.at(-1).idempotencyKey, `dbc-hold-capture-${evidencedHoldClaim._id}`);
  assert.equal(evidencedHoldClaim.returnDecision.claimItemKey, "legacy:0:0");
  assert.deepEqual(evidencedHoldClaim.returnDecision.claimEvidenceIds, [validHoldEvidenceId]);
  const claimCase = await db.get(evidencedHoldClaim.returnDecision.claimCaseId);
  assert(claimCase, "Every manual-hold damage capture links to an item case before capture.");
  assert.equal(claimCase.bookingId, evidencedHoldClaim._id);
  assert.equal(claimCase.itemKey, "legacy:0:0");
  assert.equal(claimCase.claimAmountPence, 2500);
  assert.equal(claimCase.claimReason, evidencedHoldClaim.returnDecision.damageNote);
  assert.deepEqual(claimCase.claimEvidenceIds, [validHoldEvidenceId], "The item case durably references the selected supporting files.");
  assert.equal((await db.query("chat_case_archives").withIndex("by_case", q => q.eq("caseId", claimCase._id)).first()).bookingId, evidencedHoldClaim._id);
  const claimEvidenceRetention = await attachments.retention.handler(ctx, { token: process.env.ADMIN_TOKEN, id: validHoldEvidenceId });
  assert.equal(claimEvidenceRetention.caseArchived, true, "The claim's rental chat evidence is inside the permanent case archive.");
  assert.equal(claimEvidenceRetention.expiresAt, null, "Settled damage evidence cannot fall onto the ordinary 90-day deletion path.");
  assert.equal(evidencedHoldClaim.returnDecision.claimCaseId, claimCase._id, "The frozen return decision links back to the permanent case.");
  const caseCountBeforeRetry = (await db.query("rental_damage_cases").withIndex("by_booking", q => q.eq("bookingId", evidencedHoldClaim._id)).collect()).length;
  await checkout.markReturned.handler(ctx, evidencedHoldSelection);
  assert.equal(captureCalls.length, capturesBeforeValidHoldClaim + 1, "A retry observes the captured hold and cannot capture it twice.");
  assert.equal((await db.query("rental_damage_cases").withIndex("by_booking", q => q.eq("bookingId", evidencedHoldClaim._id)).collect()).length, caseCountBeforeRetry, "Settlement retries reuse the same case instead of duplicating it.");
  await db.patch(claimCase._id, { status: "closed", closedAt: now, resolution: "Synthetic case resolution for retry safety." });
  await checkout.markReturned.handler(ctx, evidencedHoldSelection);
  assert.equal((await db.query("rental_damage_cases").withIndex("by_booking", q => q.eq("bookingId", evidencedHoldClaim._id)).collect()).length, caseCountBeforeRetry, "A closed, archived case stays linked to the capture on later settlement retries.");

  const legacyPendingHoldClaim = manualHoldRental();
  const legacyPendingEvidenceId = addRentalEvidence(legacyPendingHoldClaim);
  const legacyPendingSelection = holdDamageSelection(legacyPendingHoldClaim);
  legacyPendingSelection.claimEvidenceIds = [legacyPendingEvidenceId];
  legacyPendingHoldClaim.returnDecision = {
    actualReturnedAt: now,
    damageKept: 25,
    damageNote: legacyPendingSelection.damageNote,
    chargeLate: false,
    lateClaimPolicyVersion: "owner-claim-v1",
    ownerClaimAuthorizedAt: now - 60_000,
    startedAt: now - 60_000,
    inspection: legacyPendingSelection.inspection,
  };
  await checkout.markReturned.handler(ctx, legacyPendingSelection);
  const resumedCase = await db.get(legacyPendingHoldClaim.returnDecision.claimCaseId);
  assert(resumedCase, "A legacy pending damage decision gets its permanent item case before resuming capture.");
  assert.deepEqual(resumedCase.claimEvidenceIds, [legacyPendingEvidenceId]);
  assert.equal((await attachments.retention.handler(ctx, { token: process.env.ADMIN_TOKEN, id: legacyPendingEvidenceId })).expiresAt, null, "Resumed legacy claims receive the same permanent evidence retention.");
  const resumedCaseCount = (await db.query("rental_damage_cases").withIndex("by_booking", q => q.eq("bookingId", legacyPendingHoldClaim._id)).collect()).length;
  await checkout.markReturned.handler(ctx, legacyPendingSelection);
  assert.equal((await db.query("rental_damage_cases").withIndex("by_booking", q => q.eq("bookingId", legacyPendingHoldClaim._id)).collect()).length, resumedCaseCount, "Legacy claim retries preserve the same item case.");

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
  claimedHold.lateFeeStatus = "notice_sent";
  claimedHold.lateFeeNoticeAt = now - 8 * 86400000;
  const mismatchedAmountFields = structuredClone(claimedHold);
  delete mismatchedAmountFields._id;
  delete mismatchedAmountFields._creationTime;
  mismatchedAmountFields.lateFeeAmount += 1;
  const mismatchedAmount = put("bookings", mismatchedAmountFields);
  assert.equal(await bookings.claimLateCharge.handler(ctx, { bookingId: mismatchedAmount._id }), false, "the collector refuses an amount that differs from the frozen return calculation");
  assert.equal(mismatchedAmount.lateFeeStatus, "admin_review", "a mismatched amount is held for review rather than silently retried");
  const mismatchedBreakdownFields = structuredClone(claimedHold);
  delete mismatchedBreakdownFields._id;
  delete mismatchedBreakdownFields._creationTime;
  mismatchedBreakdownFields.lateFeeBreakdown[0].amount += 1;
  const mismatchedBreakdown = put("bookings", mismatchedBreakdownFields);
  assert.equal(await bookings.claimLateCharge.handler(ctx, { bookingId: mismatchedBreakdown._id }), false, "the collector refuses a tampered itemized calculation");
  assert.equal(mismatchedBreakdown.lateFeeStatus, "admin_review", "a mismatched breakdown is held for review rather than silently retried");
  assert.equal(await bookings.claimLateCharge.handler(ctx, { bookingId: claimedHold._id }), true, "the delayed collector accepts an explicitly owner-authorized, documented claim after notice");
  assert.equal(await bookings.claimLateCharge.handler(ctx, { bookingId: claimedHold._id }), false, "duplicate collection jobs cannot claim a fresh collection lease");
  claimedHold.lateFeeChargingAt = Date.now() - 16 * 60000;
  assert.equal(await bookings.claimLateCharge.handler(ctx, { bookingId: claimedHold._id }), true, "a stale collection lease can be retried for the same frozen amount and reason");
  assert.equal(claimedHold.returnDecision.lateClaimReason, claimedHold.lateFeeClaimReason, "retry preserves the original owner-authorized reason");

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
  assert.equal((await db.query("rental_damage_cases").withIndex("by_booking", q => q.eq("bookingId", claimedHoldWithAux._id)).collect()).length, 0, "A late-fee-only claim does not open a damage case.");

  const releaseEmail=returnStatementEmail({number:"DBC-R-TEST",issuedAt:now,actualReturnedAt:now,supplierName:"Db Cinema Rentals",customerEmail:"renter@example.invalid",lineItems:[],subtotal:0,discount:0,deliveryFee:0,creditApplied:0,checkoutPaid:0,securityPaid:0,securityRefunded:0,holdStatus:"released",damageTotal:0,damageFromHold:0,lateAssessed:0,lateWaived:0,lateBreakdown:[]});
  assert.match(releaseEmail.html,/Any unused card authorisation holds for this rental have been released/);
  assert.match(releaseEmail.html,/They were not charges or refunds/);
  console.log("PASS return settlement: unclaimed late amounts stay zero, cash deposits return in full, late claims require reasons, and current, renewal, superseded and saved-card holds release automatically with bounded retry.");
})().catch((error) => { console.error(error); process.exitCode = 1; });
