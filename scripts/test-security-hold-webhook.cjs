const assert = require("node:assert/strict");
const { load, db, put, setMock } = require("./lib/rentalTestHarness.cjs");

const intents = new Map();
const sessions = new Map();
const paymentMethods = new Map();
const providerReads = [];
let failNextIntentRead = false;
class StripeFixture {
  constructor() {
    this.paymentIntents = {
      retrieve: async (id) => {
        providerReads.push(["intent", id]);
        if (failNextIntentRead) {
          failNextIntentRead = false;
          throw new Error("Transient Stripe read failure");
        }
        if (!intents.has(id)) throw new Error(`Unknown PaymentIntent ${id}`);
        return intents.get(id);
      },
    };
    this.checkout = { sessions: { retrieve: async (id) => {
      providerReads.push(["session", id]);
      if (!sessions.has(id)) throw new Error(`Unknown Checkout Session ${id}`);
      return sessions.get(id);
    } } };
    this.paymentMethods = { retrieve: async (id) => {
      providerReads.push(["payment_method", id]);
      if (!paymentMethods.has(id)) throw new Error(`Unknown PaymentMethod ${id}`);
      return paymentMethods.get(id);
    } };
    this.webhooks = { constructEvent: (body, signature) => {
      if (signature !== "fixture-signature") throw new Error("Invalid signature");
      return JSON.parse(body);
    } };
  }
}

setMock("stripe", { default: StripeFixture });
process.env.STRIPE_SECRET_KEY = "sk_test_fixture";
process.env.STRIPE_WEBHOOK_SECRET = "whsec_fixture";

const bookings = load("convex/bookings.ts");
const checkout = load("convex/checkout.ts");
const { CARD_HOLD_SECURITY_POLICY_VERSION } = load("shared/rentalSecurity.ts");
const booking = put("bookings", {
  status: "pending_verification",
  securityPolicyVersion: CARD_HOLD_SECURITY_POLICY_VERSION,
  depositHoldAmount: 50,
  depositHoldStatus: "requires_action",
  stripeDepositIntentId: "pi_security_hold",
  stripeCheckoutSessionId: "cs_rental",
  stripePaymentIntentId: "pi_rental_charge",
  checkoutPaidAt: Date.now(),
  rmv2Revision: 2,
  lineItems: [{ start: Date.now() + 86400000, end: Date.now() + 2 * 86400000 }],
});
const checkoutSession = {
  id: "cs_rental",
  status: "complete",
  payment_status: "paid",
  metadata: { bookingId: booking._id },
  customer: "cus_renter",
  payment_intent: "pi_rental_charge",
};
const rentalPayment = {
  id: "pi_rental_charge",
  status: "succeeded",
  amount_received: 5000,
  currency: "gbp",
  customer: "cus_renter",
  payment_method: "pm_saved",
  setup_future_usage: "off_session",
};
const hold = {
  id: "pi_security_hold",
  status: "requires_action",
  amount: 5000,
  amount_capturable: 0,
  amount_received: 0,
  currency: "gbp",
  capture_method: "manual",
  customer: "cus_renter",
  payment_method: "pm_saved",
  metadata: { bookingId: booking._id, purpose: "refundable_security_hold" },
  latest_charge: null,
};
sessions.set(checkoutSession.id, checkoutSession);
intents.set(rentalPayment.id, rentalPayment);
intents.set(hold.id, hold);
paymentMethods.set("pm_saved", { id: "pm_saved", type: "card", customer: "cus_renter" });

const rmv2Jobs = [];
const mutationCtx = {
  db,
  scheduler: { runAfter: async (delay, ref, args) => rmv2Jobs.push({ delay, ref, args }) },
};
const modules = { bookings, checkout };
const ctx = {
  runQuery: async (ref, args) => {
    const [moduleName, functionName] = ref.split(".");
    return modules[moduleName][functionName].handler({ db }, args);
  },
  runMutation: async (ref, args) => {
    const [moduleName, functionName] = ref.split(".");
    return modules[moduleName][functionName].handler(mutationCtx, args);
  },
  runAction: async (ref, args) => {
    const [moduleName, functionName] = ref.split(".");
    return modules[moduleName][functionName].handler(ctx, args);
  },
};
const deliver = (type, snapshot = hold, signature = "fixture-signature") =>
  checkout.stripeWebhook.handler(ctx, {
    body: JSON.stringify({ type, data: { object: snapshot } }),
    sig: signature,
  });
const eventFor = (type, snapshot = hold) => deliver(type, snapshot);
const setState = (status, extra = {}) => Object.assign(hold, {
  status,
  amount_capturable: status === "requires_capture" ? 5000 : 0,
  amount_received: status === "succeeded" ? 5000 : 0,
  latest_charge: status === "requires_capture"
    ? { payment_method_details: { card: { capture_before: Math.floor((Date.now() + 86400000) / 1000) } } }
    : null,
  ...extra,
});

