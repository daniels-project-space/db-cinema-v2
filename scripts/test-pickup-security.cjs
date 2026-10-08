const assert = require("node:assert/strict");
const { load, db, put, setMock } = require("./lib/rentalTestHarness.cjs");
let clock = Date.parse("2026-10-08T12:00:00Z");
Date.now = () => clock;
let events = [],
  outcome = "requires_capture",
  error = null,
  onCreate = null,
  onClaim = null,
  onResult = null,
  scheduled = [],
  intents = new Map(),
  sessions = new Map(),
  methods = new Map(),
  setups = new Map(),
  subscriptions = new Map();
class StripeFixture {
  paymentMethodConfigurations = {retrieve:async id=>({active:true,card:{display_preference:{value:"on"}},apple_pay:{display_preference:{value:"off"}},google_pay:{display_preference:{value:"off"}},link:{display_preference:{value:"off"}}})};
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
        amount_received: 0,
        amount_capturable: a.amount,
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
process.env.STRIPE_RENTAL_PAYMENT_METHOD_CONFIGURATION_ID="pmc_test_card";
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
  runMutation: async (ref, a) => {
    if (ref === "pickupSecurity.result" && onResult) await onResult(a);
    const result = await ({ pickupSecurity: security })[ref.split(".")[0]][ref.split(".")[1]].handler(ctx, a);
    const snapshot = structuredClone(result);
    if (ref === "pickupSecurity.claim" && onClaim) await onClaim();
    return snapshot;
  },
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
  assert.equal(shared.pickupHoldAt({lineItems:[{start:Date.parse("2026-10-10"),pickupTime:"18:00"},{start:Date.parse("2026-10-11"),pickupTime:"09:00"},{start:Date.parse("2026-10-10"),pickupTime:"10:00"}],pickupTime:"22:00"}),Date.parse("2026-10-10T09:00:00Z"),"Hold follows earliest actual per-item collection, with London BST, rather than the global clock or smallest clock on another day");
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
  assert.equal(await security.result.handler(ctx, {bookingId:b._id,generation:b.securityHoldGeneration,status:"failed",retry:true,failureCode:"provider_unavailable"}), false, "A late transport failure cannot overwrite a webhook-confirmed hold");
  assert.equal(b.depositHoldStatus,"held");
  assert.equal(await security.result.handler(ctx,{bookingId:b._id,generation:b.securityHoldGeneration,intentId:b.stripeDepositIntentId,status:"processing",providerStatus:"processing"}),false,"An old processing receipt cannot regress an already authorised hold");
  assert.equal(await security.result.handler(ctx,{bookingId:b._id,generation:b.securityHoldGeneration,intentId:b.stripeDepositIntentId,status:"failed",providerStatus:"requires_payment_method"}),false,"An old failed confirmation cannot regress a held intent");
  const heldId=b.stripeDepositIntentId;
  b.depositHoldStatus="failed";
  for(const terminal of ["requires_capture","processing","succeeded"]) {
    intents.get(heldId).status=terminal;
    events=[];
    await assert.rejects(holds.updatePickupCard.handler(ctx,{token:"valid",bookingId:b._id}), /held, charged or still processing/);
    assert(!events.some(e=>["setup","cancel"].includes(e[0])), "Recovery does not replace or cancel a held/captured/processing intent");
  }
  intents.get(heldId).status="requires_capture";
  intents.get(heldId).amount_received=500;
  intents.get(heldId).amount_capturable-=500;
  assert.equal((await holds.syncPickup.handler(ctx,{token:"valid",bookingId:b._id})).status,"captured","Partially captured funds are never labelled an uncaptured full hold");
  assert.equal(b.stripeDepositIntentId,heldId);
  assert(!events.some(e=>e[0]==="cancel"));
  const capturedSession="cs_captured";
  b.securityHoldRecoverySessionId=capturedSession;
  b.securityHoldRecoveryGeneration=b.securityHoldGeneration;
  b.securityHoldRecoveryReleasedIntentId=heldId;
  assert.equal(await security.recoverCard.handler(ctx,{bookingId:b._id,sessionId:capturedSession,customerId:"cus_test",paymentMethodId:"pm_other"}),false,"Late completed setup cannot erase a captured payment");
  assert.equal(b.stripeDepositIntentId,heldId);

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
  b = make();
  await save(b);
  const claimedGeneration = b.securityHoldGeneration;
  onClaim = async () => {
    b.lineItems = [{ start: Date.parse("2026-10-25") }];
    await security.schedulePickupHold(ctx, b);
  };
  await due(b);
  onClaim = null;
  assert.equal(b.depositHoldStatus, "scheduled", "An old claimed worker cannot satisfy the rescheduled hold");
  assert(!b.stripeDepositIntentId, "Old generation intent is never linked to new pickup");
  assert.equal(intents.get(`pi_${b._id}_${claimedGeneration}`)?.status, "canceled", "Old worker's orphan authorisation is released");

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
  const oldChallenge=intents.get(b.stripeDepositIntentId);
  oldChallenge.status="requires_action";
  b.depositHoldStatus="requires_action";
  events=[];
  onResult=async()=>{b.depositHoldStatus="held";};
  assert.equal((await holds.syncPickup.handler(ctx,{token:"valid",bookingId:b._id})).status,"stale");
  onResult=null;
  assert.equal(b.depositHoldStatus,"held");
  assert(!events.some(e=>e[0]==="cancel"),"Rejected old bank challenge must not cancel a current webhook-confirmed intent");

