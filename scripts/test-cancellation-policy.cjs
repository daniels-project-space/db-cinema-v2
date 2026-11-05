/** Pure cancellation boundaries and captured-money accounting; no provider calls. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

const source = fs.readFileSync(path.join(__dirname, '../src/lib/cancellationPolicy.ts'), 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText;
const policy = { exports: {} };
new Function('module', 'exports', compiled)(policy, policy.exports);
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
assert.equal(bookingCancelKind(booking,at(2026,10,11,22)),'full_refund');
assert.equal(bookingCancelKind(booking,at(2026,10,11,23)),'store_credit','London midnight, rather than UTC midnight, closes the window');
assert.equal(bookingCancelKind(booking,at(2026,10,12)),'store_credit');
for(const version of ['2026-10-v13','2026-10-v14','2026-10-v15','2026-11-v17']){
 const signed={...booking,agreementDocs:[{kind:'cancellation',version}]};
 assert.equal(cancellationDaysForBooking(signed),14,'The archived signed text governs each historical version');
 assert.equal(bookingCancelKind(signed,at(2026,10,11)),'full_refund');
 assert.equal(bookingCancelKind(signed,at(2026,10,12)),'store_credit');
}
const seven={...booking,agreementDocs:[{kind:'cancellation',version:'2026-10-v16'}]};
assert.equal(cancellationDaysForBooking(seven),7);
const currentSeven={...booking,agreementDocs:[{kind:'cancellation',version:'2026-11-v18'}]};
assert.equal(cancellationDaysForBooking(currentSeven),7);
for(const [now,start]of [[at(2026,3,22),at(2026,3,29)],[at(2026,10,18),at(2026,10,25)]]){
 assert.equal(bookingCancelKind({...seven,lineItems:[{start}]},now),'store_credit','Exactly seven London calendar days is the new credit boundary across DST');
 assert.equal(bookingCancelKind({...seven,lineItems:[{start}]},now-86400000),'full_refund');
 assert.equal(bookingCancelKind({...seven,lineItems:[{start}]},now+86400000),'store_credit');
}
assert.equal(bookingCancelKind({...seven,lineItems:[{start:at(2026,10,25,12)}]},at(2026,10,23,12)),'store_credit','The current signed v16 terms also issue credit for a renter canceling 48 hours before pickup');
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
const guide=fs.readFileSync(path.join(__dirname,'../src/components/CancellationPolicyQuickGuide.tsx'),'utf8');
const legalPage=fs.readFileSync(path.join(__dirname,'../src/app/legal/[slug]/page.tsx'),'utf8');
const checkoutProtection=fs.readFileSync(path.join(__dirname,'../src/components/cart/CancellationProtection.tsx'),'utf8');
const homeProtection=fs.readFileSync(path.join(__dirname,'../src/components/DeliveryProtectionTile.tsx'),'utf8');
const chatPolicy=fs.readFileSync(path.join(__dirname,'../convex/chat.ts'),'utf8');
const gafferPolicy=fs.readFileSync(path.join(__dirname,'../src/components/gaffer/useGafferTools.ts'),'utf8');
assert(guide.includes('All accounts can receive a full refund')&&guide.includes('Non-blocked accounts may instead choose 130%')&&!guide.includes('eligible renters'));
assert(guide.includes('more than 7 days before the first start')&&guide.includes('7 days or less before the first start'));
assert(guide.includes('valid for 365 days—even within 48 hours')&&guide.includes('Deposit returned separately'));
assert(guide.includes('London calendar days from the first item start'));
assert(guide.includes('Value compared with your paid rental amount')&&guide.includes('outcomes.map')&&guide.includes('width: "77%"')&&guide.includes('width: "100%"'));
assert(guide.includes('DB cancels · refund option')&&guide.includes('DB cancels · credit option'));
for(const copy of [homeProtection,checkoutProtection,chatPolicy,gafferPolicy])assert(!copy.includes('eligible renters'));
assert(homeProtection.includes('all accounts can get a full refund')&&checkoutProtection.includes('all accounts can receive a full refund')&&chatPolicy.includes('all accounts can receive a refund'));
assert(guide.includes('statutory refund rights take priority'));
assert(legalPage.includes('["cancellation", "terms"].includes(slug) && ["2026-10-v16",CANCELLATION_PROTECTION_LEGAL_VERSION].includes(version)'));
assert(checkoutProtection.includes('{showV16RenterPolicy&&<CancellationPolicyQuickGuide includeCompanyCancellation={false}/>}'));
console.log('PASS: London cancellation windows, DST, settlement limits, and concise v16 policy wording stays aligned across terms and checkout.');
