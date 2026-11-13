const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { load } = require("./lib/rentalTestHarness.cjs");

const checkoutSource = fs.readFileSync(path.join(__dirname, "../convex/checkout.ts"), "utf8");
assert.match(checkoutSource, /if\s*\(!RENTAL_DRAFT_RELEASE_READY\)[\s\S]{0,300}RENTAL_AGREEMENT_REVIEW/,
  "Rental checkout must share the handover release-readiness gate");
assert.match(checkoutSource, /assertRentalBasketTrialAllowed\(a\.selectedMembership\.intro,\s*!!existingMembershipCheckout\)/,
  "New rental-basket membership attempts must use the server trial rule after preserving an existing accepted attempt");

const { RENTAL_DRAFT_RELEASE_READY } = load("shared/legalDocuments.ts");
if (RENTAL_DRAFT_RELEASE_READY) {
  console.log("PASS checkout still contains the release-readiness guard; live checkout scenario requires an approved agreement fixture.");
  process.exit(0);
}

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
  runQuery: async () => { externalCalls++; throw new Error("query must not run before release readiness"); },
  runMutation: async () => { externalCalls++; throw new Error("mutation must not run before release readiness"); },
  runAction: async () => { externalCalls++; throw new Error("action must not run before release readiness"); },
};
const args = {
  items: [{ qty: 1, start: Date.now(), end: Date.now() + 86_400_000 }],
  name: "Synthetic renter",
  securityHoldConsent: false,
  laterChargeConsent: false,
  documents: [],
};

(async () => {
  await assert.rejects(
    () => checkout.start.handler(ctx, args),
    error => error?.data?.code === "RENTAL_AGREEMENT_REVIEW" && /basket is saved/i.test(error.message),
    "Checkout explains that the saved basket is preserved while rental handover review is incomplete",
  );
  assert.equal(externalCalls, 0, "A blocked rental never reads/writes inventory or creates a payment session");
  console.log("PASS checkout blocks before database, inventory, and Stripe work while release readiness is false. Synthetic data only.");
})().catch(error => { console.error(error); process.exitCode = 1; });
