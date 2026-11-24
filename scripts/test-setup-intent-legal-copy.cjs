const assert = require("node:assert/strict");
const fs = require("node:fs");
const { load } = require("./lib/rentalTestHarness.cjs");

const { LEGAL_ARCHIVE } = load("shared/legalDocuments.ts");
const security = load("shared/rentalSecurity.ts");
const legal = load("src/lib/legal.ts");
const agreement = LEGAL_ARCHIVE["2026-11-v20"];
const newAgreement = LEGAL_ARCHIVE["2026-11-v21"];
const immediateAgreement = LEGAL_ARCHIVE["2026-11-v22"];
const previousCurrentAgreement = LEGAL_ARCHIVE["2026-11-v23"];
const previousCompanyAgreement = LEGAL_ARCHIVE["2026-11-v24"];
const previousBookingAgreement = LEGAL_ARCHIVE["2026-11-v25"];
const historicalScaledAgreement = LEGAL_ARCHIVE["2026-11-v26"];
const currentAgreement = LEGAL_ARCHIVE["2026-11-v27"];
const previousAgreement = LEGAL_ARCHIVE["2026-11-v28"];
const selectedAgreement = LEGAL_ARCHIVE["2026-11-v29"];
const currentLegalAgreement = LEGAL_ARCHIVE[legal.IMMEDIATE_CLAIM_LEGAL_VERSION];
assert.deepEqual(Object.keys(currentAgreement).sort(), Object.keys(historicalScaledAgreement).sort(), "v27 retains every v26 agreement document");
for (const kind of Object.keys(historicalScaledAgreement)) {
  assert.equal(currentAgreement[kind].sections.length, historicalScaledAgreement[kind].sections.length, `v27 retains every ${kind} section`);
  for (let index = 0; index < historicalScaledAgreement[kind].sections.length; index++) {
    const prior = historicalScaledAgreement[kind].sections[index];
    const current = currentAgreement[kind].sections[index];
    const heading = kind === "cancellation" ? "Your cancellation" : "Cancellation and refunds";
    if (["terms", "rental-terms", "rental-agreement", "cancellation"].includes(kind) && prior.h === heading) {
      assert.equal(current.p, prior.p.replace("gives no rental refund and no account credit.", "gives no rental refund and no account credit; exactly 48 hours is included in this no-refund window."), `v27 only clarifies the exact boundary in ${kind}`);
    } else {
      assert.deepEqual(current, prior, `v27 preserves v26 ${kind} section ${prior.h}`);
    }
  }
}
const currentSecurityPolicy = security.IMMEDIATE_CLAIM_SECURITY_POLICY_VERSION;
const newlyRequiredAgreements = legal.agreementsForSecurityPolicy(currentSecurityPolicy);
for (const kind of ["terms", "rental-terms", "rental-agreement", "cancellation"])
  assert.equal(newlyRequiredAgreements.find(document => document.kind === kind)?.version, legal.IMMEDIATE_CLAIM_LEGAL_VERSION, `new ${kind} agreements use the current scaled-claim agreement`);
const currentSecurityTerms = Object.values(currentLegalAgreement).flatMap(document => document.sections.map(section => `${section.h} ${section.p}`)).join("\n");
assert.match(currentLegalAgreement["deposit-agreement"].sections[0].p, /No security deposit is charged and no funds are reserved at checkout or pickup/);
assert.match(currentSecurityTerms, /increases continuously by £100 for each additional £1,000.*proportionally to the penny/);
assert.match(currentSecurityTerms, /specific permitted reason, evidence and amount/);
assert.match(currentSecurityTerms, /final itemised claim invoice.*supporting evidence/);
assert.match(currentSecurityTerms, /one off-session collection attempt/);
assert.match(currentSecurityTerms, /No amount is automatically charged for an on-time return without a reported issue/);
assert.match(currentSecurityTerms, /Stripe securely saves the payment method/);
assert.match(currentLegalAgreement.terms.sections.find(section => section.h === "Verification timing").p, /before the two-hour cutoff after the earliest scheduled London pickup time/);
assert.match(currentLegalAgreement.terms.sections.find(section => section.h === "Verification timing").p, /Approval completed exactly at the cutoff or later does not meet this deadline/);
for (const [value, expected] of [
  [0, 50], [999.99, 50], [1000, 100], [3999.99, 100],
  [4000, 200], [4500, 250], [5000, 300],
]) {
  assert.equal(security.immediateClaimSecurityLimit(value), expected, `current ceiling for £${value}`);
  assert.equal(security.cardLimitForPolicy(currentSecurityPolicy, value), expected, `booked claim ceiling for £${value}`);
}
assert.equal(security.setupIntentSecurityLimit(4500), 200, "historical flat SetupIntent policy remains unchanged");
for (const [value, expected] of [[4000.01, 200], [4000.5, 200.05], [4099.99, 210], [4100, 210]]) {
  assert.equal(security.immediateClaimSecurityLimit(value), expected, `scaled current claim ceiling at £${value}`);
  assert.equal(security.cardLimitForPolicy(currentSecurityPolicy, value), expected, `authoritative booked limit at £${value}`);
}
const rentalSecurityHeading = agreement["rental-terms"].sections.find(section => section.h.startsWith("2."))?.h;
assert.equal(rentalSecurityHeading, "2. Saved-card security claims");

