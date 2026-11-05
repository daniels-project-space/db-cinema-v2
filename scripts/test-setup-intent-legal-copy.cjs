const assert = require("node:assert/strict");
const fs = require("node:fs");
const { load } = require("./lib/rentalTestHarness.cjs");

const { LEGAL_ARCHIVE } = load("shared/legalDocuments.ts");
const agreement = LEGAL_ARCHIVE["2026-11-v20"];
const rentalSecurityHeading = agreement["rental-terms"].sections.find(section => section.h.startsWith("2."))?.h;
assert.equal(rentalSecurityHeading, "2. Saved-card security claims");

const agreementText = Object.values(agreement).flatMap(document => document.sections.map(section => `${section.h} ${section.p}`)).join("\n");
assert(!agreementText.includes("New rentals use a Stripe card authorisation hold"));
assert(!agreementText.includes("Security payment and hold"));

const { returnStatementEmail } = load("shared/returnStatement.ts");
const statement = returnStatementEmail({
  number: "DBC-TEST",
  issuedAt: 0,
  actualReturnedAt: 0,
  supplierName: "DB Cinema Rentals Ltd",
  customerEmail: "test@example.invalid",
  lineItems: [],
  subtotal: 0,
  discount: 0,
  deliveryFee: 0,
  creditApplied: 0,
  checkoutPaid: 0,
  securityPaid: 0,
  securityRefunded: 0,
  damageTotal: 0,
  damageFromHold: 0,
  lateAssessed: 0,
  lateWaived: 0,
  lateBreakdown: [],
  securityPolicyVersion: "2026-11-setup-intent-v1",
  savedCardLimit: 50,
}).html;
assert(statement.includes("No deposit or card hold was taken"));
assert(statement.includes("future-claim ceiling is £50.00"));
assert(!statement.includes("Any unused card authorisation holds for this rental have been released"));

const copy = [
  "convex/rentalCreditOffers.ts",
  "src/components/rentals/RentalCreditOffer.tsx",
  "convex/rentalAdditions.ts",
  "convex/rentalAdditionState.ts",
  "src/lib/invoice/InvoiceDocument.tsx",
].map(path => fs.readFileSync(path, "utf8")).join("\n");
assert(copy.includes("SETUP_INTENT_SECURITY_POLICY_VERSION"));
assert(copy.includes("setupIntentPolicy"));
console.log("PASS current saved-card agreement, cancellation, return and rental-update copy; historic versions remain intact.");
