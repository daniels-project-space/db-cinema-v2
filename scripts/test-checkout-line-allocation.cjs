const assert = require("node:assert/strict");
const { load } = require("./lib/rentalTestHarness.cjs");
const { checkoutLineAllocation, checkoutCreditSources } = load("shared/checkoutLineAllocation.ts");
const { allocateSaving } = load("shared/membership.ts");

for (const rental of [[100, 50], [0, 11.23, 40.75], [10]]) {
  for (const delivery of [[], [25], [10, 18]]) {
    for (const discount of [0, 5, 75, 200]) {
      for (const membership of [0, 12, 75]) {
        for (const credit of [0, 7, 60, 500]) {
          const result = checkoutLineAllocation(rental, delivery, discount, membership, credit);
          const previous = allocateSaving([...allocateSaving(rental, discount + membership), ...delivery], credit);
          assert.deepEqual(result.map((line) => line.card), previous);
          for (const line of result) {
            assert.equal(Math.round(line.gross * 100), Math.round((line.discount + line.membershipCredit + line.accountCredit + line.card) * 100));
            assert(Object.values(line).every((amount) => amount >= 0));
          }
        }
      }
    }
  }
}
assert.deepEqual(checkoutCreditSources([{accountCredit: 12}, {accountCredit: 8}], [
  {creditId: "refund-credit", amount: 5, kind: "refund"},
  {creditId: "earned-credit", amount: 15, kind: "earned"},
]), [
  {lineIndex: 0, creditId: "refund-credit", amount: 5, kind: "refund"},
  {lineIndex: 0, creditId: "earned-credit", amount: 7, kind: "earned"},
  {lineIndex: 1, creditId: "earned-credit", amount: 8, kind: "earned"},
]);
assert.throws(() => checkoutCreditSources([{accountCredit: 5}], []), /do not match/);
assert.throws(() => checkoutCreditSources([], [{creditId: "extra", amount: 1, kind: "earned"}]), /exceed/);
console.log("PASS checkout allocation preserves charged amounts and separates discounts, membership credit and account credit per line.");
