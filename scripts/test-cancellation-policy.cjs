/** Pure cancellation boundaries and captured-money accounting; no provider calls. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

const policy = { exports: require("./lib/rentalTestHarness.cjs").load("src/lib/cancellationPolicy.ts") };
const { cancelKind, cancellationSettlement, CANCELLATION_FULL_REFUND_DAYS, CANCELLATION_CREDIT_DAYS } = policy.exports;

assert.equal(CANCELLATION_FULL_REFUND_DAYS, 14);
assert.equal(CANCELLATION_CREDIT_DAYS, 365);
const at = (year, month, day, hour = 12) => Date.UTC(year, month - 1, day, hour);

// Local-calendar policy must remain stable across both UK daylight-saving changes.
for (const [now, start] of [
  [at(2026, 3, 15), at(2026, 3, 29)],
  [at(2026, 10, 11), at(2026, 10, 25)],
]) assert.equal(cancelKind(start, now), 'full_refund');
for (const [now, start] of [
  [at(2026, 3, 16), at(2026, 3, 29)],
  [at(2026, 10, 12), at(2026, 10, 25)],
]) assert.equal(cancelKind(start, now), 'store_credit');

const { bookingCancelKind, cancellationDaysForBooking } = policy.exports;
const booking = { lineItems: [{start:at(2026,10,25)}], agreementDocs:[{kind:'cancellation',version:'2026-10-v11'}] };
assert.equal(cancellationDaysForBooking(booking),14);
for (const version of ['2026-10-v12', '2026-10-v13']) {
  const current = {...booking, agreementDocs:[{kind:'cancellation',version}]};
  assert.equal(cancellationDaysForBooking(current),14,'New agreement versions keep the agreed 14-day policy');
  assert.equal(bookingCancelKind(current,at(2026,10,20)),'store_credit','New terms cannot silently restore the old three-day cash window');
}
assert.equal(bookingCancelKind(booking,at(2026,10,11,22)),'full_refund');
assert.equal(bookingCancelKind(booking,at(2026,10,11,23)),'store_credit','London midnight, rather than UTC midnight, closes the window');
assert.equal(bookingCancelKind(booking,at(2026,10,12)),'store_credit');
for(const agreementDocs of [undefined,[{kind:'cancellation',version:'2026-10-v10'}]]) {
  const older={...booking,agreementDocs};
  assert.equal(cancellationDaysForBooking(older),3);
  assert.equal(bookingCancelKind(older,at(2026,10,22)),'full_refund');
  assert.equal(bookingCancelKind(older,at(2026,10,23)),'store_credit');
}
assert.equal(bookingCancelKind({...booking,cancellationPolicyStart:at(2026,10,24)},at(2026,10,11)),'store_credit','A fixed earlier start cannot be bypassed by removing kit');

// A £250 booking: £50 refundable security, £30 redeemed account credit,
// and £220 actually captured on the card. No path refunds more than £220.
assert.deepEqual(cancellationSettlement('full_refund', 22000, 5000, 3000, true),
  { refundPence: 22000, creditPence: 3000 });
assert.deepEqual(cancellationSettlement('store_credit', 22000, 5000, 3000, true),
  { refundPence: 5000, creditPence: 20000 });
// A paid Checkout session cancelled before confirmation has not consumed credit.
assert.deepEqual(cancellationSettlement('full_refund', 22000, 5000, 3000, false),
  { refundPence: 22000, creditPence: 0 });
assert.deepEqual(cancellationSettlement('store_credit', 22000, 5000, 3000, false),
  { refundPence: 5000, creditPence: 17000 });
assert.deepEqual(cancellationSettlement('store_credit', 2000, 5000, 0, true),
  { refundPence: 2000, creditPence: 0 });
for (const invalid of [-1, 1.5, NaN, Infinity]) {
  assert.throws(() => cancellationSettlement('full_refund', invalid, 0, 0, false),
    /Invalid cancellation amount/);
}
console.log('PASS: London cancellation windows, DST, captured-card refund limits, and redeemed-credit restoration.');
