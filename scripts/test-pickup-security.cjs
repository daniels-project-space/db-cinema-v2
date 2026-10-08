const assert = require("node:assert/strict");
const { load, db, put, setMock } = require("./lib/rentalTestHarness.cjs");
let clock = Date.parse("2026-10-08T12:00:00Z");
Date.now = () => clock;
let events = [],
  outcome = "requires_capture",
  error = null,
  onCreate = null,
  scheduled = [],
  intents = new Map(),
  sessions = new Map(),
  methods = new Map(),
  setups = new Map(),
  subscriptions = new Map();
class StripeFixture {
  paymentIntents = {
    create: async (a, o) => {
      events.push(["create", a, o]);
      if (error) throw error;
      const id = "pi_" + a.metadata.bookingId + "_" + a.metadata.generation;
      if (onCreate) await onCreate();
      const intent = {
        id,
        status: outcome,
        capture_method: "manual",
        amount: a.amount,
        currency: a.currency,
        customer: a.customer,
        payment_method: a.payment_method,
        metadata: a.metadata,
        client_secret: "secret_fixture",
        latest_charge: {
          payment_method_details: {
            card: { capture_before: clock / 1000 + 5 * 86400 },
          },
        },
      };
      intents.set(id, intent);
      return intent;
    },
    retrieve: async (id) => {
      if (!intents.has(id)) throw Error("Missing fixture intent");
      return intents.get(id);
    },
    cancel: async (id) => {
      events.push(["cancel", id]);
      const i = intents.get(id);
      i.status = "canceled";
      return i;
    },
  };
  paymentMethods = { retrieve: async (id) => methods.get(id) };
  setupIntents = { retrieve: async (id) => setups.get(id) };
  subscriptions = { retrieve: async (id) => subscriptions.get(id) };
  checkout = {
    sessions: {
      retrieve: async (id) => sessions.get(id),
      create: async (a) => {
        events.push(["setup", a]);
        return { id: "cs_recovery", url: "https://checkout.stripe.test/setup" };
      },
    },
  };
}
setMock("stripe", { default: StripeFixture });
setMock("./lib/mailer", {
  sendMail: async (a) => {
    events.push(["email", a]);
    return true;
  },
});
setMock("./lib/rmv2SyncQueue", { queueRmv2Sync: async () => {} });
process.env.STRIPE_SECRET_KEY = "sk_test_fixture";
process.env.APP_URL = "https://example.invalid";
const security = load("convex/pickupSecurity.ts"),
  holds = load("convex/holdRenewal.ts"),
  checkout = load("convex/checkout.ts"),
  shared = load("shared/pickupSecurity.ts"),
  cancel = load("src/lib/cancellationPolicy.ts");
const scheduler = {
  runAt: async (at, ref, args) => {
    const id = "job-" + scheduled.length;
    scheduled.push({ at, ref, args, id });
    return id;
  },
  runAfter: async (ms, ref, args) => scheduler.runAt(clock + ms, ref, args),
  cancel: async () => {},
};
const ctx = {
  db,
  scheduler,
  runQuery: async (ref, a) =>
    ref === "accounts.me"
      ? { _id: "acct", email: "renter@example.invalid" }
      : { pickupSecurity: security, holdRenewal: holds, checkout }[
          ref.split(".")[0]
        ][ref.split(".")[1]].handler(ctx, a),
  runMutation: async (ref, a) =>
    ({ pickupSecurity: security })[ref.split(".")[0]][
      ref.split(".")[1]
    ].handler(ctx, a),
  runAction: async (ref, a) =>
    ({ holdRenewal: holds, checkout })[ref.split(".")[0]][
      ref.split(".")[1]
    ].handler(ctx, a),
};
const make = (patch = {}) =>
  put("bookings", {
    status: "confirmed",
    accountId: "acct",
    guestEmail: "renter@example.invalid",
    securityHoldPolicyVersion: shared.PICKUP_HOLD_POLICY,
    depositHoldAmount: 250,
    depositHoldStatus: "scheduled",
    stripeCheckoutSessionId: "cs_original",
    lineItems: [
      { start: Date.parse("2026-10-10"), end: Date.parse("2026-10-12") },
    ],
    pickupTime: "11:00",
    ...patch,
  });
const save = (b) =>
  security.saveCard.handler(ctx, {
    bookingId: b._id,
    sessionId: "cs_original",
    customerId: "cus_test",
    paymentMethodId: "pm_card",
  });
