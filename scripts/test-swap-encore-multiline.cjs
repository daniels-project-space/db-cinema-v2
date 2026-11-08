const assert = require("node:assert/strict");
const { load, db, put } = require("./lib/rentalTestHarness.cjs");
const { quoteSwapFunding, adjustedSwapCreditBalances } = load("convex/lib/rentalSwapFunding.ts");
const first = { listingId: "first", start: 100, end: 200, qty: 1, lineTotal: 1 };
const second = { listingId: "second", start: 100, end: 200, qty: 1, lineTotal: 99 };
const booking = { pricingVersion: "single-benefit-v1", benefitKind: "loyalty", swapBenefitRule: { version: "encore-percent-v1", percent: 10 }, subtotal: 100, discount: 10, creditApplied: 0, creditAllocations: [], checkoutLineCreditSources: [], lineItems: [first, second], checkoutLineFunding: [
  { listingId: first.listingId, start: 100, end: 200, qty: 1, gross: 1, discount: 1, membershipCredit: 0, accountCredit: 0, card: 0 },
  { listingId: second.listingId, start: 100, end: 200, qty: 1, gross: 99, discount: 9, membershipCredit: 0, accountCredit: 0, card: 90 },
] };
const replacement = { ...first, listingId: "new", lineTotal: 40 };

(async () => {
  const quote = await quoteSwapFunding({ db }, booking, 0, replacement);
  assert.equal(quote.deltaPence, 3510);
  assert.deepEqual(quote.nextAllFunding.map(row => [row.gross, row.discount, row.card]), [[40, 13.9, 26.1], [99, 0, 99]], "Basket discount moves between rows in checkout order");
  const revised = { ...booking, subtotal: 139, discount: 13.9, lineItems: [replacement, second], checkoutLineFunding: quote.nextAllFunding };
  const back = await quoteSwapFunding({ db }, revised, 0, first);
  assert.equal(back.deltaPence, -3510);
  assert.deepEqual(back.nextAllFunding.map(row => [row.gross, row.discount, row.card]), [[1, 1, 0], [99, 9, 90]]);
  const cents = await quoteSwapFunding({ db }, booking, 0, { ...replacement, lineTotal: 0.26 });
  assert.equal(cents.nextAllFunding.reduce((sum, row) => sum + Math.round(row.discount * 100), 0), 993);
  await assert.rejects(quoteSwapFunding({ db }, { ...booking, creditApplied: 1 }, 0, replacement), /cannot be safely repriced/);
  await assert.rejects(quoteSwapFunding({ db }, { ...booking, checkoutLineCreditSources: [{ lineIndex: -1, amount: 1, kind: "refund" }] }, 0, replacement), /credit sources cannot be verified/);
  await assert.rejects(quoteSwapFunding({ db }, { ...booking, checkoutLineFunding: [{ ...booking.checkoutLineFunding[0], discount: 0, card: 1 }, { ...booking.checkoutLineFunding[1], discount: 10, card: 89 }] }, 0, replacement), /allocation cannot be verified/);
  await assert.rejects(quoteSwapFunding({ db }, { ...booking, lineItems: [first, { ...second, end: 300 }] }, 0, replacement), /funding does not balance/);
  const account=put("accounts",{email:"multi-credit@example.invalid"}),credit=put("credits",{accountId:account._id,kind:"refund",currency:"GBP",amount:20,remaining:0});
  const credited={...booking,accountId:account._id,creditApplied:20,membershipCreditApplied:0,earnedCreditApplied:0,refundCreditApplied:20,creditAllocations:[{creditId:credit._id,kind:"refund",amount:20}],checkoutLineCreditSources:[{lineIndex:1,creditId:credit._id,kind:"refund",amount:20}],checkoutLineFunding:[booking.checkoutLineFunding[0],{...booking.checkoutLineFunding[1],accountCredit:20,card:70}]};
  const changed=await quoteSwapFunding({db},credited,0,replacement);
  assert.equal(changed.deltaPence,3510);
  assert.deepEqual(changed.nextAllFunding.map(row=>[row.discount,row.accountCredit,row.card]),[[13.9,20,6.1],[0,0,99]]);
  assert.deepEqual(changed.nextAllCreditSources,[{lineIndex:0,creditId:credit._id,kind:"refund",amount:20}]);
  const low=await quoteSwapFunding({db},credited,1,{...second,listingId:"small",lineTotal:0});
  assert.equal(low.deltaPence,-7000);
  assert.equal(low.restore[0].amountPence,1910);
  assert.deepEqual(low.nextAllCreditSources,[{lineIndex:0,creditId:credit._id,kind:"refund",amount:0.9}]);
  const afterLow={...credited,...adjustedSwapCreditBalances(credited,low.restore),subtotal:1,discount:0.1,lineItems:[first,{...second,listingId:"small",lineTotal:0}],checkoutLineFunding:low.nextAllFunding,checkoutLineCreditSources:low.nextAllCreditSources};
  const repeated=await quoteSwapFunding({db},afterLow,1,{...second,listingId:"another",lineTotal:5});
  assert.equal(repeated.deltaPence,450);
  assert.deepEqual(repeated.nextAllCreditSources,[{lineIndex:0,creditId:credit._id,kind:"refund",amount:0.4},{lineIndex:1,creditId:credit._id,kind:"refund",amount:0.5}]);
  const largeCredit=put("credits",{accountId:account._id,kind:"refund",currency:"GBP",amount:100,remaining:0});
  const deliveryCredit={...credited,subtotal:100,discount:10,deliveryFee:20,creditApplied:100,refundCreditApplied:100,creditAllocations:[{creditId:largeCredit._id,kind:"refund",amount:100}],checkoutLineCreditSources:[{lineIndex:1,creditId:largeCredit._id,kind:"refund",amount:90},{lineIndex:-1,creditId:largeCredit._id,kind:"refund",amount:10}],checkoutLineFunding:[booking.checkoutLineFunding[0],{...booking.checkoutLineFunding[1],accountCredit:90,card:0}]};
  const delivered=await quoteSwapFunding({db},deliveryCredit,1,{...second,listingId:"small",lineTotal:0});
  assert.equal(delivered.restore[0].amountPence,7910);
  assert.deepEqual(delivered.nextAllCreditSources,[{lineIndex:0,creditId:largeCredit._id,kind:"refund",amount:0.9},{lineIndex:-1,creditId:largeCredit._id,kind:"refund",amount:20}]);
  await assert.rejects(quoteSwapFunding({db},{...credited,creditApplied:21,refundCreditApplied:21,creditAllocations:[{creditId:credit._id,kind:"refund",amount:21}]},0,replacement),/allocation cannot be verified/);
  console.log("PASS multi-line Encore swaps: basket discount, spillover, rounding and original credit and delivery source reconciliation");
})().catch(error => { console.error(error); process.exitCode = 1; });