(async () => {
  assert.equal(await deliver("payment_intent.amount_capturable_updated", hold, "invalid"), false);
  assert.deepEqual(providerReads, [], "invalid signatures do not read provider state");

  // A delayed SCA completion must win over the stale requires_action event body,
  // even when the renter closed the success page before browser sync completed.
  await eventFor("payment_intent.requires_action");
  assert.equal(booking.depositHoldStatus, "requires_action");
  const beforeHeld = booking.rmv2Revision;
  setState("requires_capture");
  await eventFor("payment_intent.amount_capturable_updated", { ...hold, status: "requires_action", amount_capturable: 0 });
  assert.equal(booking.depositHoldStatus, "held");
  assert.equal(booking.rmv2Revision, beforeHeld + 1);
  assert.equal(rmv2Jobs.length, 1, "first provider reconciliation queues one Rental Manager sync");
  const heldRevision = booking.rmv2Revision;
  await eventFor("payment_intent.amount_capturable_updated", { ...hold, status: "requires_action", amount_capturable: 0 });
  assert.equal(booking.depositHoldStatus, "held");
  assert.equal(booking.rmv2Revision, heldRevision, "duplicate/replayed webhooks are idempotent");
  assert.equal(rmv2Jobs.length, 1);

  // A temporary provider read error fails the webhook so Stripe can retry;
  // it must not write a guessed failure or lose the still-valid hold state.
  failNextIntentRead = true;
  await assert.rejects(eventFor("payment_intent.amount_capturable_updated"), /Transient Stripe read failure/);
  assert.equal(booking.depositHoldStatus, "held");
  await eventFor("payment_intent.amount_capturable_updated");
  assert.equal(booking.depositHoldStatus, "held");
  assert.equal(booking.rmv2Revision, heldRevision);

  // Explicit action-required and failure statuses are reconciled from current
  // Stripe state, not from potentially stale snapshots in event.data.object.
  setState("requires_action");
  await eventFor("payment_intent.requires_action");
  assert.equal(booking.depositHoldStatus, "requires_action");
  let revision = booking.rmv2Revision;
  setState("requires_payment_method");
  await eventFor("payment_intent.payment_failed");
  assert.equal(booking.depositHoldStatus, "failed");
  assert.equal(booking.rmv2Revision, revision + 1);
  revision = booking.rmv2Revision;
  setState("processing");
  await eventFor("payment_intent.processing");
  assert.equal(booking.depositHoldStatus, "failed", "unknown/incomplete provider states fail closed");
  assert.equal(booking.rmv2Revision, revision);

  setState("canceled");
  await eventFor("payment_intent.canceled");
  assert.equal(booking.depositHoldStatus, "released");
  revision = booking.rmv2Revision;
  await eventFor("payment_intent.canceled");
  assert.equal(booking.rmv2Revision, revision, "repeated cancellation does not enqueue another sync");

  setState("succeeded");
  await eventFor("payment_intent.succeeded");
  assert.equal(booking.depositHoldStatus, "captured", "a provider-captured amount is never shown as a mere authorization");
  revision = booking.rmv2Revision;
  setState("requires_capture");
  await eventFor("payment_intent.amount_capturable_updated");
  assert.equal(booking.depositHoldStatus, "captured", "captured is terminal even if an older event replays");
  assert.equal(booking.rmv2Revision, revision);

  // Bad provider binding details cannot masquerade as a valid hold.
  booking.depositHoldStatus = "requires_action";
  for (const [key, value] of [
    ["amount", 100], ["currency", "usd"], ["capture_method", "automatic"],
    ["customer", "cus_other"], ["payment_method", "pm_other"],
  ]) {
    const prior = hold[key];
    hold[key] = value;
    setState("requires_capture");
    await eventFor("payment_intent.amount_capturable_updated");
    assert.equal(booking.depositHoldStatus, "failed", `${key} mismatch fails closed`);
    hold[key] = prior;
    booking.depositHoldStatus = "requires_action";
  }

  // Missing or wrong rental linkage is harmless; transient retrieval errors are retryable.
  const originalSessionMetadata = checkoutSession.metadata;
  checkoutSession.metadata = { bookingId: "another-booking" };
  const mismatchRevision = booking.rmv2Revision;
  await eventFor("payment_intent.amount_capturable_updated");
  assert.equal(booking.rmv2Revision, mismatchRevision);
  checkoutSession.metadata = originalSessionMetadata;
  const originalIntentMetadata = hold.metadata;
  hold.metadata = { bookingId: booking._id, purpose: "wrong-purpose" };
  await eventFor("payment_intent.amount_capturable_updated", { ...hold, metadata: originalIntentMetadata });
  assert.equal(booking.depositHoldStatus, "failed");
  hold.metadata = originalIntentMetadata;

  booking.status = "returned";
  const endedRevision = booking.rmv2Revision;
  setState("canceled");
  await eventFor("payment_intent.canceled");
  assert.equal(booking.rmv2Revision, endedRevision, "ended bookings are not rewritten by late events");

  booking.status = "confirmed";
  booking.securityPolicyVersion = "2026-10-saved-card-v1";
  const nonHoldRevision = booking.rmv2Revision;
  setState("requires_capture");
  await eventFor("payment_intent.amount_capturable_updated");
  assert.equal(booking.rmv2Revision, nonHoldRevision, "saved-card policies never gain hold state from these events");

  console.log("PASS generic refundable-hold webhook: delayed 3DS completion after browser-sync loss, stale event snapshots, provider retries, duplicate idempotency, status/error coverage, amount/card/currency/session binding, and terminal/closed-booking guards. Stripe is mocked; no live payment operations.");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