  const challengeId=b.stripeDepositIntentId;
  b.depositHoldStatus="requires_action";
  intents.get(challengeId).customer="cus_foreign";
  events=[];
  await assert.rejects(holds.resumePickup.handler(ctx,{token:"valid",bookingId:b._id}), /does not match/);
  assert.equal((await holds.syncPickup.handler(ctx,{token:"valid",bookingId:b._id})).status,"mismatch");
  assert.equal(b.depositHoldStatus,"failed","Mismatched linked hold cannot satisfy pickup");
  assert(!events.some(e=>e[0]==="cancel"),"Foreign funds are never canceled");
  intents.get(challengeId).customer="cus_test";
  for(const [field,value] of [["amount",25100],["currency","eur"],["payment_method","pm_foreign"],["capture_method","automatic"],["metadata",{bookingId:b._id,purpose:"pickup_security_hold",generation:String(b.securityHoldGeneration+1)}]]) {
    const original=intents.get(challengeId)[field];
    intents.get(challengeId)[field]=value;
    b.depositHoldStatus="requires_action";
    await assert.rejects(holds.resumePickup.handler(ctx,{token:"valid",bookingId:b._id}), /does not match/);
    assert.equal((await holds.syncPickup.handler(ctx,{token:"valid",bookingId:b._id})).status,"mismatch");
    assert(!events.some(e=>e[0]==="cancel"));
    intents.get(challengeId)[field]=original;
  }
  intents.get(challengeId).customer="cus_test";
  intents.get(challengeId).status="requires_action";
  b.depositHoldStatus="requires_action";
  const unchangedDue=b.securityHoldDueAt;
  await assert.rejects(security.schedulePickupHold(ctx,{...b,lineItems:[{start:Date.parse("2026-11-10")}]}), /existing security authorisation/);
  assert.equal(b.securityHoldDueAt,unchangedDue,"Bound bank challenges cannot silently keep old collection dates");
  intents.get(challengeId).status="requires_payment_method";
  intents.get(challengeId).payment_method=null;
  await holds.updatePickupCard.handler(ctx,{token:"valid",bookingId:b._id});
  assert.equal(intents.get(challengeId).status,"canceled","Setup starts only after verified cancellation of old bank challenge");
  b.depositHoldStatus="processing";
  assert.equal(await security.recoverCard.handler(ctx,{bookingId:b._id,sessionId:"cs_recovery",customerId:"cus_test",paymentMethodId:"pm_other"}),false,"Processing hold is not forgotten by setup callback");
  b.depositHoldStatus="requires_action";
  b.securityHoldGeneration++;
  assert.equal(await security.recoverCard.handler(ctx,{bookingId:b._id,sessionId:"cs_recovery",customerId:"cus_test",paymentMethodId:"pm_other"}),false,"Recovery callback is fenced to the generation which released its old intent");

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
  events=[];
  await assert.rejects(holds.updatePickupCard.handler(ctx,{token:"valid",bookingId:b._id}), /outcome is still unknown/, "Exhausted uncertain requests cannot be replaced by fresh-generation holds");
  assert(!events.some(e=>e[0]==="setup"));
  error=null;
  b=make();
  await save(b);
  clock=b.securityHoldDueAt;
  b.securityHoldAttempts=1;
  b.securityHoldLeaseUntil=clock-1;
  clock+=24*3600000;
  await holds.authorizePickup.handler(ctx,{bookingId:b._id,generation:b.securityHoldGeneration});
  assert(!events.some(e=>e[0]==="create"),"Unresolved retries after the provider idempotency window never create duplicate holds");
  assert.equal(b.securityHoldFailureCode,"provider_outcome_unknown");

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
  assert.equal(events.findLast(e=>e[0]==="setup")[1].payment_method_configuration,"pmc_test_card","Recovery reuses the actual card-only rental configuration");
  assert.equal(events.findLast((e) => e[0] === "setup")[1].mode, "setup");
  await security.recoverCard.handler(ctx, {
    bookingId: b._id,
    sessionId: "cs_recovery",
    customerId: "cus_test",
    paymentMethodId: "pm_updated",
  });
  assert.equal(b.securityHoldPaymentMethodId, "pm_updated");
  assert.equal(b.securityHoldRecoveredSessionId,"cs_recovery","Completed card setup receipt survives confirmation/webhook replay");
  sessions.set("cs_recovery",{id:"cs_recovery",mode:"setup",status:"complete",payment_status:"no_payment_required",customer:"cus_test",setup_intent:"seti",metadata:{pickupCardBookingId:b._id}});
  assert.equal((await checkout.finalize.handler(ctx,{sessionId:"cs_recovery"})).holdStatus,"scheduled","Actual Checkout confirmation replays the completed setup receipt");
  b.depositHoldStatus="held";
  assert.equal((await checkout.finalize.handler(ctx,{sessionId:"cs_recovery"})).holdStatus,"held","Repeated confirmation returns current stored hold status");
  sessions.set("cs_stale",{...sessions.get("cs_recovery"),id:"cs_stale"});
  await assert.rejects(checkout.finalize.handler(ctx,{sessionId:"cs_stale"}), /no longer current/,"Rejected recovery is not presented as successful card setup");
  sessions.set("cs_recovery",{...sessions.get("cs_recovery"),customer:"cus_foreign"});
  await assert.rejects(checkout.finalize.handler(ctx,{sessionId:"cs_recovery"}), /no longer current/,"Completed receipt cannot be reused with a foreign Stripe customer");
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
    "PASS pickup security: London/DST slots; future scheduling; exact10%/full amounts; once-only manual/off-session holds; stale claim snapshots/dates and cancelled rentals; orphan cleanup; exact intent ownership/amount/card binding; captured and processing recovery protection; late transport/old idempotency guards; bank authentication; bounded uncertain retries; all payment/subscription/setup saved-card paths; ownership and card-recovery replay guards; historical cancellation terms.",
  );
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
