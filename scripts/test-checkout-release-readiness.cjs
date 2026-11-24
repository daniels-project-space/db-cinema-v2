const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const { load } = require("./lib/rentalTestHarness.cjs");
const fs = require("node:fs");
const path = require("node:path");

const gateCase = process.env.DBC_CHECKOUT_GATE_CASE;

async function runSavedSessionGateCase() {
  if (gateCase === "membership-replay-paid") return runSavedMembershipReplayPaid();
  const { setMock } = require("./lib/rentalTestHarness.cjs");
  let stockAuthorityReady = gateCase !== "stock";
  let stripeRetrievals = 0;
  let stripeCreates = 0;
  let diditCapacityReads = 0;
  const calls = [];
  setMock("../shared/rentalAgreementRelease", { RENTAL_DRAFT_RELEASE_READY: gateCase !== "release" });
  setMock("./lib/rentalSwapAuthority", { swapAuthorityAvailable: () => stockAuthorityReady });
  setMock("stripe", {
    default: class StripeFixture {
      checkout = {
        sessions: {
          retrieve: async id => {
            stripeRetrievals++;
            return { id, status: "open", payment_status: "unpaid", url: "https://checkout.stripe.test/saved", metadata: { bookingId: "bookings-saved" } };
          },
          create: async () => {
            stripeCreates++;
            return { id: "cs-created", url: "https://checkout.stripe.test/new" };
          },
        },
      };
    },
  });
  Object.assign(process.env, {
    RENTAL_CHECKOUT_ENABLED: "true",
    DIDIT_API_KEY: "fixture",
    DIDIT_WORKFLOW_ID: "fixture",
    DIDIT_WEBHOOK_SECRET: "fixture",
    DIDIT_APPLICATION_ID: "fixture",
    DIDIT_ENVIRONMENT: "sandbox",
    STRIPE_SECRET_KEY: "sk_test_fixture",
    STRIPE_WEBHOOK_SECRET: "fixture",
    STRIPE_RENTAL_PAYMENT_METHOD_CONFIGURATION_ID: "pmc_fixture",
    INVOICE_SECRET: "fixture",
    APP_URL: "https://rental.fixture.invalid",
    BUSINESS_LEGAL_NAME: "DB Cinema Rentals Ltd",
    BUSINESS_INVOICE_ADDRESS: "Trafalgar Square, London",
    RESEND_API_KEY: "fixture",
    RESEND_FROM: "DB Cinema Rentals <bookings@dbcinemarentals.com>",
  });
  if (gateCase === "checkout") process.env.RENTAL_CHECKOUT_ENABLED = "false";
  if (gateCase === "didit") delete process.env.DIDIT_API_KEY;
  if (gateCase === "mail") delete process.env.RESEND_API_KEY;
  if (gateCase === "stripe-key") delete process.env.STRIPE_SECRET_KEY;
  if (gateCase === "payment-config") delete process.env.STRIPE_RENTAL_PAYMENT_METHOD_CONFIGURATION_ID;
  if (gateCase === "payment-webhook") delete process.env.STRIPE_WEBHOOK_SECRET;
  if (gateCase === "didit-capacity") {
    process.env.DIDIT_ENVIRONMENT = "live";
    process.env.DIDIT_MAX_WORKFLOW_PRICE_USD = "0.50";
    process.env.STRIPE_SECRET_KEY = "sk_live_fixture";
    global.fetch = async url => {
      diditCapacityReads++;
      return { ok: true, json: async () => String(url).includes("/workflows/")
        ? { results: [{ workflow_id: "fixture", status: "published", version: 1, max_price: "0.50", features: "OCR + LIVENESS + FACE_MATCH + PROOF_OF_ADDRESS" }] }
        : { balance: "0.00" } };
    };
  }

  const checkout = require("./lib/rentalTestHarness.cjs").load("convex/checkout.ts");
  const { AGREEMENTS } = load("src/lib/legal.ts");
  const args = {
    items: [{ listingId: "listings-fixture", title: "Fixture camera", start: 1_900_000_000_000, end: 1_900_086_400_000, qty: 1, total: 100, deposit: 50 }],
    customer: { email: "renter@example.invalid", name: "Fixture Renter", billingAddress: "123 Fixture Street, London" },
    fulfilment: "pickup",
    deliveryFee: 0,
    expectedTotalDue: 100,
    expectedSavedCardLimit: 100,
    pickupTime: "10:00",
    returnTime: "18:00",
    agreement: { name: "Fixture Renter", requestId: "saved-session-gate-fixture-001", securityHoldConsent: true, laterChargeConsent: true, documents: AGREEMENTS.map(({ kind, version }) => ({ kind, version })) },
  };
  const priorAttempt = { bookingId: "bookings-saved", sessionId: "cs-saved", fingerprintMatches: true, membershipCheckoutId: "membership-checkout-saved" };
  const ctx = {
    runQuery: async ref => {
      calls.push(`query:${ref}`);
      if (ref === "settings.get") return { acceptingOrders: true };
      if (ref === "bookings.checkoutAttempt") return priorAttempt;
      if (ref === "bookings.assertCheckoutReservation") return true;
      throw Error(`Unexpected query ${ref}`);
    },
    runMutation: async ref => { calls.push(`mutation:${ref}`); throw Error(`Unexpected mutation ${ref}`); },
    runAction: async ref => { calls.push(`action:${ref}`); throw Error(`Unexpected action ${ref}`); },
  };
  const expected = {
    checkout: error => error?.data?.code === "CHECKOUT_PAUSED",
    release: error => error?.data?.code === "RENTAL_AGREEMENT_REVIEW",
    stock: error => error?.data?.code === "STOCK_SYNC_UNAVAILABLE",
    didit: error => /Automatic identity and address verification is being configured/.test(error?.message ?? ""),
    "didit-capacity": error => {
      const message = error?.data?.message ?? error?.message ?? "";
      return /Identity verification is temporarily unavailable/.test(message);
    },
    mail: error => /Rental receipts and payment notifications are being configured/.test(error?.message ?? ""),
    "stripe-key": error => /Rental card payment setup is incomplete/.test(error?.message ?? ""),
    "payment-config": error => /Rental card payment setup is incomplete/.test(error?.message ?? ""),
    "payment-webhook": error => /Rental card payment setup is incomplete/.test(error?.message ?? ""),
  }[gateCase];
  assert.ok(expected, `Unknown checkout gate case: ${gateCase}`);
  await assert.rejects(checkout.start.handler(ctx, args), expected, `Saved checkout retry must fail closed when ${gateCase} readiness is disabled`);
  if (gateCase === "didit-capacity") {
    assert.deepEqual(calls, ["query:settings.get", "query:bookings.checkoutAttempt"], "The live credit recheck stops before asserting stock or returning the existing URL");
    assert.equal(stripeRetrievals, 1, "The saved Stripe session is verified as open before the live Didit balance check");
    assert.equal(diditCapacityReads, 2, "Both the published workflow and prepaid balance are rechecked");
  } else {
    assert.deepEqual(calls, [], `The ${gateCase} gate must run before loading the saved booking/session`);
    assert.equal(stripeRetrievals, 0, `The ${gateCase} gate must run before retrieving the saved Stripe session`);
  }
  assert.equal(stripeCreates, 0, `The ${gateCase} gate must run before creating a Stripe session`);
  console.log(`PASS saved-session retry stops before DB or Stripe access when ${gateCase} readiness is disabled.`);
}