async function due(b) {
  clock = b.securityHoldDueAt;
  await holds.authorizePickup.handler(ctx, {
    bookingId: b._id,
    generation: b.securityHoldGeneration,
  });
}
(async () => {
  assert.equal(
    shared.pickupHoldAt({
      lineItems: [{ start: Date.parse("2026-10-10") }],
      pickupTime: "11:00",
    }),
    Date.parse("2026-10-10T10:00:00Z"),
  );
  assert.equal(
    shared.pickupHoldAt({
      lineItems: [{ start: Date.parse("2026-11-10") }],
      pickupTime: "11:00",
    }),
    Date.parse("2026-11-10T11:00:00Z"),
  );
  assert.throws(
    () =>
      shared.pickupHoldAt({
        lineItems: [{ start: Date.parse("2027-03-28") }],
        pickupTime: "01:30",
      }),
    /clocks change/,
  );
  let b = make();
  await save(b);
  assert.equal(b.depositHoldStatus, "scheduled");
  assert.equal(scheduled.at(-1).at, b.securityHoldDueAt);
  await holds.authorizePickup.handler(ctx, {
    bookingId: b._id,
    generation: b.securityHoldGeneration,
  });
  assert(
    !events.some((e) => e[0] === "create"),
    "Checkout never starts future hold",
  );
  const gen = b.securityHoldGeneration;
  await save(b);
  assert.equal(b.securityHoldGeneration, gen, "Webhook replay schedules once");
  await due(b);
  let create = events.find((e) => e[0] === "create");
  assert.equal(create[1].amount, 25000);
  assert.equal(create[1].capture_method, "manual");
  assert.equal(create[1].off_session, true);
  assert.deepEqual(create[1].allowed_payment_method_types, ["card"]);
  assert.match(create[2].idempotencyKey, /dbc-pickup-hold/);
  assert.equal(b.depositHoldStatus, "held");
  await due(b);
  assert.equal(
    events.filter((e) => e[0] === "create").length,
    1,
    "Duplicate due job does not create second hold",
  );
  events = [];
  b = make({ depositHoldAmount: 2500 });
  await save(b);
  await due(b);
  assert.equal(
    events.find((e) => e[0] === "create")[1].amount,
    250000,
    "Optional full-value hold retained",
  );
  for (const patch of [
    { status: "cancelled" },
    { status: "returned" },
    { cancellationDecision: { createdAt: clock } },
    { returnDecision: { startedAt: clock } },
    { securityHoldPolicyVersion: undefined },
  ]) {
    events = [];
    b = make(patch);
    await save(b);
    await holds.authorizePickup.handler(ctx, {
      bookingId: b._id,
      generation: 1,
    });
    assert(!events.some((e) => e[0] === "create"));
  }
  events = [];
  b = make();
  await save(b);
  const oldGeneration = b.securityHoldGeneration,
    oldDue = b.securityHoldDueAt;
  b.lineItems = [{ start: Date.parse("2026-10-20") }];
  await security.schedulePickupHold(ctx, b);
  clock = oldDue;
  await holds.authorizePickup.handler(ctx, {
    bookingId: b._id,
    generation: oldGeneration,
  });
  assert(
    !events.some((e) => e[0] === "create"),
    "Old pickup job is inert after rescheduling",
  );
  await due(b);
  assert.equal(b.depositHoldStatus, "held");
  events = [];
  b = make();
  await save(b);
  onCreate = async () => {
    b.status = "cancelled";
  };
  await due(b);
  onCreate = null;
  assert(
    events.some((e) => e[0] === "cancel"),
    "Racing cancellation releases orphan hold",
  );
  assert.notEqual(b.depositHoldStatus, "held");
  events = [];
  b = make();
  await save(b);
  await due(b);
  const orphanId = b.stripeDepositIntentId;
  b.securityHoldGeneration += 1;
  b.stripeDepositIntentId = undefined;
  await holds.reconcilePickupWebhook.handler(ctx, { bookingId: b._id, intentId: orphanId });
  assert.equal(intents.get(orphanId).status, "canceled", "Late webhook cleans orphaned old-generation hold after unknown worker outcome");

  events = [];
  outcome = "requires_action";
  b = make();
  await save(b);
  await due(b);
  assert.equal(b.depositHoldStatus, "requires_action");
  const resumed = await holds.resumePickup.handler(ctx, {
    token: "valid",
    bookingId: b._id,
  });
  assert.equal(resumed.clientSecret, "secret_fixture");
  await assert.rejects(
    () =>
      holds.resumePickup.handler(ctx, {
        token: "valid",
        bookingId: make({ accountId: "other" })._id,
      }),
    /access denied/,
  );
  intents.get(b.stripeDepositIntentId).status = "requires_capture";
  assert.equal(
    (await holds.syncPickup.handler(ctx, { token: "valid", bookingId: b._id }))
      .status,
    "held",
  );
  events = [];
  outcome = "requires_capture";
  error = { type: "StripeConnectionError" };
  b = make();
  await save(b);
  await due(b);
  assert.equal(b.depositHoldStatus, "processing");
  assert(b.securityHoldRetryAt > clock);
  const keys = [];
  for (let n = 0; n < 2; n++) {
    clock = b.securityHoldRetryAt;
    await holds.authorizePickup.handler(ctx, {
      bookingId: b._id,
      generation: b.securityHoldGeneration,
    });
  }
  assert.equal(b.securityHoldAttempts, 3);
  assert.equal(b.depositHoldStatus, "failed");
  assert.equal(b.securityHoldRetryAt, undefined);
  assert.equal(
    new Set(
      events.filter((e) => e[0] === "create").map((e) => e[2].idempotencyKey),
    ).size,
    1,
    "Uncertain provider retries reuse same intent key",
  );
  assert(
    events.some((e) => e[0] === "email"),
    "Exhausted transient attempts notify customer",
  );
  error = null;
  methods.set("pm_card", { id: "pm_card", type: "card", customer: "cus_test" });
  intents.set("pi_paid", { status: "succeeded", payment_method: "pm_card" });
  setups.set("seti", { status: "succeeded", payment_method: "pm_card" });
  subscriptions.set("sub_paid", { default_payment_method: "pm_card" });
  subscriptions.set("sub_trial", { pending_setup_intent: "seti" });
  for (const s of [
    { payment_intent: "pi_paid" },
    { setup_intent: "seti" },
    { subscription: "sub_paid" },
    { subscription: "sub_trial" },
  ])
    assert.deepEqual(
      await checkout.checkoutSavedCard(
        { customer: "cus_test", ...s },
        new StripeFixture(),
      ),
      { customerId: "cus_test", paymentMethodId: "pm_card" },
    );
  methods.set("pm_card", {
    id: "pm_card",
    type: "card",
    customer: "wrong_customer",
  });
  await assert.rejects(
    () =>
      checkout.checkoutSavedCard(
        { customer: "cus_test", setup_intent: "seti" },
        new StripeFixture(),
      ),
    /not attached/,
  );
  methods.set("pm_card", { id: "pm_card", type: "card", customer: "cus_test" });
  b = make({ depositHoldStatus: "failed", securityHoldCustomerId: "cus_test" });
  await holds.updatePickupCard.handler(ctx, {
    token: "valid",
    bookingId: b._id,
  });
  assert.equal(b.securityHoldRecoverySessionId, "cs_recovery");
  assert.equal(events.findLast((e) => e[0] === "setup")[1].mode, "setup");
  await security.recoverCard.handler(ctx, {
    bookingId: b._id,
    sessionId: "cs_recovery",
    customerId: "cus_test",
    paymentMethodId: "pm_updated",
  });
  assert.equal(b.securityHoldPaymentMethodId, "pm_updated");
  await save(b);
  assert.equal(
    b.securityHoldPaymentMethodId,
    "pm_updated",
    "Original checkout replay cannot overwrite recovered card",
  );
  assert.equal(
    cancel.cancellationDaysForBooking({
      agreementDocs: [{ kind: "cancellation", version: "2026-10-v12" }],
    }),
    14,
  );
  assert.equal(
    cancel.cancellationDaysForBooking({
      agreementDocs: [{ kind: "cancellation", version: "2026-10-v10" }],
    }),
    3,
  );
  console.log(
    "PASS pickup security: London/DST slots; future scheduling; exact10%/full amounts; once-only manual/off-session holds; stale dates and cancelled rentals; orphan cleanup; bank authentication; bounded uncertain retries; all payment/subscription/setup saved-card paths; ownership and card-recovery replay guards; historical cancellation terms.",
  );
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