const agreementText = Object.values(agreement).flatMap(document => document.sections.map(section => `${section.h} ${section.p}`)).join("\n");
assert(!agreementText.includes("New rentals use a Stripe card authorisation hold"));
assert(!agreementText.includes("Security payment and hold"));
assert(agreement.terms.sections.find(section => section.h === "Cancellation and refunds").p.includes("Cancelling seven or fewer London calendar days"));
const newCancellation = newAgreement.cancellation.sections.find(section => section.h === "Your cancellation").p;
const immediateCancellation = immediateAgreement.cancellation.sections.find(section => section.h === "Your cancellation").p;
const currentCancellation = selectedAgreement.cancellation.sections.find(section => section.h === "Your cancellation").p;
const previousBookingTerms = previousCompanyAgreement.terms.sections.find(section => section.h === "2. Bookings").p;
const currentBookingTerms = selectedAgreement.terms.sections.find(section => section.h === "2. Bookings").p;
assert.match(previousBookingTerms, /A booking is confirmed once payment is taken/, "signed v24 wording remains archived unchanged");
assert.doesNotMatch(currentBookingTerms, /confirmed once payment is taken/i, "new agreements must not say payment alone confirms a rental");
assert.match(currentBookingTerms, /payment has been recorded and the required identity verification has passed/);
assert.match(currentBookingTerms, /Until both requirements are met, the rental remains pending/);
assert.match(currentBookingTerms, /invoice and exact collection address only after approval/);
assert.match(newCancellation, /full refund.*100% of that remaining rental value as account credit/);
assert.match(newCancellation, /more than 48 hours.*account credit only/);
assert.match(newCancellation, /48 hours or less.*no rental refund and no account credit/);
assert.equal(immediateCancellation, newCancellation, "v22 retains the v21 cancellation boundary already accepted by renters");
assert.match(currentCancellation, /cancelling seven or more London calendar days before the earliest equipment start/);
assert.match(currentCancellation, /at least 48 hours before the scheduled London pickup time, but fewer than seven London calendar days before the earliest equipment start/);
assert.match(currentCancellation, /scheduled London pickup time.*account credit only/);
assert.match(previousAgreement.cancellation.sections.find(section => section.h === "Your cancellation").p, /at least 48 hours but fewer than seven London calendar days before the earliest equipment start/);
assert.match(currentCancellation, /less than 48 hours.*no rental refund and no account credit/);
assert.match(currentCancellation, /Exactly 48 hours.*account-credit-only window/);
assert.doesNotMatch(currentCancellation, /48 hours or less.*no rental refund and no account credit/);
assert.match(currentAgreement.cancellation.sections.find(section => section.h === "Your cancellation").p, /exactly 48 hours is included in this no-refund window/);
assert.doesNotMatch(historicalScaledAgreement.cancellation.sections.find(section => section.h === "Your cancellation").p, /exactly 48 hours is included/);
const previousCompanyCancellation = previousCurrentAgreement.terms.sections.find(section => section.h === "Free cancellation protection").p;
const currentCompanyCancellation = selectedAgreement.terms.sections.find(section => section.h === "Free cancellation protection").p;
assert.match(previousCompanyCancellation, /because equipment is unexpectedly unavailable/);
assert.match(currentCompanyCancellation, /cancels your confirmed rental before pickup for any reason/);
assert.match(currentCompanyCancellation, /130%.*rejected or restricted/);
assert.equal(currentCompanyCancellation, previousCompanyAgreement.terms.sections.find(section => section.h === "Free cancellation protection").p, "v29 preserves v24's company cancellation protection wording");
assert.equal(previousBookingAgreement.terms.sections.find(section => section.h === "2. Bookings").p, selectedAgreement.terms.sections.find(section => section.h === "2. Bookings").p, "v29 preserves v25's booking-confirmation wording");
for(const kind of ["terms","rental-terms","rental-agreement","cancellation"]){
 const section=selectedAgreement[kind].sections.find(section=>section.h===(kind==="cancellation"?"Your cancellation":"Cancellation and refunds"));
 assert.match(section.p,/seven or more London calendar days/);
}
const newClaimText = Object.values(newAgreement).flatMap(document => document.sections.map(section => section.p)).join(" ");
assert.match(newClaimText, /allow at least seven days to query or dispute/);
assert.match(newAgreement.terms.sections.find(section => section.h === "Free cancellation protection").p, /rejected or restricted/);
const oldClaimText = Object.values(agreement).flatMap(document => document.sections.map(section => section.p)).join(" ");
assert.match(oldClaimText, /at least seven days to query or dispute/);
const immediateClaimText = selectedAgreement["deposit-agreement"].sections.map(section => section.p).join(" ");
assert.match(immediateClaimText, /one off-session collection attempt using the saved card/);
assert.match(immediateClaimText, /DB may decide at its discretion whether to pursue a permitted claim/);
assert.match(immediateClaimText, /final itemised claim invoice describing.*including supporting evidence/);
assert.match(immediateClaimText, /increases continuously by £100 for each additional £1,000.*proportionally to the penny/);
assert.equal(selectedAgreement["deposit-agreement"].sections.find(section => section.h === "2. Future-claim ceiling and permitted reasons").p,
  historicalScaledAgreement["deposit-agreement"].sections.find(section => section.h === "2. Future-claim ceiling and permitted reasons").p,
  "v29 carries the v26 scaled claim-cap agreement forward unchanged");