async function runSavedMembershipReplayPaid() {
  const { setMock } = require("./lib/rentalTestHarness.cjs");
  const trace = [];
  setMock("../shared/rentalAgreementRelease", { RENTAL_DRAFT_RELEASE_READY: true });
  setMock("./lib/rentalSwapAuthority", { swapAuthorityAvailable: () => true });
  setMock("stripe", { default: class StripeFixture {
    checkout = { sessions: {
      create: async () => ({ id: "cs-membership-replay-paid", status: "complete", payment_status: "paid", url: "https://checkout.stripe.test/completed", amount_total: 10000, currency: "gbp", payment_intent: "pi-membership-replay-paid", metadata: { bookingId: "bookings-saved" } }),
    } };
    paymentIntents = { retrieve: async id => ({ id, status: "succeeded", amount_received: 10000, currency: "gbp" }) };
  } });
  Object.assign(process.env, {
    RENTAL_CHECKOUT_ENABLED: "true", DIDIT_API_KEY: "fixture", DIDIT_WORKFLOW_ID: "fixture", DIDIT_WEBHOOK_SECRET: "fixture",
    DIDIT_APPLICATION_ID: "fixture", DIDIT_ENVIRONMENT: "sandbox", STRIPE_SECRET_KEY: "sk_test_fixture", STRIPE_WEBHOOK_SECRET: "fixture",
    STRIPE_RENTAL_PAYMENT_METHOD_CONFIGURATION_ID: "pmc_fixture", INVOICE_SECRET: "fixture", APP_URL: "https://rental.fixture.invalid",
    BUSINESS_LEGAL_NAME: "DB Cinema Rentals Ltd", BUSINESS_INVOICE_ADDRESS: "Trafalgar Square, London", RESEND_API_KEY: "fixture",
    RESEND_FROM: "DB Cinema Rentals <bookings@dbcinemarentals.com>", SHARED_STOCK_BRIDGE_EXPERIMENTAL: "false",
  });
  const checkout = require("./lib/rentalTestHarness.cjs").load("convex/checkout.ts");
  const requestId = "membership-replay-request-000000000000";
  const args = {
    items: [{ listingId: "listings-fixture", title: "Fixture camera", start: 1_900_000_000_000, end: 1_900_086_400_000, qty: 1, total: 100, deposit: 50 }],
    customer: { email: "renter@example.invalid", name: "Fixture Renter", billingAddress: "123 Fixture Street, London" },
    fulfilment: "pickup", deliveryFee: 0, expectedTotalDue: 100, expectedSavedCardLimit: 100, pickupTime: "10:00", returnTime: "18:00",
    agreement: { name: "Fixture Renter", requestId: "saved-session-gate-fixture-001", securityHoldConsent: true, laterChargeConsent: true, documents: [] },
    selectedMembership: { requestId, intro: "none", tier: "pro" },
  };
  const priorAttempt = { bookingId: "bookings-saved", fingerprintMatches: true, membershipCheckoutId: "membership-checkout-saved" };
  const existing = { _id: "membership-checkout-saved", bookingId: "bookings-saved", state: "creating", tier: "pro", sessionParams: JSON.stringify({ metadata: { bookingId: "bookings-saved" } }) };
  const ctx = {
    runQuery: async ref => {
      trace.push(`query:${ref}`);
      if (ref === "settings.get") return { acceptingOrders: true };
      if (ref === "bookings.checkoutAttempt") return priorAttempt;
      if (ref === "membershipBenefits.byRequest") return existing;
      if (ref === "bookings.assertCheckoutReservation") return true;
      throw Error(`Unexpected query ${ref}`);
    },
    runMutation: async (ref, value) => {
      trace.push(`mutation:${ref}`);
      if (ref === "bookings.recordPaidCheckoutReceipt") return { requiresSavedCard: false, awaitingVerification: true };
      if (ref === "bookings.confirm") return { awaitingVerification: true };
      if (ref === "membershipBenefits.bindCheckout" || ref === "bookings.bindCheckoutSession") return true;
      throw Error(`Unexpected mutation ${ref} ${JSON.stringify(value)}`);
    },
    runAction: async ref => {
      trace.push(`action:${ref}`);
      if (ref === "rmv2_webhook.push") return { ok: true };
      if (ref === "sync.syncHyggloReservations") return { checkedAt: Date.now() };
      throw Error(`Unexpected action ${ref}`);
    },
  };
  const result = await checkout.start.handler(ctx, args);
  assert.deepEqual(result, { bookingId: "bookings-saved", alreadyPaid: true, sessionId: "cs-membership-replay-paid" }, "an idempotent Stripe replay returns paid status, never a completed checkout URL");
  assert.ok(trace.indexOf("mutation:bookings.bindCheckoutSession") < trace.indexOf("mutation:bookings.recordPaidCheckoutReceipt"), "the replayed paid session binds to the rental before its receipt is confirmed");
  assert.ok(trace.includes("mutation:bookings.confirm"), "the payment flow remains pending verification behind the normal confirmation gate");
  console.log("PASS lost-response membership checkout replay reconciles a paid session instead of returning a stale payment link.");
}

