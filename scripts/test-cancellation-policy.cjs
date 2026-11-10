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
const { cancelKind, cancellationSettlement, cancellationTimingBasis, CANCELLATION_FULL_REFUND_DAYS, CANCELLATION_CREDIT_DAYS } = policy.exports;

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

const { bookingCancelKind, cancellationDaysForBooking, isNoRefundWithin48HoursCancellationVersion, isInclusiveSevenDayCancellationVersion } = policy.exports;
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
const currentV21={...booking,lineItems:[{start:at(2026,11,10),pickupTime:'15:00'}],agreementDocs:[{kind:'cancellation',version:'2026-11-v21'}]};
assert.equal(cancellationDaysForBooking(currentV21),7);
assert.equal(bookingCancelKind(currentV21,at(2026,11,2,15)),'full_refund','More than seven London calendar days permits a full-refund choice');
assert.equal(bookingCancelKind(currentV21,at(2026,11,3,15)),'store_credit','Exactly seven London calendar days allows credit only');
assert.equal(bookingCancelKind(currentV21,at(2026,11,8,14)+59*60*1000),'store_credit','More than 48 hours before pickup allows credit only');
assert.equal(bookingCancelKind(currentV21,at(2026,11,8,15)),'no_refund','Exactly 48 hours before scheduled London pickup allows no refund or credit');
assert.equal(bookingCancelKind(currentV21,at(2026,11,8,15)+60*1000),'no_refund','Less than 48 hours before pickup allows no refund or credit');
const sameDayPickups=[{start:at(2026,11,10),pickupTime:'09:00'},{start:at(2026,11,10),pickupTime:'16:00'}];
const canonicalPickup={...currentV21,pickupTime:'09:00',lineItems:[...sameDayPickups].reverse()};
assert.equal(bookingCancelKind(canonicalPickup,at(2026,11,8,10)),'no_refund','The booking-level scheduled pickup controls the 48-hour cutoff regardless of item order');
assert.equal(bookingCancelKind({...canonicalPickup,lineItems:[...canonicalPickup.lineItems].reverse()},at(2026,11,8,10)),'no_refund','Reordering same-day items cannot change the cancellation result');
const derivedPickup={...currentV21,pickupTime:undefined,lineItems:sameDayPickups};
assert.equal(bookingCancelKind(derivedPickup,at(2026,11,8,10)),'no_refund','Legacy bookings without a booking-level time derive the earliest same-day pickup');
assert.equal(bookingCancelKind({...derivedPickup,lineItems:[...sameDayPickups].reverse()},at(2026,11,8,10)),'no_refund','Legacy pickup-time fallback is deterministic across item order');
const dstV21={...booking,lineItems:[{start:at(2026,11,2),pickupTime:'09:00'}],agreementDocs:[{kind:'cancellation',version:'2026-11-v21'}]};
assert.equal(bookingCancelKind(dstV21,at(2026,10,31,9)),'no_refund','The exact 48-hour cutoff follows London local time across the autumn clock change');
assert.equal(bookingCancelKind(dstV21,at(2026,10,31,9)-60*1000),'store_credit','One minute beyond the DST-adjusted 48-hour boundary remains credit-only');
const currentV22={...currentV21,agreementDocs:[{kind:'cancellation',version:'2026-11-v22'}]};
const currentV23={...currentV21,agreementDocs:[{kind:'cancellation',version:'2026-11-v23'}]};
const v21Timing=[
  ['full_refund','More than seven London calendar days before the earliest equipment start'],
  ['store_credit','More than 48 hours before scheduled pickup, and seven or fewer London calendar days before the earliest equipment start'],
  ['no_refund','48 hours or less before scheduled pickup'],
];
for(const [kind,copy] of v21Timing){
 assert.equal(cancellationTimingBasis(kind,'2026-11-v21'),copy,`v21 ${kind} copy names the correct clock`);
 assert.equal(cancellationTimingBasis(kind,'2026-11-v22'),copy,`v22 ${kind} copy retains the v21 cancellation clock`);
}
assert.equal(cancellationTimingBasis('full_refund','2026-11-v18'),undefined,'Historical cancellation copy is not rewritten');
assert.equal(isNoRefundWithin48HoursCancellationVersion('2026-11-v21'),true,'v21 keeps the same cancellation treatment');
assert.equal(isNoRefundWithin48HoursCancellationVersion('2026-11-v22'),true,'v22 changes the security-claim timing only, not cancellation treatment');
assert.equal(isNoRefundWithin48HoursCancellationVersion('2026-11-v23'),true,'v23 keeps the 48-hour no-refund boundary');
assert.equal(isInclusiveSevenDayCancellationVersion('2026-11-v23'),true,'only v23 includes the seven-day boundary in the full-refund period');
assert.equal(isInclusiveSevenDayCancellationVersion('2026-11-v22'),false,'v22 retains its signed seven-day boundary');
assert.equal(cancellationDaysForBooking(currentV22),7,'v22 keeps the seven-day cancellation window');
assert.equal(bookingCancelKind(currentV22,at(2026,11,2,15)),'full_refund','Eight days before pickup allows refund or credit');
assert.equal(bookingCancelKind(currentV22,at(2026,11,3,15)),'store_credit','Exactly seven London calendar days allows credit only');
assert.equal(bookingCancelKind(currentV22,at(2026,11,8,14)+59*60*1000),'store_credit','Just over 48 hours before pickup allows credit only');
assert.equal(bookingCancelKind(currentV22,at(2026,11,8,15)),'no_refund','Exactly 48 hours before scheduled London pickup allows no refund or credit');
assert.equal(bookingCancelKind(currentV22,at(2026,11,8,15)+60*1000),'no_refund','Just inside 48 hours allows no refund or credit');
assert.equal(bookingCancelKind(currentV22,at(2026,11,9,15)),'no_refund','One day before pickup allows no refund or credit');
assert.equal(cancellationDaysForBooking(currentV23),7,'v23 retains the same seven-day cancellation window');
assert.equal(bookingCancelKind(currentV23,at(2026,11,2,15)),'full_refund','Eight days before pickup permits a refund or credit choice');
assert.equal(bookingCancelKind(currentV23,at(2026,11,3,15)),'full_refund','Exactly seven London calendar days permits a refund or credit choice in v23');
assert.equal(bookingCancelKind(currentV23,at(2026,11,4,15)),'store_credit','Six London calendar days permits credit only in v23');
assert.equal(bookingCancelKind(currentV23,at(2026,11,8,14)+59*60*1000),'store_credit','More than 48 hours before pickup still permits credit only in v23');
assert.equal(bookingCancelKind(currentV23,at(2026,11,8,15)),'no_refund','Exactly 48 hours before pickup still permits no refund or credit in v23');
const v20Legal=fs.readFileSync(path.join(__dirname,'../shared/legal-history/2026-11-v20.ts'),'utf8');
const v19Legal=fs.readFileSync(path.join(__dirname,'../shared/legal-history/2026-11-v19.ts'),'utf8');
const v18Legal=fs.readFileSync(path.join(__dirname,'../shared/legal-history/2026-11-v18.ts'),'utf8');
const v16Legal=fs.readFileSync(path.join(__dirname,'../shared/legal-history/2026-10-v16.ts'),'utf8');
assert(v19Legal.includes('from "./2026-11-v18"')&&v18Legal.includes('from "./2026-10-v16"'));
assert(v16Legal.includes('cancelling more than seven London calendar days')&&v16Legal.includes('Cancelling seven or fewer London calendar days'));
assert(v20Legal.includes('cancelling more than seven London calendar days')&&v20Legal.includes('Cancelling seven or fewer London calendar days'));
const v21Legal=fs.readFileSync(path.join(__dirname,'../shared/legal-history/2026-11-v21.ts'),'utf8');
assert(v21Legal.includes('2026-11-v20')&&v21Legal.includes('more than 48 hours')&&v21Legal.includes('no rental refund and no account credit'));
assert(v21Legal.includes('more than seven London calendar days before the earliest equipment start'));
assert(v21Legal.includes('more than 48 hours but seven or fewer London calendar days before the earliest equipment start'));
assert(v21Legal.includes('48 hours or less before the scheduled pickup time'));
assert(v21Legal.includes('130%')&&v21Legal.includes('rejected or restricted'));
const v23Legal=fs.readFileSync(path.join(__dirname,'../shared/legal-history/2026-11-v23.ts'),'utf8');
assert(v23Legal.includes('2026-11-v22')&&v23Legal.includes('seven or more London calendar days before the earliest equipment start'));
assert(v23Legal.includes('more than 48 hours but fewer than seven London calendar days before the earliest equipment start'));
assert(v23Legal.includes('48 hours or less before the scheduled pickup time'));
const {load}=require('./lib/rentalTestHarness.cjs');
const {LEGAL_ARCHIVE}=load('shared/legalDocuments.ts');
const archivedV21=LEGAL_ARCHIVE['2026-11-v21'];
const archivedV22=LEGAL_ARCHIVE['2026-11-v22'];
const archivedV23=LEGAL_ARCHIVE['2026-11-v23'];
for(const [kind,heading] of [['terms','Cancellation and refunds'],['rental-terms','Cancellation and refunds'],['rental-agreement','Cancellation and refunds'],['cancellation','Your cancellation']]){
 const signedCopy=archivedV23[kind].sections.find(section=>section.h===heading)?.p;
 assert(signedCopy?.includes('seven or more London calendar days before the earliest equipment start'),`v23 archived copy covers the ${kind} agreement`);
}
assert(archivedV21.cancellation.sections.find(section=>section.h==='Your cancellation').p.includes('more than seven London calendar days before the earliest equipment start'),'v21 archived copy retains its strict seven-day boundary');
assert.equal(archivedV22.cancellation.sections.find(section=>section.h==='Your cancellation').p,archivedV21.cancellation.sections.find(section=>section.h==='Your cancellation').p,'v22 preserves the v21 cancellation text');
for(const version of ['2026-11-v19','2026-11-v20']){
 const signed={...booking,lineItems:[{start:at(2026,10,25)}],agreementDocs:[{kind:'cancellation',version}]};
 assert.equal(cancellationDaysForBooking(signed),7,`${version} retains its signed seven-day rule`);
 assert.equal(bookingCancelKind(signed,at(2026,10,17)),'full_refund',`${version} refunds more than seven London calendar days before pickup`);
 assert.equal(bookingCancelKind(signed,at(2026,10,18)),'store_credit',`${version} issues credit exactly seven London calendar days before pickup`);
 assert.equal(bookingCancelKind(signed,at(2026,10,19)),'store_credit',`${version} issues credit within seven London calendar days of pickup`);
}
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
assert.deepEqual(cancellationSettlement('no_refund', 22000, 5000, 3000, true),
  { refundPence: 5000, creditPence: 0 },'No-refund cancellation may return separate refundable security but never rental cash or account credit');
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
const gafferKnowledge=fs.readFileSync(path.join(__dirname,'../shared/gafferPublicKnowledge.ts'),'utf8');
assert(guide.includes('Full refund for everyone')&&guide.includes('not restricted or rejected for a terms violation')&&!guide.includes('eligible renters'));
assert(guide.includes('more than 7 days before the first start')&&guide.includes('7 days or less before the first start'));
assert(guide.includes('Paid rent becomes account credit valid for 365 days')&&guide.includes('Deposit returned separately'));
assert(guide.includes('London calendar days apply')&&guide.includes('scheduled London pickup time'));
assert(guide.includes('Compared with eligible rental value')&&guide.includes('outcomes.map')&&guide.includes('width: "77%"')&&guide.includes('width: "100%"'));
assert(guide.includes('DB cancels · refund option')&&guide.includes('DB cancels · credit option'));
const renterTools=fs.readFileSync(path.join(__dirname,'../src/components/rentals/RenterRentalTools.tsx'),'utf8');
const requestApply=fs.readFileSync(path.join(__dirname,'../src/components/rentals/RentalRequestApply.tsx'),'utf8');
const requestHistory=fs.readFileSync(path.join(__dirname,'../src/components/rentals/RentalRequestHistory.tsx'),'utf8');
const adminRentalTools=fs.readFileSync(path.join(__dirname,'../src/components/admin/RentalOrderTools.tsx'),'utf8');
const bookingMutations=fs.readFileSync(path.join(__dirname,'../convex/bookings.ts'),'utf8');
const rentalRequests=fs.readFileSync(path.join(__dirname,'../convex/rentalRequests.ts'),'utf8');
assert(renterTools.includes('no rental refund or account credit')&&renterTools.includes('100% account credit'));
assert(requestApply.includes('No rental refund or account credit')&&requestApply.includes('customerChoice'));
for(const consumer of [renterTools,requestApply,requestHistory,adminRentalTools,rentalRequests])
 assert(consumer.includes('cancellationTimingBasis'),'Renter, chat and admin cancellation explanations use the shared v21/v22 timing basis');
