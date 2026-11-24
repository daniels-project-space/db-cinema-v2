const assert = require("node:assert/strict");
const { load } = require("./lib/rentalTestHarness.cjs");
const { upgradedItemPaymentLedger, downgradedItemPaymentLedger } = load("convex/lib/itemPaymentLedger.ts");
const line = (listingId, card) => ({ listingId, qty: 1, card });
const booking = {
  itemPaymentLedgerVersion: 1,
  lineItems: [line("camera", 50), line("lens", 30)],
  checkoutLineFunding: [line("camera", 50), line("lens", 30)],
  itemPaymentLedger: [
    { listingId: "camera", qty: 1, sources: [{ paymentIntentId: "pi_checkout", amountPence: 5000 }] },
    { listingId: "lens", qty: 1, sources: [{ paymentIntentId: "pi_checkout", amountPence: 3000 }] },
  ],
};
const lines = [line("new-camera", 60), line("new-lens", 35)];
const changes = [{ lineIndex: 0, newLine: lines[0] }, { lineIndex: 1, newLine: lines[1] }];
const ledger = upgradedItemPaymentLedger(booking, lines, lines, changes, 1500, "pi_upgrade", 0);
assert.deepEqual(ledger, [
  { listingId: "new-camera", qty: 1, sources: [{ paymentIntentId: "pi_checkout", amountPence: 5000 }, { paymentIntentId: "pi_upgrade", amountPence: 1000 }] },
  { listingId: "new-lens", qty: 1, sources: [{ paymentIntentId: "pi_checkout", amountPence: 3000 }, { paymentIntentId: "pi_upgrade", amountPence: 500 }] },
]);
assert.equal(ledger.flatMap(row => row.sources).filter(source => source.paymentIntentId === "pi_upgrade").reduce((sum, source) => sum + source.amountPence, 0), 1500);
assert.equal(upgradedItemPaymentLedger(booking, lines, lines, changes, 1000, "pi_upgrade", 0), undefined, "a credit-funded or otherwise unbalanced change never invents card provenance");
assert.equal(upgradedItemPaymentLedger(booking, lines, lines, changes, 1500, "pi_upgrade", 1), undefined, "prior refund history requires a provenance-aware settlement");
assert.equal(upgradedItemPaymentLedger(booking, lines, lines, [...changes, changes[0]], 1500, "pi_upgrade", 0), undefined, "duplicate changed indexes cannot reassign a payment");
assert.equal(upgradedItemPaymentLedger(booking, lines, lines, changes, 1500, "pi_checkout", 0), undefined, "a reused provider identity cannot be counted twice");
assert.equal(upgradedItemPaymentLedger({ ...booking, itemPaymentLedger: undefined }, lines, lines, changes, 1500, "pi_upgrade", 0), undefined, "legacy rows without a receipt-bound ledger stay unknown");
const creditOnly={itemPaymentLedgerVersion:1,lineItems:[line('credit-camera',0)],checkoutLineFunding:[line('credit-camera',0)],itemPaymentLedger:[{listingId:'credit-camera',qty:1,sources:[]}]};
assert.deepEqual(upgradedItemPaymentLedger(creditOnly,[line('paid-camera',20)],[line('paid-camera',20)],[{lineIndex:0,newLine:line('paid-camera',20)}],2000,'pi_later',0),[{listingId:'paid-camera',qty:1,sources:[{paymentIntentId:'pi_later',amountPence:2000}]}],'a credit-only original checkout can acquire an item-specific card source later');
const single={...booking,lineItems:[booking.lineItems[0]],checkoutLineFunding:[booking.checkoutLineFunding[0]],itemPaymentLedger:[booking.itemPaymentLedger[0]]};
const lower=[line("lower-camera",20)],refund={_id:'refund-downgrade',status:'succeeded',amountPence:3000,parts:[{paymentIntentId:'pi_checkout',stripeRefundId:'re_downgrade',status:'succeeded',amountPence:3000}]};
assert.deepEqual(downgradedItemPaymentLedger(single,lower,lower,[{lineIndex:0,newLine:lower[0]}],[refund],'refund-downgrade',3000),[{listingId:'lower-camera',qty:1,sources:[{paymentIntentId:'pi_checkout',amountPence:2000}]}]);
assert.equal(downgradedItemPaymentLedger(single,lower,lower,[{lineIndex:0,newLine:lower[0]}],[{...refund,parts:[{...refund.parts[0],status:'pending'}]}],'refund-downgrade',3000),undefined,'a pending provider part cannot reduce source provenance');
assert.equal(downgradedItemPaymentLedger(single,lower,lower,[{lineIndex:0,newLine:lower[0]}],[{...refund,parts:[{...refund.parts[0],paymentIntentId:'pi_foreign'}]}],'refund-downgrade',3000),undefined,'a refund from an unknown payment cannot be attributed to the item');
console.log("PASS item payment provenance: multi-line conservation, shared original source, paid upgrade allocation, malformed and legacy guard.");