async function runReadinessSuite() {
  const checkoutSource = fs.readFileSync(path.join(__dirname, "../convex/checkout.ts"), "utf8");
  const checkoutPageSource = fs.readFileSync(path.join(__dirname, "../src/app/checkout/page.tsx"), "utf8");
  const gatePositions = [
    checkoutSource.indexOf('if (process.env.RENTAL_CHECKOUT_ENABLED !== "true")'),
    checkoutSource.indexOf("if (!RENTAL_DRAFT_RELEASE_READY)"),
    checkoutSource.indexOf("if (!swapAuthorityAvailable())"),
    checkoutSource.indexOf("if (!process.env.DIDIT_API_KEY"),
    checkoutSource.indexOf("if (!process.env.STRIPE_SECRET_KEY?.trim()"),
    checkoutSource.indexOf("const paymentConfigId = process.env.STRIPE_RENTAL_PAYMENT_METHOD_CONFIGURATION_ID?.trim()"),
    checkoutSource.indexOf("!paymentConfigId"),
  ];
  const savedAttemptLookup = checkoutSource.indexOf("internal.bookings.checkoutAttempt");
  assert(gatePositions.every(position => position >= 0 && position < savedAttemptLookup),
    "Checkout, agreement-release, stock-authority, Didit, and mail/payment configuration gates must precede saved-session lookup");
  assert.match(checkoutSource, /if\s*\(!RENTAL_DRAFT_RELEASE_READY\)[\s\S]{0,300}RENTAL_AGREEMENT_REVIEW/,
    "Rental checkout must share the handover release-readiness gate");
  assert.match(checkoutSource, /if\s*\(!swapAuthorityAvailable\(\)\)[\s\S]{0,300}STOCK_SYNC_UNAVAILABLE/,
    "Rental checkout must stop before payment when paid pending-verification stock claims cannot reach Rental Manager");
  assert.match(checkoutSource, /assertRentalBasketTrialAllowed\(a\.selectedMembership\.intro,\s*!!existingMembershipCheckout\)/,
    "New rental-basket membership attempts must use the server trial rule after preserving an existing accepted attempt");

  const { RENTAL_DRAFT_RELEASE_READY } = load("shared/legalDocuments.ts");
  assert.equal(RENTAL_DRAFT_RELEASE_READY, false, "Rental agreement release stays closed until its separate review is complete");
  assert.match(checkoutPageSource, /import \{ RENTAL_DRAFT_RELEASE_READY \} from "\.\.\/\.\.\/\.\.\/shared\/rentalAgreementRelease"/,
    "The renter-facing form shares the same release flag as the server");
  assert.match(checkoutPageSource, /const savedCardQuoteReady = RENTAL_DRAFT_RELEASE_READY &&/,
    "The renter-facing form stays disabled while the server release gate is closed");
  assert.match(checkoutPageSource, /IMMEDIATE_CLAIM_SECURITY_POLICY_VERSION/,
    "The current scaled SetupIntent quote has an explicit UI path once the unchanged release gate is opened");
  assert.match(checkoutPageSource, /savedCardLimit === expectedSetupIntentLimit/,
    "The UI validates the exact £50/£100/£200 or scaled limit against catalog replacement value");
  assert.match(checkoutPageSource, /rental-agreement-checkbox"[^\n]+disabled=\{!savedCardQuoteReady/,
    "A renter cannot accept or sign terms while the shared release gate is closed");
  assert.match(checkoutPageSource, /disabled=\{!draftReady \|\| !savedCardQuoteReady/,
    "The signature field remains disabled until both the draft and exact security quote are ready");
  process.env.RENTAL_CHECKOUT_ENABLED = "true";
  const checkout = load("convex/checkout.ts");
  assert.throws(() => checkout.assertRentalBasketTrialAllowed("trial", false), /only be started from the Memberships page/i,
    "A direct new rental-checkout request cannot obtain the standalone seven-day trial");
  assert.doesNotThrow(() => checkout.assertRentalBasketTrialAllowed("trial", true),
    "An already reserved membership checkout can finish the trial it previously accepted");
  assert.doesNotThrow(() => checkout.assertRentalBasketTrialAllowed("none", false),
    "The normal paid monthly membership option remains available in a rental basket");

  let externalCalls = 0;
  const ctx = {
    runQuery: async () => { externalCalls++; throw Error("query must not run before release readiness"); },
    runMutation: async () => { externalCalls++; throw Error("mutation must not run before release readiness"); },
    runAction: async () => { externalCalls++; throw Error("action must not run before release readiness"); },
  };
  const args = {
    items: [{ listingId: "listings-fixture", title: "Fixture camera", start: 1_900_000_000_000, end: 1_900_086_400_000, qty: 1, total: 100, deposit: 50 }],
    customer: { email: "renter@example.invalid", name: "Fixture Renter", billingAddress: "123 Fixture Street, London" },
    fulfilment: "pickup", deliveryFee: 0, expectedTotalDue: 100, expectedSavedCardLimit: 100, pickupTime: "10:00", returnTime: "18:00",
    agreement: { name: "Fixture Renter", requestId: "saved-session-gate-fixture-001", securityHoldConsent: true, laterChargeConsent: true, documents: [] },
  };
  await assert.rejects(() => checkout.start.handler(ctx, args), error => error?.data?.code === "RENTAL_AGREEMENT_REVIEW" && /basket is saved/i.test(error.message),
    "Checkout explains that the saved basket is preserved while rental handover review is incomplete");
  assert.equal(externalCalls, 0, "A blocked new checkout never reads/writes database, inventory, Didit, or Stripe");

  for (const childCase of ["checkout", "release", "stock", "didit", "didit-capacity", "stripe-key", "payment-config", "payment-webhook", "mail"]) {
    const result = spawnSync(process.execPath, [__filename], {
      encoding: "utf8",
      env: { ...process.env, DBC_CHECKOUT_GATE_CASE: childCase },
    });
    assert.equal(result.status, 0, `${childCase} saved-session gate failed:\n${result.stdout}\n${result.stderr}`);
    process.stdout.write(result.stdout);
  }
  const replay = spawnSync(process.execPath, [__filename], {
    encoding: "utf8",
    env: { ...process.env, DBC_CHECKOUT_GATE_CASE: "membership-replay-paid" },
  });
  assert.equal(replay.status, 0, `Paid membership-session replay failed:\n${replay.stdout}\n${replay.stderr}`);
  process.stdout.write(replay.stdout);
  console.log("PASS checkout remains fail-closed before database, inventory, Didit, or Stripe work. Synthetic data only.");
}

(gateCase ? runSavedSessionGateCase() : runReadinessSuite()).catch(error => {
  console.error(error);
  process.exitCode = 1;
});