assert(gafferKnowledge.includes('more than 48 hours before scheduled pickup, but within seven or fewer London calendar days of the earliest equipment start'));
assert(gafferKnowledge.includes('48 hours or less before scheduled pickup'));
assert(bookingMutations.includes('cancellationTimingBasis("full_refund",acceptedTermsVersion)'),'The server reports the correct refund boundary for the accepted version');
for(const consumer of [renterTools,requestApply,requestHistory,adminRentalTools,bookingMutations,rentalRequests])
  assert(consumer.includes('isNoRefundWithin48HoursCancellationVersion'),'Renter/admin UI and server request/settlement guards use the shared versioned cancellation predicate');
for(const copy of [homeProtection,checkoutProtection,chatPolicy,gafferPolicy])assert(!copy.includes('eligible renters'));
assert(homeProtection.includes('all accounts can get a full refund')&&checkoutProtection.includes('all accounts can receive a full refund')&&chatPolicy.includes('all accounts can receive a refund'));
assert(guide.includes('Statutory rights take priority'));
assert(legalPage.includes('["cancellation", "terms"].includes(slug) && ["2026-10-v16",CANCELLATION_PROTECTION_LEGAL_VERSION,SETUP_INTENT_LEGAL_VERSION,IMMEDIATE_CLAIM_LEGAL_VERSION].includes(version)'));
assert(checkoutProtection.includes('{showV16RenterPolicy&&<CancellationPolicyQuickGuide includeCompanyCancellation={false} version="2026-10-v16"/>}'));
const React=require('react'),{renderToStaticMarkup}=require('react-dom/server');
const guideJs=ts.transpileModule(guide,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020,jsx:ts.JsxEmit.ReactJSX}}).outputText;
const guideModule={exports:{}};new Function('require','module','exports',guideJs)(require,guideModule,guideModule.exports);
const Guide=guideModule.exports.CancellationPolicyQuickGuide;
const renderedV21=renderToStaticMarkup(React.createElement(Guide,{version:'2026-11-v21'}));
const renderedV22=renderToStaticMarkup(React.createElement(Guide,{version:'2026-11-v22'}));
assert.equal(renderedV22,renderedV21,'v22 renders the same current cancellation outcomes as v21');
assert.match(renderedV22,/You cancel more than 48 hours before scheduled pickup, but seven or fewer London calendar days before the earliest equipment start/);
assert.match(renderedV22,/You cancel 48 hours or less before scheduled pickup/);
assert.match(renderedV22,/Seven-day bands use the earliest item start/);
assert.doesNotMatch(renderedV22,/You cancel 7 days or less before the first start/);
const renderedV23=renderToStaticMarkup(React.createElement(Guide,{version:'2026-11-v23'}));
assert.match(renderedV23,/You cancel 7 or more days before the earliest item start/);
assert.match(renderedV23,/You cancel more than 48 hours before pickup, but fewer than 7 days before the earliest item start/);
assert.match(renderedV23,/You cancel 48 hours or less before scheduled pickup/);
assert.doesNotMatch(renderedV23,/more than 7 days · refund/);
const renderedV18=renderToStaticMarkup(React.createElement(Guide,{version:'2026-11-v18'}));
assert.match(renderedV18,/You cancel 7 days or less before the first start/,'Historic seven-day copy remains unchanged');
console.log('PASS: London cancellation windows, DST, settlement limits, and v16-v23 signed wording/guide rendering stay aligned.');
