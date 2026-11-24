const assert = require("node:assert/strict");
const { load, db } = require("./lib/rentalTestHarness.cjs");
const { createPending } = load("convex/bookings.ts");
const { priceQuote, start } = load("convex/checkout.ts");
const { agreementRequestFingerprint } = load("shared/rentalAgreement.ts");
const original = { listingId: "kit", title: "Camera kit", qty: 1, start: 1, end: 2, lineTotal: 100 };
const selection = { original: "declared:lens-f4", replacement: "gm-lens", priceAdjustmentPence: 500, consent: true };
const proposed = { lineItems: [{ ...original, componentReplacement: selection }], agreementRequestId: "acceptance-fixture-0001", fulfilment: "pickup" };
(async () => {
  for (const handler of [priceQuote, start]) {
    assert.equal(handler.args.items.element.fields.componentReplacement, undefined, "Public checkout must not accept incomplete component substitutions");
    assert.equal(handler.args.items.element.fields.resolvedPhysicalDemands, undefined, "Public checkout must not accept physical stock claims");
  }
  assert.equal(createPending.args.lineItems.element.fields.componentReplacement, undefined, "Booking validation must remain closed until the allocation lifecycle is complete");
  for (const changed of [
    { ...selection, replacement: "other-lens" }, { ...selection, priceAdjustmentPence: 600 }, { ...selection, consent: false },
  ]) assert.notEqual(agreementRequestFingerprint(proposed), agreementRequestFingerprint({ ...proposed, lineItems: [{ ...original, componentReplacement: changed }] }));
  assert.equal(agreementRequestFingerprint(proposed), agreementRequestFingerprint({ fulfilment: "pickup", agreementRequestId: "acceptance-fixture-0001", lineItems: [{ ...original, componentReplacement: selection }] }));
  await assert.rejects(createPending.handler({ db }, proposed), /substitutions are not available/i);
  console.log("PASS component replacement consent gate: selection affects agreement fingerprint; unsupported booking fails closed");
})().catch(error => { console.error(error); process.exitCode = 1; });