assert.doesNotMatch(LEGAL_ARCHIVE["2026-11-v25"]["deposit-agreement"].sections.map(section=>section.p).join(" "), /DB may decide at its discretion/);
assert.doesNotMatch(immediateClaimText, /at least seven days/);
const membershipPage = fs.readFileSync("src/app/legal/membership/page.tsx", "utf8");
const v22MembershipCopy = membershipPage.slice(membershipPage.indexOf("if(setupIntentPolicy){"));
assert.match(v22MembershipCopy, /Above £4,000, it rises continuously by £100 for each additional £1,000/);
assert.match(v22MembershipCopy, /final itemised invoice describing.*supporting evidence/);
assert.doesNotMatch(v22MembershipCopy, /allow at least seven days to dispute/);
assert.doesNotMatch(v22MembershipCopy, /new rental deposit exemption/i);
assert.doesNotMatch(v22MembershipCopy, /upfront refundable security payment, applicable card hold/i);
const bookingPanel = fs.readFileSync("src/components/booking/BookingPanel.tsx", "utf8");
assert.match(bookingPanel, /The exact amount and terms are shown in checkout before you pay\./);
assert.doesNotMatch(bookingPanel, /£100 from £1,000 to below £4,000|£100 up to £4,000/);
const gafferTools = fs.readFileSync("src/components/gaffer/useGafferTools.ts", "utf8");
assert.match(gafferTools, /immediateClaimSecurityLimit\(cart\.depositTotal\)/);
assert.doesNotMatch(gafferTools, /setupIntentSecurityLimit\(cart\.depositTotal\)/);
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
const historicV26Agreement = {
  ...historicAgreement,
  securityPolicyVersion: currentSecurityPolicy,
  agreementDocs: [{ kind: "rental-agreement", version: "2026-11-v26" }],
  agreementSnapshot: JSON.stringify({
    format: 1, version: "2026-11-v26", signer: "Test Renter", acceptedAt: 123,
    documents: [{ kind: "rental-agreement", version: "2026-11-v26", text: { sections: [] } }],
    particulars: { timeZone: "Europe/London", lineItems: [] },
  }),
};
assert.throws(() => assertAgreementBeforeRelease(historicV26Agreement), /Broker, legal and operational review/, "a previously signed v26 agreement remains valid under the same scaled-security policy");

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
const historicHoldStatement = returnStatementEmail({
  number: "DBC-HOLD-TEST", issuedAt: 0, actualReturnedAt: 0, supplierName: "DB Cinema Rentals Ltd",
  customerEmail: "test@example.invalid", lineItems: [], subtotal: 0, discount: 0, deliveryFee: 0,
  creditApplied: 0, checkoutPaid: 0, securityPaid: 0, securityRefunded: 0, holdAmount: 50,
  holdStatus: "released", damageTotal: 0, damageFromHold: 0, lateAssessed: 0, lateWaived: 0,
  lateBreakdown: [], securityPolicyVersion: "2026-11-card-hold-v1",
}).html;
assert(historicHoldStatement.includes("Temporary card authorisation hold: £50.00"));
assert(historicHoldStatement.includes("cancelled without a charge"));
assert(!historicHoldStatement.includes("No security payment or card hold was taken"));
const invoiceSource = fs.readFileSync("src/lib/invoice/InvoiceDocument.tsx", "utf8");
assert(invoiceSource.includes("isCardHoldSecurityPolicy(data.securityPolicyVersion)"));
assert(invoiceSource.includes("Temporary card authorisation · {data.holdStatus??\"status not recorded\"}"));

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
