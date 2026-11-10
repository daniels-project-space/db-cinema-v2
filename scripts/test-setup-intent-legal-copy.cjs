const assert = require("node:assert/strict");
const fs = require("node:fs");
const { load } = require("./lib/rentalTestHarness.cjs");

const { LEGAL_ARCHIVE } = load("shared/legalDocuments.ts");
const agreement = LEGAL_ARCHIVE["2026-11-v20"];
const newAgreement = LEGAL_ARCHIVE["2026-11-v21"];
const immediateAgreement = LEGAL_ARCHIVE["2026-11-v22"];
const currentAgreement = LEGAL_ARCHIVE["2026-11-v23"];
const rentalSecurityHeading = agreement["rental-terms"].sections.find(section => section.h.startsWith("2."))?.h;
assert.equal(rentalSecurityHeading, "2. Saved-card security claims");

const agreementText = Object.values(agreement).flatMap(document => document.sections.map(section => `${section.h} ${section.p}`)).join("\n");
assert(!agreementText.includes("New rentals use a Stripe card authorisation hold"));
assert(!agreementText.includes("Security payment and hold"));
assert(agreement.terms.sections.find(section => section.h === "Cancellation and refunds").p.includes("Cancelling seven or fewer London calendar days"));
const newCancellation = newAgreement.cancellation.sections.find(section => section.h === "Your cancellation").p;
const immediateCancellation = immediateAgreement.cancellation.sections.find(section => section.h === "Your cancellation").p;
const currentCancellation = currentAgreement.cancellation.sections.find(section => section.h === "Your cancellation").p;
assert.match(newCancellation, /full refund.*100% of that remaining rental value as account credit/);
assert.match(newCancellation, /more than 48 hours.*account credit only/);
assert.match(newCancellation, /48 hours or less.*no rental refund and no account credit/);
assert.equal(immediateCancellation, newCancellation, "v22 retains the v21 cancellation boundary already accepted by renters");
assert.match(currentCancellation, /cancelling seven or more London calendar days before the earliest equipment start/);
assert.match(currentCancellation, /more than 48 hours but fewer than seven London calendar days before the earliest equipment start/);
assert.match(currentCancellation, /48 hours or less.*no rental refund and no account credit/);
for(const kind of ["terms","rental-terms","rental-agreement","cancellation"]){
 const section=currentAgreement[kind].sections.find(section=>section.h===(kind==="cancellation"?"Your cancellation":"Cancellation and refunds"));
 assert.match(section.p,/seven or more London calendar days/);
}
const newClaimText = Object.values(newAgreement).flatMap(document => document.sections.map(section => section.p)).join(" ");
assert.match(newClaimText, /allow at least seven days to query or dispute/);
assert.match(newAgreement.terms.sections.find(section => section.h === "Free cancellation protection").p, /rejected or restricted/);
const oldClaimText = Object.values(agreement).flatMap(document => document.sections.map(section => section.p)).join(" ");
assert.match(oldClaimText, /at least seven days to query or dispute/);
const immediateClaimText = currentAgreement["deposit-agreement"].sections.map(section => section.p).join(" ");
assert.match(immediateClaimText, /one off-session collection attempt using the saved card/);
assert.match(immediateClaimText, /may happen immediately after notice/);
assert.doesNotMatch(immediateClaimText, /at least seven days/);
const membershipPage = fs.readFileSync("src/app/legal/membership/page.tsx", "utf8");
const v22MembershipCopy = membershipPage.slice(membershipPage.indexOf("if(setupIntentPolicy){"));
assert.match(v22MembershipCopy, /sends itemised notice, and may make one immediate attempt within 30 days after return/);
assert.doesNotMatch(v22MembershipCopy, /allow at least seven days to dispute/);
assert.doesNotMatch(v22MembershipCopy, /new rental deposit exemption/i);
assert.doesNotMatch(v22MembershipCopy, /upfront refundable security payment, applicable card hold/i);
const sharedMembership = fs.readFileSync("shared/membership.ts", "utf8");
assert.doesNotMatch(sharedMembership, /Refundable deposit waived on qualifying rentals/);
assert.doesNotMatch(sharedMembership, /No separate card hold under the current policy/);
assert.match(sharedMembership, /Monthly rental credit \(plan bonus\)/);
const { assertAgreementBeforeRelease } = load("shared/rentalAgreement.ts");
const { SETUP_INTENT_SECURITY_POLICY_VERSION } = load("shared/rentalSecurity.ts");
const historicAgreement = {
  agreementName: "Test Renter",
  agreementSignedAt: 123,
  agreementDocs: [{ kind: "rental-agreement", version: "2026-11-v20" }],
  agreementSnapshot: JSON.stringify({
    format: 1,
    version: "2026-11-v20",
    signer: "Test Renter",
    acceptedAt: 123,
    documents: [{ kind: "rental-agreement", version: "2026-11-v20", text: { sections: [] } }],
    particulars: { timeZone: "Europe/London", lineItems: [] },
  }),
  securityPolicyVersion: SETUP_INTENT_SECURITY_POLICY_VERSION,
  securityHoldConsentAt: 123,
  laterChargeConsentAt: 123,
};
assert.throws(() => assertAgreementBeforeRelease(historicAgreement), /Broker, legal and operational review/, "A previously signed v20 agreement passes its historical copy check after v21 is introduced");

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
assert(copy.includes("isSetupIntentSecurityPolicy"));
assert(copy.includes("setupIntentPolicy"));
console.log("PASS current saved-card agreement, cancellation, return and rental-update copy; historic versions remain intact.");
