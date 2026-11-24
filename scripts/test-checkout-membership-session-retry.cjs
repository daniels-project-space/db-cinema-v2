const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");

const scenario = process.env.DBC_CHECKOUT_MEMBERSHIP_RETRY_CASE;

async function runCase() {
  const harness = require("./lib/rentalTestHarness.cjs");
  const trace = [];
  const bookingId = "bookings-membership-retry";
  const membershipId = "membership-checkouts-retry";
  const requestId = "membership-request-retry-000000000000";
  const expirationRacesPaid = scenario === "params-no-stock-paid-race";
  const providerPaid = scenario.includes("paid") && !expirationRacesPaid;
  const paymentSession = {
    id: "cs-membership-retry",
    status: providerPaid ? "complete" : scenario.includes("expired") ? "expired" : scenario.includes("pending") ? "complete" : "open",
    payment_status: providerPaid ? "paid" : "unpaid",
    url: "https://checkout.stripe.test/membership-retry",
    metadata: { bookingId: scenario.includes("wrong-metadata") ? "bookings-someone-else" : bookingId },
    amount_total: 10000,
    currency: "gbp",
    payment_intent: providerPaid ? "pi-membership-retry" : undefined,
  };
  const existing = {
    _id: membershipId,
    bookingId: scenario === "unlinked-session" ? undefined : bookingId,
    state: scenario.startsWith("params-") || scenario === "partial-bind" ? "open" : scenario.includes("paid") ? "complete" : scenario.includes("expired") ? "expired" : "open",
    sessionId: scenario.startsWith("params-") || scenario === "partial-bind" ? undefined : paymentSession.id,
    sessionParams: scenario.startsWith("params-") || scenario === "partial-bind"
      ? JSON.stringify({ mode: "subscription", metadata: { bookingId } })
      : undefined,
  };
  const priorAttempt = {
    bookingId,
    sessionId: undefined,
    membershipCheckoutId: membershipId,
    fingerprintMatches: !scenario.includes("changed-quote-session"),
  };
  let bookingSessionId;
  let createCount = 0;
  let retrieveCount = 0;
  let bookingBindCount = 0;
  let failFirstBookingBind = scenario === "partial-bind";
  if (scenario.startsWith("prior-attempt-")) bookingSessionId = paymentSession.id;
  const expectedSession = paymentSession;

  harness.setMock("../shared/legalDocuments", { RENTAL_DRAFT_RELEASE_READY: true });
  harness.setMock("../shared/rentalAgreementRelease", { RENTAL_DRAFT_RELEASE_READY: true });
  harness.setMock("./lib/rentalSwapAuthority", { swapAuthorityAvailable: () => true });
  harness.setMock("./lib/diditCapacity", { assertDiditCheckoutCapacity: async () => { trace.push("didit.capacity"); } });
  harness.setMock("stripe", {
    default: class StripeFixture {
      checkout = {
        sessions: {
          retrieve: async id => {
            trace.push("stripe.retrieve");
            retrieveCount++;
            assert.equal(id, paymentSession.id);
            return expectedSession;
          },
          create: async (params, options) => {
            trace.push("stripe.create");
            createCount++;
            assert.deepEqual(params, JSON.parse(existing.sessionParams));
            assert.equal(options.idempotencyKey, `dbc-member-checkout-${membershipId}`);
            return expectedSession;
          },
          expire: async id => {
            trace.push("stripe.expire");
            assert.equal(id, paymentSession.id);
            return expirationRacesPaid
              ? { ...paymentSession, status: "complete", payment_status: "paid", payment_intent: "pi-membership-retry" }
              : { ...paymentSession, status: "expired" };
          },
        },
      };
      paymentIntents = {
        retrieve: async id => {
          trace.push("stripe.paymentIntent.retrieve");
          assert.equal(id, "pi-membership-retry");
          return { id, status: "succeeded", amount_received: 10000, currency: "gbp" };
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
    SHARED_STOCK_BRIDGE_EXPERIMENTAL: "false",
  });

  const checkout = harness.load("convex/checkout.ts");
  const args = {
    items: [{ listingId: "listings-fixture", title: "Fixture camera", start: 1_900_000_000_000, end: 1_900_086_400_000, qty: 1, total: 100, deposit: 50 }],
    customer: { email: "renter@example.invalid", name: "Fixture Renter", billingAddress: "123 Fixture Street, London" },
    fulfilment: "pickup",
    deliveryFee: 0,
    expectedTotalDue: 100,
    expectedSavedCardLimit: 100,
    pickupTime: "10:00",
    returnTime: "18:00",
    agreement: { name: "Fixture Renter", requestId: "combined-rental-membership-retry-0001", securityHoldConsent: true, laterChargeConsent: true, documents: [] },
    selectedMembership: { requestId, intro: "none", tier: "pro", termsVersion: "membership-v1" },
  };
  const ctx = {
    runQuery: async ref => {
      trace.push(`query:${ref}`);
      if (ref === "settings.get") return { acceptingOrders: true };
      if (ref === "bookings.checkoutAttempt") return scenario === "unlinked-session" || scenario.includes("stale-quote-session") ? null : { ...priorAttempt, sessionId: bookingSessionId };
      if (ref === "membershipBenefits.byRequest") return existing;
      if (ref === "bookings.assertCheckoutReservation") {
        trace.push("reservation.assert");
        if (scenario.includes("no-stock")) throw Error("This checkout no longer has available stock.");
        if (scenario.includes("paid") || scenario.includes("expired") || scenario.includes("pending"))
          throw Error("A committed or terminal provider session must reconcile without requiring an open-session stock hold.");
        return true;
      }
      throw Error(`Unexpected query ${ref}`);
    },
    runMutation: async (ref, value) => {
      trace.push(`mutation:${ref}`);
      if (ref === "membershipBenefits.bindCheckout") {
        assert.equal(String(value.id), membershipId);
        assert.equal(value.sessionId, paymentSession.id);
        assert.equal(String(value.bookingId), bookingId);
        existing.sessionId = value.sessionId;
        existing.state = existing.state === "complete" ? "complete" : "open";
        return true;
      }
      if (ref === "bookings.bindCheckoutSession") {
        assert.equal(String(value.bookingId), bookingId);
        assert.equal(value.sessionId, paymentSession.id);
        bookingBindCount++;
        if (failFirstBookingBind) {
          failFirstBookingBind = false;
          throw Error("Synthetic partial bind failure");
        }
        bookingSessionId = value.sessionId;
        return true;
      }
      if (ref === "bookings.expireUnpaidPending") {
        assert.equal(String(value.bookingId), bookingId);
        assert.equal(value.sessionId, paymentSession.id);
        return true;
      }
      if (ref === "bookings.recordPaidCheckoutReceipt")
        return { requiresSavedCard: false, awaitingVerification: true };
      if (ref === "bookings.confirm") return { confirmed: true };
      throw Error(`Unexpected mutation ${ref} ${JSON.stringify(value)}`);
    },
    runAction: async ref => {
      trace.push(`action:${ref}`);
      if (ref === "rmv2_webhook.push") return { ok: true };
      if (ref === "sync.syncHyggloReservations") return { checkedAt: Date.now() };
      throw Error(`Unexpected action ${ref}`);
    },
  };

  if (scenario === "unlinked-session") {
    await assert.rejects(checkout.start.handler(ctx, args), /not attached to a rental/i);
    assert.equal(retrieveCount, 0, "An unrelated membership-only Session is never returned as a rental checkout URL");
    assert.equal(bookingBindCount, 0);
    console.log("PASS unrelated standalone membership session is not returned from rental checkout.");
    return;
  }

  if (scenario.includes("stale-quote-session")) {
    await assert.rejects(checkout.start.handler(ctx, args), error => error?.data?.code === "CHECKOUT_MEMBERSHIP_SESSION_RETIRED" && error?.data?.freshAcceptanceRequired === false,
      "A fresh agreement request must not receive the Stripe URL attached to an earlier quote");
    assert(trace.includes("stripe.expire"), "The old unpaid Stripe Session is closed before a changed quote can continue");
    assert(trace.includes("mutation:bookings.expireUnpaidPending"), "The old pending booking and membership reservation are released only after the provider confirms expiry");
    assert.equal(bookingBindCount, 1, "The existing booking is only rebound idempotently before stale-session reconciliation");
    assert(!trace.includes("reservation.assert"), "The old reservation is not treated as the current quote's reservation");
    if (scenario.startsWith("params-")) assert.equal(createCount, 1, "Saved Stripe parameters are materialized idempotently before the stale Session is expired");
    console.log("PASS a recreated agreement attempt cannot reuse an old open membership rental Session.");
    return;
  }

  if (scenario.includes("changed-quote-session")) {
    await assert.rejects(checkout.start.handler(ctx, args), error => error?.data?.code === "CHECKOUT_TERMS_CHANGED" && error?.data?.freshAcceptanceRequired === true,
      "A changed checkout fingerprint must retire the old Session and require fresh agreement acceptance");
    assert(trace.includes("stripe.expire"), "The mismatched unpaid Stripe Session is expired before retry");
    assert(trace.includes("mutation:bookings.expireUnpaidPending"), "The mismatched pending booking is released only after Stripe confirms expiry");
    assert(!trace.includes("reservation.assert"), "The stale booking is not treated as the current quote reservation");
    if (scenario.startsWith("params-")) assert.equal(createCount, 1, "Saved Stripe parameters are materialized idempotently before stale-session retirement");
    console.log("PASS a changed checkout fingerprint cannot reuse an old membership rental Session.");
    return;
  }

  if (scenario.includes("wrong-metadata")) {
    await assert.rejects(checkout.start.handler(ctx, args), /does not match the saved booking/i);
    assert.equal(bookingBindCount, 0, "A Stripe Session with foreign booking metadata is never bound or returned");
    assert(!trace.some(event => event === "mutation:bookings.bindCheckoutSession"));
    console.log("PASS membership retry rejects mismatched Stripe booking metadata before binding.");
    return;
  }

  if (scenario.startsWith("prior-attempt-") && !scenario.includes("no-stock")) {
    const result = await checkout.start.handler(ctx, args);
    assert.deepEqual(result, { url: paymentSession.url });
    assert.equal(retrieveCount, 1);
    assert.equal(createCount, 0);
    assert(trace.indexOf("stripe.retrieve") < trace.indexOf("reservation.assert"));
    console.log("PASS previously bound membership checkout checks Stripe before stock and reuses only its existing open Session.");
    return;
  }

  if (scenario.includes("no-stock")) {
    if (scenario === "params-no-stock-paid-race") {
      const result = await checkout.start.handler(ctx, args);
      assert.deepEqual(result, { bookingId, alreadyPaid: true, sessionId: paymentSession.id });
      assert(trace.indexOf("stripe.create") < trace.indexOf("reservation.assert"));
      assert(trace.indexOf("reservation.assert") < trace.indexOf("stripe.expire"));
      assert(trace.indexOf("stripe.expire") < trace.indexOf("mutation:bookings.recordPaidCheckoutReceipt"));
      console.log("PASS a payment racing stock-rejection expiry is recovered and reconciled, not discarded.");
    } else {
      await assert.rejects(checkout.start.handler(ctx, args), error => error?.data?.code === "CHECKOUT_STOCK_REJECTED");
      assert(trace.includes("reservation.assert"));
      assert(trace.includes("stripe.expire"), "Open unpaid checkout is expired when its reservation is gone");
      assert(trace.includes("mutation:bookings.expireUnpaidPending"), "Booking cleanup follows the provider-confirmed expiry");
      assert(!trace.includes("mutation:bookings.recordPaidCheckoutReceipt"));
      if (scenario.startsWith("params-")) {
        assert(trace.indexOf("stripe.create") < trace.indexOf("reservation.assert"), "Saved Stripe idempotency replay is read before deciding inventory is stale");
        assert(bookingSessionId === paymentSession.id, "The provider Session is bound before stale-stock cleanup");
      } else {
        assert(trace.indexOf("stripe.retrieve") < trace.indexOf("reservation.assert"), "Existing provider status is read before deciding inventory is stale");
      }
      console.log("PASS an open unpaid checkout with a stale reservation is closed safely instead of returning a payment URL.");
    }
    return;
  }

  if (scenario === "partial-bind") {
    await assert.rejects(checkout.start.handler(ctx, args), /Synthetic partial bind failure/);
    assert.equal(createCount, 1, "The first request creates one Stripe Checkout Session");
    assert.equal(existing.sessionId, paymentSession.id, "The membership row records the idempotent Stripe result before booking bind failure");
    assert.equal(bookingSessionId, undefined, "The simulated failure leaves the booking unbound");
    const result = await checkout.start.handler(ctx, args);
    assert.deepEqual(result, { url: paymentSession.url }, "Retry recovers the existing open Session and returns its URL");
    assert.equal(createCount, 1, "Retry retrieves the existing provider Session instead of creating another");
    assert.equal(retrieveCount, 1);
    assert.equal(bookingSessionId, paymentSession.id, "The retry repairs the booking-to-Session binding");
    assert(trace.lastIndexOf("mutation:bookings.bindCheckoutSession") > trace.indexOf("stripe.retrieve"));
    assert(trace.lastIndexOf("reservation.assert") > trace.indexOf("stripe.retrieve"), "Open-session stock is checked only after provider identity/state are validated");
    console.log("PASS partial Stripe/membership bind is repaired idempotently without creating a duplicate Session.");
    return;
  }

  const result = scenario.includes("paid")
    ? await checkout.start.handler(ctx, args)
    : scenario.includes("expired")
      ? await assert.rejects(checkout.start.handler(ctx, args), error => error?.data?.code === "CHECKOUT_CLOSED")
      : scenario.includes("pending")
        ? await assert.rejects(checkout.start.handler(ctx, args), error => error?.data?.code === "CHECKOUT_PAYMENT_PENDING")
        : await checkout.start.handler(ctx, args);

  if (scenario.includes("paid")) {
    assert.deepEqual(result, { bookingId, alreadyPaid: true, sessionId: paymentSession.id });
    assert(!trace.includes("reservation.assert"), "Paid reconciliation is not blocked by an open-session hold assertion");
    assert(trace.indexOf("mutation:bookings.bindCheckoutSession") < trace.indexOf("mutation:bookings.recordPaidCheckoutReceipt"), "Booking binding precedes payment receipt reconciliation");
    assert(trace.includes("mutation:bookings.confirm"), "Paid rental continues through the normal verification/stock confirmation flow");
    console.log("PASS already-paid membership Session is bound and reconciled instead of returning a payment URL.");
  } else if (scenario.includes("expired")) {
    assert(!trace.includes("reservation.assert"), "Expired unpaid sessions are reconciled without requiring the live open-session reservation");
    assert(trace.indexOf("mutation:bookings.bindCheckoutSession") < trace.indexOf("mutation:bookings.expireUnpaidPending"));
    assert(!trace.includes("stripe.expire"), "An already-expired provider Session is not expired twice");
    console.log("PASS expired unpaid membership Session closes the local checkout after binding its provider receipt.");
  } else if (scenario.includes("pending")) {
    assert(!trace.includes("reservation.assert"), "Indeterminate complete/unpaid sessions are preserved for reconciliation");
    assert(!trace.includes("mutation:bookings.expireUnpaidPending"));
    assert(!trace.includes("mutation:bookings.confirm"));
    console.log("PASS complete/unpaid membership Session remains pending and cannot be paid twice.");
  } else {
    assert.deepEqual(result, { url: paymentSession.url });
    assert.equal(retrieveCount, 0);
    assert.equal(createCount, 1);
    assert(trace.indexOf("mutation:bookings.bindCheckoutSession") < trace.length);
    assert(trace.includes("reservation.assert"), "Only an open unpaid Session requires a fresh saved stock reservation before returning its URL");
    console.log("PASS saved-params open Session is checked, bound to the rental, then returned.");
  }
}

async function runSuite() {
  const cases = [
    "partial-bind",
    "session-paid",
    "session-expired",
    "session-pending",
    "session-wrong-metadata",
    "params-open",
    "params-paid",
    "params-pending",
    "params-wrong-metadata",
    "session-no-stock",
    "prior-attempt-open",
    "prior-attempt-no-stock",
    "params-no-stock",
    "params-no-stock-paid-race",
    "unlinked-session",
    "stale-quote-session",
    "params-stale-quote-session",
    "changed-quote-session",
    "params-changed-quote-session",
  ];
  for (const childCase of cases) {
    const result = spawnSync(process.execPath, [__filename], {
      encoding: "utf8",
      env: { ...process.env, DBC_CHECKOUT_MEMBERSHIP_RETRY_CASE: childCase },
    });
    assert.equal(result.status, 0, `${childCase} failed:\n${result.stdout}\n${result.stderr}`);
    process.stdout.write(result.stdout);
  }
  console.log("PASS combined rental/membership checkout Session retry invariants; synthetic Stripe and database only.");
}

(scenario ? runCase() : runSuite()).catch(error => {
  console.error(error);
  process.exitCode = 1;
});
