const assert = require('node:assert/strict');
const fs = require('node:fs');
const { load } = require('./lib/rentalTestHarness.cjs');

const legal = load('src/lib/legal.ts');
const documents = load('shared/legalDocuments.ts');
const versioning = load('shared/legalVersioning.ts');
const security = load('shared/rentalSecurity.ts');
const agreement = load('shared/rentalAgreement.ts');
const checkoutSource = fs.readFileSync('convex/checkout.ts', 'utf8');
const legalPageSource = fs.readFileSync('src/app/legal/[slug]/page.tsx', 'utf8');

const checkoutPolicy = security.IMMEDIATE_CLAIM_SECURITY_POLICY_VERSION;
const checkoutDocuments = legal.agreementsForSecurityPolicy(checkoutPolicy);
assert.match(checkoutSource, /SETUP_INTENT_SECURITY_POLICY_ENABLED==="true"\?IMMEDIATE_CLAIM_SECURITY_POLICY_VERSION/,
  'the live checkout setup-intent branch selects the immediate-claim policy');
assert.equal(versioning.legalVersionForPolicy({ setupIntentSecurityEnabled: true }), '2026-11-v34');
assert.equal(legal.IMMEDIATE_CLAIM_LEGAL_VERSION, '2026-11-v34');
assert.equal(checkoutDocuments.find(doc => doc.kind === 'rental-agreement').version, '2026-11-v34');
assert.equal(checkoutDocuments.find(doc => doc.kind === 'terms').version, '2026-11-v34');
assert.equal(legal.agreementsForSecurityPolicy(undefined).find(doc => doc.kind === 'rental-agreement').version, legal.LEGAL_VERSION,
  'the unrelated default legal path is unchanged');

const v30 = documents.LEGAL_ARCHIVE['2026-11-v30'];
const v31 = documents.LEGAL_ARCHIVE['2026-11-v31'];
const v32 = documents.LEGAL_ARCHIVE['2026-11-v32'];
const v33 = documents.LEGAL_ARCHIVE['2026-11-v33'];
const v34 = documents.LEGAL_ARCHIVE['2026-11-v34'];
assert(v30 && v31 && v32 && v33 && v34, 'prior signed versions and the current successor remain addressable');
for (const kind of ['terms', 'rental-terms', 'rental-agreement']) {
  assert.equal(v30[kind].sections.some(section => section.h === 'Verification timing'), false,
    'v30 signed copies are unchanged');
  const previousClause = v31[kind].sections.find(section => section.h === 'Verification timing')?.p;
  const cutoffClause = v32[kind].sections.find(section => section.h === 'Verification timing')?.p;
  const currentClause = v34[kind].sections.find(section => section.h === 'Verification timing')?.p;
  assert(previousClause && cutoffClause && currentClause, `${kind} retains all verification timing clauses`);
  assert.match(previousClause, /Didit must approve the required checks strictly before the two-hour cutoff after the earliest scheduled London pickup time/,
    'v31 remains an immutable copy for renters who accepted it');
  assert.match(cutoffClause, /Didit must complete and approve the required checks before the two-hour cutoff after the earliest scheduled London pickup time/);
  assert.match(cutoffClause, /Approval completed exactly at the cutoff or later does not meet this deadline/,
    'v32 makes the exact cutoff outcome explicit without rewriting v31');
  assert.equal(currentClause, cutoffClause, 'v34 changes cancellation wording only and preserves the accepted v32 verification cutoff');
  for (const clause of [previousClause, cutoffClause, currentClause]) {
    assert.match(clause, /authorised manual override/);
    assert.match(clause, /does not itself cancel the rental or decide any refund or account credit/);
    assert.match(clause, /applicable statutory rights/);
  }
  assert.deepEqual(
    v32[kind].sections.map(section => section.h === 'Verification timing' ? { ...section, p: previousClause } : section),
    v31[kind].sections,
    `${kind} v32 remains the immutable verification-cutoff update from v31`,
  );
}

const accepted = {
  name: 'Fixture Renter',
  securityHoldConsent: true,
  laterChargeConsent: true,
  securityPolicyVersion: checkoutPolicy,
  documents: checkoutDocuments,
};
assert.doesNotThrow(() => agreement.assertCurrentAgreement(accepted, 'pickup'));
const snapshot = JSON.parse(agreement.snapshotAgreement({
  agreementName: accepted.name,
  agreementDocs: checkoutDocuments,
  securityHoldConsent: true,
  laterChargeConsent: true,
  securityPolicyVersion: checkoutPolicy,
  customerName: accepted.name,
  customerEmail: 'fixture@agreement.invalid',
  billingAddress: 'Fixture billing address, London',
  fulfilment: 'pickup',
  pickupTime: '10:00',
  returnTime: '18:00',
  lineItems: [{ listingId: 'fixture-listing', title: 'Camera', start: Date.UTC(2030, 5, 1), end: Date.UTC(2030, 5, 2), qty: 1, lineTotal: 100 }],
  subtotal: 100,
  deliveryFee: 0,
  depositAmount: 0,
  depositHoldAmount: 0,
  currency: 'GBP',
}, Date.UTC(2030, 4, 1), 100, 0));
assert.equal(snapshot.version, '2026-11-v34');
for (const kind of ['terms', 'rental-terms', 'rental-agreement']) {
  const saved = snapshot.documents.find(doc => doc.kind === kind);
  assert.equal(saved.version, '2026-11-v34');
  assert.deepEqual(saved.text, v34[kind], 'new acceptance stores the complete current rendered copy');
  assert(saved.text.sections.some(section => section.h === 'Verification timing'));
}
const v31SnapshotData = JSON.parse(JSON.stringify(snapshot));
v31SnapshotData.version = '2026-11-v31';
for (const document of v31SnapshotData.documents) {
  if (['terms', 'rental-terms', 'rental-agreement'].includes(document.kind)) {
    document.version = '2026-11-v31';
    document.text = v31[document.kind];
  }
}
const v31Snapshot = agreement.readAgreementSnapshot(JSON.stringify(v31SnapshotData));
assert(v31Snapshot, 'a previously stored v31 acceptance remains readable after v32 becomes current');
for (const kind of ['terms', 'rental-terms', 'rental-agreement']) {
  const saved = v31Snapshot.documents.find(document => document.kind === kind);
  assert.equal(saved.version, '2026-11-v31');
  assert.deepEqual(saved.text, v31[kind], 'an existing v31 acceptance continues to snapshot its exact archived copy');
}
assert.match(legalPageSource, /LEGAL_ARCHIVE\[version\]\?\.\[slug\]/,
  'the public legal page renders the selected immutable version');
assert.equal(documents.RENTAL_DRAFT_RELEASE_READY, false,
  'the outstanding legal/operations release gate remains closed');

console.log('PASS late-verification terms: checkout selects v34, retains exact v33/v32/v31/v30 snapshots, preserves the cutoff clause, and leaves default policy and release gate unchanged.');
