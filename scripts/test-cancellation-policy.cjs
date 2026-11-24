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
const { cancelKind, cancellationSettlement, cancellationTimingBasis, cancellationPolicySummary, CANCELLATION_FULL_REFUND_DAYS, CANCELLATION_CREDIT_DAYS, NO_REFUND_WITHIN_48_HOURS_CANCELLATION_VERSIONS } = policy.exports;

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

const { bookingCancelKind, cancellationDaysForBooking, isNoRefundWithin48HoursCancellationVersion, isInclusiveSevenDayCancellationVersion, isLessThan48HoursCancellationVersion } = policy.exports;
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
const dstV27={...booking,lineItems:[{start:at(2026,10,26),pickupTime:'09:00'}],agreementDocs:[{kind:'cancellation',version:'2026-11-v27'}]};
assert.equal(bookingCancelKind(dstV27,at(2026,10,24,9)),'no_refund','v27 treats exactly 48 elapsed hours across the UK clock change as no refund or credit');
assert.equal(bookingCancelKind(dstV27,at(2026,10,24,9)-60*1000),'store_credit','v27 retains credit-only one minute before its DST-adjusted 48-hour cutoff');
const dstV28={...booking,lineItems:[{start:at(2026,10,26),pickupTime:'09:00'}],agreementDocs:[{kind:'cancellation',version:'2026-11-v28'}]};
assert.equal(bookingCancelKind(dstV28,at(2026,10,24,9)),'store_credit','v28 keeps exactly 48 elapsed hours across the UK clock change in the credit-only window');
assert.equal(bookingCancelKind(dstV28,at(2026,10,24,9)+1),'no_refund','v28 starts the no-refund window strictly inside 48 hours across the UK clock change');
const allDayV29={lineItems:[{start:at(2026,11,10)}],agreementDocs:[{kind:'cancellation',version:'2026-11-v29'}]};
assert.equal(bookingCancelKind(allDayV29,at(2026,11,8,0)),'store_credit','v29 treats exactly 48 hours before an all-day booking’s default pickup as credit-only');
assert.equal(bookingCancelKind(allDayV29,at(2026,11,8,0)+1),'no_refund','v29 uses a strict under-48-hour no-refund boundary for an all-day booking');
const multiItemV29={lineItems:[{start:at(2026,11,12),pickupTime:'10:00'},{start:at(2026,11,10),pickupTime:'15:00'}],pickupTime:'15:00',agreementDocs:[{kind:'cancellation',version:'2026-11-v29'}]};
assert.equal(bookingCancelKind(multiItemV29,at(2026,11,3,15)),'full_refund','the inclusive seven-day rule uses the earliest item start regardless of line-item ordering');
assert.equal(bookingCancelKind(multiItemV29,at(2026,11,4,15)),'store_credit','the middle window uses the same earliest item start for multi-item rentals');
assert.equal(bookingCancelKind(multiItemV29,at(2026,11,8,15)),'store_credit','exactly 48 hours before the canonical pickup time is credit-only');
assert.equal(bookingCancelKind(multiItemV29,at(2026,11,8,15)+1),'no_refund','one millisecond inside the pickup cutoff has no refund or credit');
assert.equal(bookingCancelKind({...multiItemV29,lineItems:[{start:at(2026,11,12),pickupTime:'10:00'}],cancellationPolicyStart:at(2026,11,10)},at(2026,11,4,15)),'store_credit','the persisted earliest-start anchor remains authoritative after item removal');
const allDayV30={lineItems:[{start:at(2026,11,10)}],agreementDocs:[{kind:'cancellation',version:'2026-11-v30'}]};
assert.equal(bookingCancelKind(allDayV30,at(2026,11,8,0)),'no_refund','v30 includes exactly 48 hours in the no-refund window');
assert.equal(bookingCancelKind(allDayV30,at(2026,11,8,0)-1),'store_credit','v30 allows credit only immediately outside the 48-hour cutoff');
const multiItemV30={lineItems:[{start:at(2026,11,12),pickupTime:'10:00'},{start:at(2026,11,10),pickupTime:'15:00'}],pickupTime:'15:00',agreementDocs:[{kind:'cancellation',version:'2026-11-v30'}]};
assert.equal(bookingCancelKind(multiItemV30,at(2026,11,8,15)),'no_refund','exactly 48 hours before canonical pickup has no refund or credit on v30');
assert.equal(bookingCancelKind(multiItemV30,at(2026,11,8,15)-1),'store_credit','one millisecond beyond the v30 cutoff remains credit-only');
assert.equal(bookingCancelKind(multiItemV30,at(2026,11,3,15)),'full_refund','v30 preserves the inclusive seven-day boundary');
assert.equal(bookingCancelKind(multiItemV30,at(2026,11,4,15)),'store_credit','v30 preserves credit-only in the middle window');
const allDayV32={lineItems:[{start:at(2026,11,10)}],agreementDocs:[{kind:'cancellation',version:'2026-11-v32'}]};
assert.equal(bookingCancelKind(allDayV32,at(2026,11,8,0)),'no_refund','v32 keeps its already-signed exact-48-hour cutoff');
const multiItemV33={lineItems:[{start:at(2026,11,12),pickupTime:'10:00'},{start:at(2026,11,10),pickupTime:'15:00'}],pickupTime:'15:00',agreementDocs:[{kind:'cancellation',version:'2026-11-v33'}]};
assert.equal(bookingCancelKind(multiItemV33,at(2026,11,3,15)),'full_refund','v33 grants a full refund or 100% credit exactly seven London calendar days out');
assert.equal(bookingCancelKind(multiItemV33,at(2026,11,4,15)),'store_credit','v33 gives account credit only between seven calendar days and the 48-hour cutoff');
assert.equal(bookingCancelKind(multiItemV33,at(2026,11,8,15)-1),'store_credit','v33 remains credit-only one millisecond outside the 48-hour cutoff');
assert.equal(bookingCancelKind(multiItemV33,at(2026,11,8,15)),'store_credit','v33 includes exactly 48 hours in the credit-only window');
assert.equal(bookingCancelKind(multiItemV33,at(2026,11,8,15)+1),'no_refund','v33 removes refund and credit only once less than 48 hours remain');
const multiItemV34={...multiItemV33,agreementDocs:[{kind:'cancellation',version:'2026-11-v34'}]};
assert.equal(bookingCancelKind(multiItemV34,at(2026,11,3,15)),'full_refund','v34 retains the inclusive seven-day full-refund boundary');
assert.equal(bookingCancelKind(multiItemV34,at(2026,11,4,15)),'store_credit','v34 gives credit only between seven days and more than 48 hours before pickup');
assert.equal(bookingCancelKind(multiItemV34,at(2026,11,8,15)-1),'store_credit','v34 permits credit until the exact 48-hour cutoff');
assert.equal(bookingCancelKind(multiItemV34,at(2026,11,8,15)),'no_refund','v34 gives no refund or credit exactly 48 hours before pickup');
assert.equal(bookingCancelKind(multiItemV34,at(2026,11,8,15)+1),'no_refund','v34 gives no refund or credit inside 48 hours');
const currentV22={...currentV21,agreementDocs:[{kind:'cancellation',version:'2026-11-v22'}]};
const currentV23={...currentV21,agreementDocs:[{kind:'cancellation',version:'2026-11-v23'}]};
const currentV24={...currentV21,agreementDocs:[{kind:'cancellation',version:'2026-11-v24'}]};
const currentV25={...currentV21,agreementDocs:[{kind:'cancellation',version:'2026-11-v25'}]};
const currentV26={...currentV21,agreementDocs:[{kind:'cancellation',version:'2026-11-v26'}]};
const currentV27={...currentV21,agreementDocs:[{kind:'cancellation',version:'2026-11-v27'}]};
const currentV28={...currentV21,agreementDocs:[{kind:'cancellation',version:'2026-11-v28'}]};
const currentV29={...currentV21,agreementDocs:[{kind:'cancellation',version:'2026-11-v29'}]};
const v21Timing=[
  ['full_refund','More than seven London calendar days before the earliest equipment start'],
  ['store_credit','More than 48 hours before scheduled pickup, and seven or fewer London calendar days before the earliest equipment start'],
  ['no_refund','48 hours or less before scheduled pickup'],
];
for(const [kind,copy] of v21Timing){
 assert.equal(cancellationTimingBasis(kind,'2026-11-v21'),copy,`v21 ${kind} copy names the correct clock`);
 assert.equal(cancellationTimingBasis(kind,'2026-11-v22'),copy,`v22 ${kind} copy retains the v21 cancellation clock`);
}
assert.equal(cancellationTimingBasis('full_refund','2026-11-v26'),'Seven or more London calendar days before the earliest equipment start','v26 includes the exact seven-day full-refund boundary');
assert.equal(cancellationTimingBasis('store_credit','2026-11-v26'),'More than 48 hours before scheduled pickup, and fewer than seven London calendar days before the earliest equipment start','v26 gives credit only in the middle window');
assert.equal(cancellationTimingBasis('no_refund','2026-11-v26'),'48 hours or less before scheduled pickup','v26 disallows refunds and credits within 48 hours');
assert.equal(cancellationTimingBasis('no_refund','2026-11-v27'),'48 hours or less before scheduled pickup','v27 explicitly includes exactly 48 hours in the no-refund window');
assert.equal(cancellationTimingBasis('full_refund','2026-11-v28'),'Seven or more London calendar days before the earliest equipment start','v28 retains the inclusive seven-day full-refund boundary');
assert.equal(cancellationTimingBasis('store_credit','2026-11-v28'),'48 hours or more before scheduled pickup, and fewer than seven London calendar days before the earliest equipment start','v28 makes the exact 48-hour point credit-only');
assert.equal(cancellationTimingBasis('no_refund','2026-11-v28'),'Less than 48 hours before scheduled pickup','v28 begins the no-refund window strictly inside 48 hours');
assert.equal(cancellationTimingBasis('full_refund','2026-11-v29'),'Seven or more London calendar days before the earliest equipment start','v29 uses the inclusive seven-day earliest-start boundary');
assert.equal(cancellationTimingBasis('store_credit','2026-11-v29'),'48 hours or more before scheduled pickup, and fewer than seven London calendar days before the earliest equipment start','v29 distinguishes the pickup clock from the earliest-start calendar band');
assert.equal(cancellationTimingBasis('no_refund','2026-11-v29'),'Less than 48 hours before scheduled pickup','v29 uses the strict under-48-hour boundary');
assert.equal(cancellationPolicySummary('2026-11-v29'),'7+ London calendar days before the first item starts: full refund or 100% credit · At least 48 hours before scheduled pickup, but under 7 calendar days before the first item starts: credit only · Under 48 hours before scheduled pickup: no rental refund or account credit.');
assert.equal(cancellationTimingBasis('full_refund','2026-11-v30'),'Seven or more London calendar days before the earliest equipment start','v30 preserves the inclusive seven-day boundary');
assert.equal(cancellationTimingBasis('store_credit','2026-11-v30'),'More than 48 hours before scheduled pickup, and fewer than seven London calendar days before the earliest equipment start','v30 makes credit-only strictly outside the 48-hour cutoff');
assert.equal(cancellationTimingBasis('no_refund','2026-11-v30'),'48 hours or less before scheduled pickup','v30 includes exactly 48 hours in the no-refund window');
assert.equal(cancellationPolicySummary('2026-11-v30'),'7+ London calendar days before the first item starts: full refund or 100% credit · More than 48 hours before scheduled pickup, but under 7 calendar days before the first item starts: credit only · 48 hours or less before scheduled pickup: no rental refund or account credit.');
assert.equal(cancellationPolicySummary('2026-11-v31'),cancellationPolicySummary('2026-11-v30'),'v31 keeps the accepted cancellation summary unchanged');
assert.equal(cancellationTimingBasis('full_refund','2026-11-v33'),'Seven or more London calendar days before the earliest equipment start','v33 preserves the seven-day full-refund boundary');
assert.equal(cancellationTimingBasis('store_credit','2026-11-v33'),'At least 48 hours before scheduled pickup, and fewer than seven London calendar days before the earliest equipment start','v33 includes exactly 48 hours in the credit-only period');
assert.equal(cancellationTimingBasis('no_refund','2026-11-v33'),'Less than 48 hours before scheduled pickup','v33 denies refund and credit only inside 48 hours');
assert.equal(cancellationPolicySummary('2026-11-v33'),'7+ London calendar days before the first item starts: full refund or 100% credit · At least 48 hours before scheduled pickup, but under 7 calendar days before the first item starts: credit only · Under 48 hours before scheduled pickup: no rental refund or account credit.');
assert.equal(cancellationTimingBasis('full_refund','2026-11-v34'),'Seven or more London calendar days before the earliest equipment start','v34 preserves the inclusive seven-day full-refund boundary');
assert.equal(cancellationTimingBasis('store_credit','2026-11-v34'),'More than 48 hours before scheduled pickup, and fewer than seven London calendar days before the earliest equipment start','v34 limits credit to the period strictly outside 48 hours');
assert.equal(cancellationTimingBasis('no_refund','2026-11-v34'),'48 hours or less before scheduled pickup','v34 includes exactly 48 hours in the no-refund/no-credit period');
assert.equal(cancellationPolicySummary('2026-11-v34'),'7+ London calendar days before the first item starts: full refund or 100% credit · More than 48 hours before scheduled pickup, but under 7 calendar days before the first item starts: credit only · 48 hours or less before scheduled pickup: no rental refund or account credit.');
for(const version of [...new Set(NO_REFUND_WITHIN_48_HOURS_CANCELLATION_VERSIONS)]){
 const summary=cancellationPolicySummary(version);
 assert(isNoRefundWithin48HoursCancellationVersion(version)&&summary,`${version} renders compact renter cancellation options`);
 assert(summary.includes(isInclusiveSevenDayCancellationVersion(version)?'7+ London calendar days':'More than 7 London calendar days'),`${version} preserves its exact full-refund boundary`);
 assert(summary.includes(isLessThan48HoursCancellationVersion(version)?'At least 48 hours':'More than 48 hours'),`${version} preserves its exact credit-only pickup boundary`);
 assert(summary.includes(isLessThan48HoursCancellationVersion(version)?'Under 48 hours':'48 hours or less'),`${version} preserves its exact no-refund pickup boundary`);
}
assert.equal(cancellationPolicySummary('2026-11-v20'),undefined,'Legacy v20 keeps its original summary rather than inheriting the newer 48-hour bands');
assert.equal(isLessThan48HoursCancellationVersion('2026-11-v32'),false,'v32 remains tied to its signed strict 48-hour cutoff');
assert.equal(isLessThan48HoursCancellationVersion('2026-11-v33'),true,'historical v33 retains its strict under-48-hour cutoff');
assert.equal(isLessThan48HoursCancellationVersion('2026-11-v34'),false,'v34 makes exactly 48 hours part of the no-refund/no-credit period');
assert.equal(cancellationTimingBasis('full_refund','2026-11-v18'),undefined,'Historical cancellation copy is not rewritten');
assert.equal(isNoRefundWithin48HoursCancellationVersion('2026-11-v21'),true,'v21 keeps the same cancellation treatment');
assert.equal(isNoRefundWithin48HoursCancellationVersion('2026-11-v22'),true,'v22 changes the security-claim timing only, not cancellation treatment');
assert.equal(isNoRefundWithin48HoursCancellationVersion('2026-11-v23'),true,'v23 keeps the 48-hour no-refund boundary');
assert.equal(isInclusiveSevenDayCancellationVersion('2026-11-v23'),true,'v23 includes the seven-day boundary in the full-refund period');
assert.equal(isInclusiveSevenDayCancellationVersion('2026-11-v24'),true,'v24 preserves the inclusive seven-day boundary');
assert.equal(isInclusiveSevenDayCancellationVersion('2026-11-v30'),true,'v30 preserves the inclusive seven-day boundary');
assert.equal(isInclusiveSevenDayCancellationVersion('2026-11-v25'),true,'v25 preserves the inclusive seven-day boundary');
assert.equal(isInclusiveSevenDayCancellationVersion('2026-11-v26'),true,'v26 preserves the inclusive seven-day boundary');
assert.equal(isInclusiveSevenDayCancellationVersion('2026-11-v27'),true,'v27 preserves the inclusive seven-day boundary');
assert.equal(isInclusiveSevenDayCancellationVersion('2026-11-v28'),true,'v28 preserves the inclusive seven-day boundary');
assert.equal(isInclusiveSevenDayCancellationVersion('2026-11-v29'),true,'v29 preserves the inclusive seven-day boundary');
assert.equal(isInclusiveSevenDayCancellationVersion('2026-11-v22'),false,'v22 retains its signed seven-day boundary');
assert.equal(cancellationDaysForBooking(currentV22),7,'v22 keeps the seven-day cancellation window');
assert.equal(bookingCancelKind(currentV22,at(2026,11,2,15)),'full_refund','Eight days before pickup allows refund or credit');
assert.equal(bookingCancelKind(currentV22,at(2026,11,3,15)),'store_credit','Exactly seven London calendar days allows credit only');
assert.equal(bookingCancelKind(currentV22,at(2026,11,8,14)+59*60*1000),'store_credit','Just over 48 hours before pickup allows credit only');
assert.equal(bookingCancelKind(currentV22,at(2026,11,8,15)),'no_refund','Exactly 48 hours before scheduled London pickup allows no refund or credit');
assert.equal(bookingCancelKind(currentV22,at(2026,11,8,15)+60*1000),'no_refund','Just inside 48 hours allows no refund or credit');
assert.equal(bookingCancelKind(currentV22,at(2026,11,9,15)),'no_refund','One day before pickup allows no refund or credit');
assert.equal(cancellationDaysForBooking(currentV23),7,'v23 retains the same seven-day cancellation window');
assert.equal(cancellationDaysForBooking(currentV25),7,'v25 retains the same seven-day cancellation window');
assert.equal(cancellationDaysForBooking(currentV26),7,'v26 retains the same seven-day cancellation window');
assert.equal(cancellationDaysForBooking(currentV27),7,'v27 retains the inclusive seven-day cancellation window');
assert.equal(cancellationDaysForBooking(currentV28),7,'v28 retains the inclusive seven-day cancellation window');
assert.equal(bookingCancelKind(currentV25,at(2026,11,3,15)),'full_refund','v25 includes exactly seven days in the full-refund period');
assert.equal(bookingCancelKind(currentV25,at(2026,11,4,15)),'store_credit','v25 remains credit-only inside the seven-day window');
assert.equal(bookingCancelKind(currentV26,at(2026,11,3,15)),'full_refund','v26 retains the inclusive exact seven-day full-refund boundary');
assert.equal(bookingCancelKind(currentV26,at(2026,11,4,15)),'store_credit','v26 remains credit-only inside the seven-day window');
assert.equal(bookingCancelKind(currentV26,at(2026,11,8,15)-1),'store_credit','v26 allows credit one millisecond before the 48-hour cutoff');
assert.equal(bookingCancelKind(currentV26,at(2026,11,8,15)),'no_refund','v26 allows no rental refund or credit at exactly 48 hours');
assert.equal(bookingCancelKind(currentV26,at(2026,11,8,15)+1),'no_refund','v26 allows no rental refund or credit less than 48 hours before pickup');
assert.equal(bookingCancelKind(currentV27,at(2026,11,8,15)-1),'store_credit','v27 allows credit one millisecond before the 48-hour cutoff');
assert.equal(bookingCancelKind(currentV27,at(2026,11,8,15)),'no_refund','v27 allows no rental refund or credit at exactly 48 hours');
assert.equal(bookingCancelKind(currentV27,at(2026,11,8,15)+1),'no_refund','v27 allows no rental refund or credit less than 48 hours before pickup');
assert.equal(bookingCancelKind(currentV27,at(2026,11,3,15)),'full_refund','v27 retains the inclusive exact seven-day full-refund boundary');
assert.equal(bookingCancelKind(currentV27,at(2026,11,4,15)),'store_credit','v27 remains credit-only inside the seven-day window');
assert.equal(bookingCancelKind(currentV28,at(2026,11,3,15)),'full_refund','v28 includes exactly seven London calendar days in the full-refund window');
assert.equal(bookingCancelKind(currentV28,at(2026,11,4,15)),'store_credit','v28 remains credit-only inside the seven-day window');
assert.equal(bookingCancelKind(currentV28,at(2026,11,8,15)-1),'store_credit','v28 allows credit one millisecond before the exact 48-hour boundary');
assert.equal(bookingCancelKind(currentV28,at(2026,11,8,15)),'store_credit','v28 keeps exactly 48 hours in the credit-only window');
assert.equal(bookingCancelKind(currentV28,at(2026,11,8,15)+1),'no_refund','v28 allows no refund or credit only once fewer than 48 hours remain');
assert.equal(bookingCancelKind(currentV23,at(2026,11,2,15)),'full_refund','Eight days before pickup permits a refund or credit choice');
assert.equal(bookingCancelKind(currentV23,at(2026,11,3,15)),'full_refund','Exactly seven London calendar days permits a refund or credit choice in v23');
assert.equal(bookingCancelKind(currentV23,at(2026,11,4,15)),'store_credit','Six London calendar days permits credit only in v23');
assert.equal(bookingCancelKind(currentV23,at(2026,11,8,14)+59*60*1000),'store_credit','More than 48 hours before pickup still permits credit only in v23');
assert.equal(bookingCancelKind(currentV23,at(2026,11,8,15)),'no_refund','Exactly 48 hours before pickup still permits no refund or credit in v23');
assert.equal(bookingCancelKind(currentV24,at(2026,11,3,15)),'full_refund','v24 preserves the exact seven-day full-refund boundary');
assert.equal(bookingCancelKind(currentV24,at(2026,11,4,15)),'store_credit','v24 preserves credit-only timing inside seven days');
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
const v24Legal=fs.readFileSync(path.join(__dirname,'../shared/legal-history/2026-11-v24.ts'),'utf8');
assert(v24Legal.includes('2026-11-v23')&&v24Legal.includes('cancels your confirmed rental before pickup for any reason'));
assert(v24Legal.includes('130%')&&v24Legal.includes('rejected or restricted'));
const v25Legal=fs.readFileSync(path.join(__dirname,'../shared/legal-history/2026-11-v25.ts'),'utf8');
assert(v25Legal.includes('2026-11-v24')&&v25Legal.includes('required identity verification has passed'));
assert(v25Legal.includes('invoice and exact collection address only after approval'));
const v26Legal=fs.readFileSync(path.join(__dirname,'../shared/legal-history/2026-11-v26.ts'),'utf8');
assert(v26Legal.includes('2026-11-v25')&&v26Legal.includes('final itemised claim invoice'));
const v27Legal=fs.readFileSync(path.join(__dirname,'../shared/legal-history/2026-11-v27.ts'),'utf8');
assert(v27Legal.includes('2026-11-v26')&&v27Legal.includes('exactly 48 hours is included in this no-refund window'));
assert(v27Legal.includes('full successor to v26')&&v27Legal.includes('scaled claim cap'));
const v28Legal=fs.readFileSync(path.join(__dirname,'../shared/legal-history/2026-11-v28.ts'),'utf8');
assert(v28Legal.includes('2026-11-v27')&&v28Legal.includes('Exactly 48 hours before scheduled pickup remains in the account-credit-only window'));
assert(v28Legal.includes('Cancelling less than 48 hours before the scheduled pickup time gives no rental refund and no account credit'));
const v29Legal=fs.readFileSync(path.join(__dirname,'../shared/legal-history/2026-11-v29.ts'),'utf8');
assert(v29Legal.includes('2026-11-v28')&&v29Legal.includes('at least 48 hours before the scheduled London pickup time, but fewer than seven London calendar days before the earliest equipment start'));
assert(v28Legal.includes('Cancelling at least 48 hours but fewer than seven London calendar days before the earliest equipment start'),'v29 clarifies the clock without rewriting the v28 signed text');
const {load}=require('./lib/rentalTestHarness.cjs');
const {LEGAL_ARCHIVE}=load('shared/legalDocuments.ts');
const archivedV21=LEGAL_ARCHIVE['2026-11-v21'];
const archivedV22=LEGAL_ARCHIVE['2026-11-v22'];
const archivedV23=LEGAL_ARCHIVE['2026-11-v23'];
const archivedV24=LEGAL_ARCHIVE['2026-11-v24'];
const archivedV25=LEGAL_ARCHIVE['2026-11-v25'];
const archivedV26=LEGAL_ARCHIVE['2026-11-v26'];
const archivedV27=LEGAL_ARCHIVE['2026-11-v27'];
const archivedV28=LEGAL_ARCHIVE['2026-11-v28'];
const archivedV29=LEGAL_ARCHIVE['2026-11-v29'];
const archivedV30=LEGAL_ARCHIVE['2026-11-v30'];
const archivedV32=LEGAL_ARCHIVE['2026-11-v32'];
const archivedV33=LEGAL_ARCHIVE['2026-11-v33'];
const archivedV34=LEGAL_ARCHIVE['2026-11-v34'];
assert(archivedV33 && archivedV34,'both the prior signed policy and the new policy remain available');
for(const [kind,heading] of [['terms','Cancellation and refunds'],['rental-terms','Cancellation and refunds'],['rental-agreement','Cancellation and refunds'],['cancellation','Your cancellation']]){
 const signedCopy=archivedV23[kind].sections.find(section=>section.h===heading)?.p;
 assert(signedCopy?.includes('seven or more London calendar days before the earliest equipment start'),`v23 archived copy covers the ${kind} agreement`);
}
assert(archivedV21.cancellation.sections.find(section=>section.h==='Your cancellation').p.includes('more than seven London calendar days before the earliest equipment start'),'v21 archived copy retains its strict seven-day boundary');
assert.equal(archivedV22.cancellation.sections.find(section=>section.h==='Your cancellation').p,archivedV21.cancellation.sections.find(section=>section.h==='Your cancellation').p,'v22 preserves the v21 cancellation text');
assert.match(archivedV23.terms.sections.find(section=>section.h==='Free cancellation protection').p,/because equipment is unexpectedly unavailable/,'v23 retains its narrower company-cancellation promise');
assert.match(archivedV24.terms.sections.find(section=>section.h==='Free cancellation protection').p,/for any reason/,'v24 broadens the company-cancellation promise for new bookings');
assert.match(archivedV24.terms.sections.find(section=>section.h==='2. Bookings').p,/confirmed once payment is taken/,'v24 remains an immutable historical agreement');
assert.doesNotMatch(archivedV25.terms.sections.find(section=>section.h==='2. Bookings').p,/confirmed once payment is taken/i,'v25 aligns with the verification gate');
assert.match(archivedV25.terms.sections.find(section=>section.h==='2. Bookings').p,/required identity verification has passed/);
assert.equal(archivedV25.terms.sections.find(section=>section.h==='Free cancellation protection').p,archivedV24.terms.sections.find(section=>section.h==='Free cancellation protection').p,'v25 retains v24 company-cancellation terms');
assert.equal(archivedV26.terms.sections.find(section=>section.h==='Cancellation and refunds').p,archivedV26['rental-terms'].sections.find(section=>section.h==='Cancellation and refunds').p,'v26 remains internally consistent in its historical copy');
for(const kind of ['terms','rental-terms','rental-agreement','cancellation']) {
 const heading=kind==='cancellation'?'Your cancellation':'Cancellation and refunds';
 const signedCopy=archivedV27[kind].sections.find(section=>section.h===heading)?.p;
 assert(signedCopy?.includes('exactly 48 hours is included in this no-refund window'),`v27 clearly states the exact 48-hour boundary in ${kind}`);
 const successorCopy=archivedV28[kind].sections.find(section=>section.h===heading)?.p;
 assert(successorCopy?.includes('Exactly 48 hours before scheduled pickup remains in the account-credit-only window'),`v28 clearly states the exact 48-hour boundary in ${kind}`);
 assert(successorCopy?.includes('seven or more London calendar days'),`v28 preserves the seven-day full-refund boundary in ${kind}`);
 assert(successorCopy?.includes('less than 48 hours'),`v28 uses a strict under-48-hour no-refund window in ${kind}`);
 const correctedCopy=archivedV29[kind].sections.find(section=>section.h===heading)?.p;
 assert(correctedCopy?.includes('at least 48 hours before the scheduled London pickup time, but fewer than seven London calendar days before the earliest equipment start'),`v29 identifies both clocks in ${kind}`);
 const currentCopy=archivedV30[kind].sections.find(section=>section.h===heading)?.p;
 assert(currentCopy?.includes('more than 48 hours before the scheduled London pickup time, but fewer than seven London calendar days before the earliest equipment start'),`v30 applies the owner-selected strict credit-only cutoff in ${kind}`);
 assert(currentCopy?.includes('48 hours or less')&&currentCopy?.includes('exactly 48 hours is included in this no-refund window'),`v30 clearly includes the exact 48-hour boundary in ${kind}`);
 const v33Copy=archivedV33[kind].sections.find(section=>section.h===heading)?.p;
 assert(v33Copy?.includes('Exactly 48 hours before scheduled pickup remains in the account-credit-only window'),`v33 keeps its signed exactly-48-hour credit-only rule in ${kind}`);
 const v34Copy=archivedV34[kind].sections.find(section=>section.h===heading)?.p;
 assert(v34Copy?.includes('more than 48 hours before scheduled London pickup'),`v34 sets the new credit-only boundary in ${kind}`);
 assert(v34Copy?.includes('48 hours or less before scheduled London pickup gives no rental refund and no account credit'),`v34 states the exact 48-hour no-refund/no-credit boundary in ${kind}`);
}
const v26Cap=archivedV26['deposit-agreement'].sections.find(section=>section.h==='2. Future-claim ceiling and permitted reasons').p;
const v27Cap=archivedV27['deposit-agreement'].sections.find(section=>section.h==='2. Future-claim ceiling and permitted reasons').p;
assert.equal(v27Cap,v26Cap,'v27 preserves v26 scaled future-claim cap language exactly');
assert.match(v27Cap,/increases continuously by £100 for each additional £1,000.*proportionally to the penny/);
assert.equal(archivedV28['deposit-agreement'].sections.find(section=>section.h==='2. Future-claim ceiling and permitted reasons').p,v27Cap,'v28 changes only renter cancellation timing and leaves the v27 saved-card terms intact');
const currentCap=archivedV34['deposit-agreement'].sections.find(section=>section.h==='2. Future-claim ceiling and permitted reasons').p;
assert.equal(currentCap,v27Cap,'the current v34 agreement retains the accepted continuous saved-card ceiling');
assert.match(archivedV34['rental-terms'].sections.find(section=>section.h==='2. Saved-card security claims').p,/increases continuously by £100 for each additional £1,000.*proportionally to the penny/,'the renter-facing rental terms disclose the current scaled cap');
assert.match(archivedV34['rental-agreement'].sections.find(section=>section.h==='5A. Saved-card authority').p,/Saved Card & Future Security Payments Agreement/,'the rental agreement points to the separately accepted agreement carrying the exact claim ceiling');
const v27CompanyCancellation=archivedV27.terms.sections.find(section=>section.h==='Free cancellation protection').p;
const v28CompanyCancellation=archivedV28.terms.sections.find(section=>section.h==='Free cancellation protection').p;
assert.equal(v28CompanyCancellation,v27CompanyCancellation,'v28 retains the same company-cancellation guarantee as v27');
assert.match(v28CompanyCancellation,/full refund.*or account credit equal to 130%/);
assert.match(v28CompanyCancellation,/rejected or restricted.*terms violation/);
const {legalVersionForPolicy}=load('shared/legalVersioning.ts');
const {IMMEDIATE_CLAIM_SECURITY_POLICY_VERSION}=load('shared/rentalSecurity.ts');
const legalModule=load('src/lib/legal.ts');
assert.equal(legalModule.IMMEDIATE_CLAIM_LEGAL_VERSION,'2026-11-v34','New checkout terms use v34 for the corrected exact-48-hour cancellation window');
assert.equal(legalVersionForPolicy({setupIntentSecurityEnabled:true}),'2026-11-v34','New setup-intent rentals receive the v34 agreement');
assert.equal(legalModule.agreementsForSecurityPolicy(IMMEDIATE_CLAIM_SECURITY_POLICY_VERSION).find(document=>document.kind==='cancellation')?.version,'2026-11-v34','Checkout signs the matching v34 cancellation agreement');
assert.equal(legalModule.agreementsForSecurityPolicy(IMMEDIATE_CLAIM_SECURITY_POLICY_VERSION).find(document=>document.kind==='deposit-agreement')?.version,'2026-11-v34','Checkout also signs the v34 deposit agreement containing the scaled-cap disclosure');
assert(legalModule.IMMEDIATE_CLAIM_LEGAL_VERSIONS.includes('2026-11-v28'),'Previously accepted v28 agreements remain recognized');
assert(legalModule.IMMEDIATE_CLAIM_LEGAL_VERSIONS.includes('2026-11-v29'),'Previously accepted v29 agreements remain recognized after the v30 update');
assert(legalModule.IMMEDIATE_CLAIM_LEGAL_VERSIONS.includes('2026-11-v30'),'Previously accepted v30 agreements remain recognized after the v31 update');
assert(legalModule.IMMEDIATE_CLAIM_LEGAL_VERSIONS.includes('2026-11-v31'),'Previously accepted v31 agreements remain recognized after the v32 update');
assert(legalModule.IMMEDIATE_CLAIM_LEGAL_VERSIONS.includes('2026-11-v32'),'Previously accepted v32 agreements remain recognized after the v33 update');
assert(legalModule.IMMEDIATE_CLAIM_LEGAL_VERSIONS.includes('2026-11-v33'),'Previously accepted v33 agreements remain recognized after the v34 update');
assert(legalModule.LESS_THAN_48_HOUR_CANCELLATION_LEGAL_VERSIONS.includes('2026-11-v28'),'v28 historical agreements retain their own cutoff');
assert(legalModule.LESS_THAN_48_HOUR_CANCELLATION_LEGAL_VERSIONS.includes('2026-11-v33'),'Historical v33 agreements keep their strict under-48-hour cutoff');
assert(!legalModule.LESS_THAN_48_HOUR_CANCELLATION_LEGAL_VERSIONS.includes('2026-11-v34'),'New v34 agreements put exactly 48 hours in the no-refund/no-credit window');
assert(!legalModule.LESS_THAN_48_HOUR_CANCELLATION_LEGAL_VERSIONS.includes('2026-11-v32'),'v32 keeps its immutable exact-48-hour no-refund rule');
assert(archivedV32.cancellation.sections.find(section=>section.h==='Your cancellation').p.includes('48 hours or less before the scheduled London pickup time gives no rental refund'),'v32 historical cancellation terms remain unchanged');
for(const [kind,heading] of [['terms','Cancellation and refunds'],['rental-terms','Cancellation and refunds'],['rental-agreement','Cancellation and refunds'],['cancellation','Your cancellation']]) {
 const signedCopy=archivedV33[kind].sections.find(section=>section.h===heading)?.p;
 assert(signedCopy?.includes('seven or more London calendar days before the earliest equipment start'),`v33 keeps the full-refund boundary in ${kind}`);
 assert(signedCopy?.includes('at least 48 hours before the scheduled London pickup time'),`v33 gives credit-only at exactly 48 hours in ${kind}`);
 assert(signedCopy?.includes('less than 48 hours before the scheduled London pickup time'),`v33 gives no refund or credit only inside 48 hours in ${kind}`);
}
const v33CompanyCancellation=archivedV33.terms.sections.find(section=>section.h==='Free cancellation protection').p;
assert.match(v33CompanyCancellation,/DB Cinema cancels your confirmed rental before pickup for any reason/);
assert.match(v33CompanyCancellation,/account credit equal to 130%/);
assert.match(v33CompanyCancellation,/rejected or restricted for a terms violation/);
assert(legalModule.IMMEDIATE_CLAIM_LEGAL_VERSIONS.includes('2026-11-v27'),'Previously accepted v27 agreements remain recognized');
assert(!legalModule.PREVIOUS_IMMEDIATE_CLAIM_LEGAL_VERSIONS.includes('2026-11-v27'),'The v27 scaled-claim agreement is not accepted under the separate legacy immediate-claim security policy');
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
const rentalPaymentPlan=require('./lib/rentalTestHarness.cjs').load('convex/lib/rentalPaymentPlan.ts');
const fortyEightHourKind=bookingCancelKind(multiItemV33,at(2026,11,8,15));
assert.deepEqual(rentalPaymentPlan.cancellationPaymentPlan(fortyEightHourKind,[{paymentIntentId:'pi_v33',availablePence:10000,securityPence:2000}],0),{allocations:[{paymentIntentId:'pi_v33',amountPence:2000}],refundPence:2000,creditPence:8000},'At exactly 48 hours the authoritative cancellation result settles rental value as account credit and returns only separate refundable security');
const underFortyEightHourKind=bookingCancelKind(multiItemV33,at(2026,11,8,15)+1);
assert.deepEqual(rentalPaymentPlan.cancellationPaymentPlan(underFortyEightHourKind,[{paymentIntentId:'pi_v33',availablePence:10000,securityPence:2000}],0),{allocations:[{paymentIntentId:'pi_v33',amountPence:2000}],refundPence:2000,creditPence:0},'Under 48 hours only separate refundable security returns; the rental payment and credit are withheld under the accepted terms');
for (const invalid of [-1, 1.5, NaN, Infinity]) {
  assert.throws(() => cancellationSettlement('full_refund', invalid, 0, 0, false),
    /Invalid cancellation amount/);
}
const guide=fs.readFileSync(path.join(__dirname,'../src/components/CancellationPolicyQuickGuide.tsx'),'utf8');
const legalPage=fs.readFileSync(path.join(__dirname,'../src/app/legal/[slug]/page.tsx'),'utf8');
const cancellationExplainer=fs.readFileSync(path.join(__dirname,'../src/components/legal/CancellationExplainerPage.tsx'),'utf8');
const checkoutProtection=fs.readFileSync(path.join(__dirname,'../src/components/cart/CancellationProtection.tsx'),'utf8');
const homeProtection=fs.readFileSync(path.join(__dirname,'../src/components/DeliveryProtectionTile.tsx'),'utf8');
const howItWorks=fs.readFileSync(path.join(__dirname,'../src/app/how-it-works/page.tsx'),'utf8');
const chatPolicy=fs.readFileSync(path.join(__dirname,'../convex/chat.ts'),'utf8');
const gafferPolicy=fs.readFileSync(path.join(__dirname,'../src/components/gaffer/useGafferTools.ts'),'utf8');
const gafferKnowledge=fs.readFileSync(path.join(__dirname,'../shared/gafferPublicKnowledge.ts'),'utf8');
assert(guide.includes('companyCancellationForAnyReason')&&guide.includes('Restricted or rejected accounts cannot receive 130% credit')&&!guide.includes('eligible renters'));
assert(guide.includes('More than 7 days before first item starts')&&guide.includes('7 days or less'));
assert(guide.includes('Full rental refund')&&guide.includes('Account credit')&&guide.includes('London calendar days'));
assert(guide.includes('scheduled London pickup')&&guide.includes('cancellationStages.map')&&guide.includes('lg:grid-cols-3'));
assert(guide.includes('companyCancellationLabel')&&guide.includes('companyCancellationForAnyReason'));
const renterTools=fs.readFileSync(path.join(__dirname,'../src/components/rentals/RenterRentalTools.tsx'),'utf8');
const requestApply=fs.readFileSync(path.join(__dirname,'../src/components/rentals/RentalRequestApply.tsx'),'utf8');
const requestHistory=fs.readFileSync(path.join(__dirname,'../src/components/rentals/RentalRequestHistory.tsx'),'utf8');
const adminRentalTools=fs.readFileSync(path.join(__dirname,'../src/components/admin/RentalOrderTools.tsx'),'utf8');
const bookingMutations=fs.readFileSync(path.join(__dirname,'../convex/bookings.ts'),'utf8');
const rentalRequests=fs.readFileSync(path.join(__dirname,'../convex/rentalRequests.ts'),'utf8');
const cancellationEmail=fs.readFileSync(path.join(__dirname,'../convex/notify.ts'),'utf8');
assert(bookingMutations.includes('of separately refundable security is being returned to your card')&&bookingMutations.includes('No rental cash refund is issued for the amount converted to credit'),'The renter chat distinguishes a separately returned security amount from rental cash refund during credit-only cancellation');
assert(cancellationEmail.includes('mode==="no_refund"||mode==="credit"?"Separately refundable security to original payment method"')&&cancellationEmail.includes('No rental cash refund is issued for the amount converted to credit'),'The cancellation email distinguishes a separate security return from rental cash refund during credit-only cancellation');
assert(/no rental refund or account credit/i.test(renterTools)&&renterTools.includes('100% account credit'));
assert(requestApply.includes('No rental refund or account credit')&&requestApply.includes('customerChoice'));
for(const consumer of [renterTools,requestApply,requestHistory,adminRentalTools,rentalRequests])
 assert(consumer.includes('cancellationTimingBasis'),'Renter, chat and admin cancellation explanations use the shared v21/v22 timing basis');
assert(gafferKnowledge.includes('more than 48 hours before scheduled pickup, but within seven or fewer London calendar days of the earliest equipment start'));
assert(gafferKnowledge.includes('If DB Cinema cancels a confirmed rental before pickup for any reason'));
assert(gafferKnowledge.includes('If equipment is unexpectedly unavailable and DB Cinema cancels before pickup'));
assert(gafferKnowledge.includes('48 hours or less before scheduled pickup'));
assert(bookingMutations.includes('cancellationTimingBasis("full_refund",acceptedTermsVersion)'),'The server reports the correct refund boundary for the accepted version');
for(const consumer of [renterTools,requestApply,requestHistory,adminRentalTools,bookingMutations,rentalRequests])
  assert(consumer.includes('isNoRefundWithin48HoursCancellationVersion'),'Renter/admin UI and server request/settlement guards use the shared versioned cancellation predicate');
for(const copy of [homeProtection,checkoutProtection,chatPolicy,gafferPolicy])assert(!copy.includes('eligible renters'));
assert(homeProtection.includes('If DB Cinema cancels your confirmed rental before pickup')&&checkoutProtection.includes('If DB Cinema cancels your confirmed rental before pickup')&&chatPolicy.includes('all accounts can receive a refund'));
assert(guide.includes('Statutory rights apply'));
assert(howItWorks.includes('currentLegalVersion()')&&howItWorks.includes('<CancellationPolicyQuickGuide version={cancellationVersion} />'),'How it works displays the policy matching the active agreement version');
assert(legalPage.includes('const showCancellationGuide = ["cancellation", "terms"].includes(slug)')&&legalPage.includes('...IMMEDIATE_CLAIM_LEGAL_VERSIONS].includes(version)')&&legalPage.includes('showQuickGuide={showCancellationGuide}')&&legalPage.includes('{showCancellationGuide && <CancellationPolicyQuickGuide version={version} />}'), 'The public cancellation route and generic terms page show the version-matched quick guide for active immediate-claim agreements, including v22');
assert(cancellationExplainer.includes('Full policy wording')&&cancellationExplainer.includes('{section.p}')&&cancellationExplainer.includes('<CancellationPolicyQuickGuide version={version} />'),'The dedicated public cancellation explainer preserves the full legal source text and inserts the shared versioned guide');
assert(checkoutProtection.includes('showV16RenterPolicy && <CancellationPolicyQuickGuide includeCompanyCancellation={false} version="2026-10-v16" />'));
assert(checkoutProtection.includes('cancellationPolicySummary(version)')&&checkoutProtection.includes('{renterPolicySummary}')&&cancellationPolicySummary('2026-11-v29')?.includes('scheduled pickup'),'Checkout uses the shared summary with separate start and pickup clocks');
const landing=fs.readFileSync(path.join(__dirname,'../src/app/page.tsx'),'utf8');
assert(landing.includes('cancellationPolicySummary(cancellationPolicyVersion)')&&landing.includes('Cancellation terms at a glance'),'The landing page uses the same current-policy summary as checkout');
const React=require('react'),{renderToStaticMarkup}=require('react-dom/server');
const guideJs=ts.transpileModule(guide,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020,jsx:ts.JsxEmit.ReactJSX}}).outputText;
const guideModule={exports:{}};new Function('require','module','exports',guideJs)(require,guideModule,guideModule.exports);
const Guide=guideModule.exports.CancellationPolicyQuickGuide;
const renderedV21=renderToStaticMarkup(React.createElement(Guide,{version:'2026-11-v21'}));
const renderedV22=renderToStaticMarkup(React.createElement(Guide,{version:'2026-11-v22'}));
assert.equal(renderedV22,renderedV21,'v22 renders the same current cancellation outcomes as v21');
assert.match(renderedV22,/More than 48 hours before pickup/);
assert.match(renderedV22,/And 7 days or less before the first item starts/);
assert.match(renderedV22,/48 hours or less before pickup/);
assert.match(renderedV22,/The seven-day window uses London calendar days/);
const renderedV23=renderToStaticMarkup(React.createElement(Guide,{version:'2026-11-v23'}));
assert.match(renderedV23,/7\+ days before first item starts/);
assert.match(renderedV23,/More than 48 hours before pickup/);
assert.match(renderedV23,/But fewer than 7 days before the first item starts/);
assert.match(renderedV23,/48 hours or less before pickup/);
assert.doesNotMatch(renderedV23,/More than 7 days before first item starts/);
assert.match(renderedV23,/If equipment is unexpectedly unavailable/);
assert.doesNotMatch(renderedV23,/DB Cinema cancels a confirmed rental before pickup for any reason/);
const renderedV24=renderToStaticMarkup(React.createElement(Guide,{version:'2026-11-v24'}));
const renderedV25=renderToStaticMarkup(React.createElement(Guide,{version:'2026-11-v25'}));
const renderedV26=renderToStaticMarkup(React.createElement(Guide,{version:'2026-11-v26'}));
const renderedV27=renderToStaticMarkup(React.createElement(Guide,{version:'2026-11-v27'}));
const renderedV28=renderToStaticMarkup(React.createElement(Guide,{version:'2026-11-v28'}));
const renderedV29=renderToStaticMarkup(React.createElement(Guide,{version:'2026-11-v29'}));
const renderedV30=renderToStaticMarkup(React.createElement(Guide,{version:'2026-11-v30'}));
const renderedV31=renderToStaticMarkup(React.createElement(Guide,{version:'2026-11-v31'}));
const renderedV32=renderToStaticMarkup(React.createElement(Guide,{version:'2026-11-v32'}));
assert.equal(renderedV32,renderedV31,'v32 retains the v31 renter cancellation outcomes and timing labels');
const renderedV33=renderToStaticMarkup(React.createElement(Guide,{version:'2026-11-v33'}));
const renderedV34=renderToStaticMarkup(React.createElement(Guide,{version:'2026-11-v34'}));
assert.notEqual(renderedV33,renderedV32,'v33 updates only the policy for newly accepted rentals');
assert.equal((renderedV34.match(/role="progressbar"/g)||[]).length,3,'The current guide shows one non-additive return-value bar per cancellation window');
assert.match(renderedV34,/Choose one/,'The full-value alternatives are presented as a mutually exclusive choice');
assert.doesNotMatch(renderedV34,/Choose one option; refund and credit do not stack/,'The option explanation is not redundantly repeated below the amount bar');
assert.doesNotMatch(renderedV34,/Cash refund<\/span>/,'The guide does not imply that separate cash and credit amounts are both returned');
assert.match(renderedV33,/7\+ days before first item starts/);
assert.match(renderedV33,/48 hours or more before pickup/);
assert.match(renderedV33,/But fewer than 7 days before the first item starts/);
assert.match(renderedV33,/Less than 48 hours before pickup/);
assert.match(renderedV33,/Confirmed rental cancelled before pickup: full refund or eligible 130% account credit/);
assert.match(renderedV33,/Restricted or rejected accounts cannot receive 130% credit/);
assert.notEqual(renderedV34,renderedV33,'v34 changes only the exact 48-hour cancellation cutoff');
assert.match(renderedV34,/More than 48 hours before pickup/);
assert.match(renderedV34,/48 hours or less before pickup/);
assert.match(renderedV34,/No refund or credit/);
assert.match(renderedV34,/Restricted or rejected accounts cannot receive 130% credit/);
assert.match(renderedV34,/48 hours or less before pickup/,'the v34 renter-facing guide matches the accepted no-refund boundary');
assert.match(renderedV24,/If DB Cinema cancels/);
assert.match(renderedV24,/Confirmed rental cancelled before pickup: full refund or eligible 130% account credit/);
assert.match(renderedV24,/Restricted or rejected accounts cannot receive 130% credit/);
assert.match(renderedV25,/If DB Cinema cancels/);
assert.match(renderedV25,/Restricted or rejected accounts cannot receive 130% credit/);
assert.match(renderedV26,/If DB Cinema cancels/);
assert.match(renderedV26,/Restricted or rejected accounts cannot receive 130% credit/);
assert.match(renderedV26,/48 hours or less before pickup/,'The renter-facing guide uses the same inclusive 48-hour no-refund cutoff as the server');
assert.match(renderedV26,/More than 48 hours before pickup/,'The renter-facing guide gives credit-only in the middle window');
assert.match(renderedV26,/But fewer than 7 days before the first item starts/);
assert.equal(renderedV27,renderedV26,'v27 keeps v26 customer-facing outcomes and boundary descriptions');
assert.match(renderedV28,/48 hours or more before pickup/,'The v28 guide includes exactly 48 hours in the credit-only window');
assert.match(renderedV29,/48 hours or more before pickup/,'The v29 guide states the inclusive 48-hour cutoff');
assert.match(renderedV29,/But fewer than 7 days before the first item starts/);
assert.match(renderedV29,/Less than 48 hours before pickup/);
assert.match(renderedV29,/London time: seven-day window uses first item start/);
assert.match(renderedV30,/More than 48 hours before pickup/,'The v30 guide reflects the credit-only cutoff strictly outside 48 hours');
assert.match(renderedV30,/But fewer than 7 days before the first item starts/);
assert.match(renderedV30,/48 hours or less before pickup/,'The v30 guide puts exactly 48 hours in the no-refund window');
assert.match(renderedV30,/No refund/);
assert.match(renderedV30,/No account credit/);
assert.equal(renderedV31,renderedV30,'v31 changes verification timing only; cancellation guide outcomes remain unchanged');
assert.match(renderedV28,/Less than 48 hours before pickup/,'The v28 guide shows no refund/credit only inside 48 hours');
assert.match(renderedV28,/No refund/);
assert.match(renderedV28,/No account credit/);
assert.match(renderedV28,/If DB Cinema cancels/);
assert.match(renderedV28,/Restricted or rejected accounts cannot receive 130% credit/);
const renderedV18=renderToStaticMarkup(React.createElement(Guide,{version:'2026-11-v18'}));
assert.match(renderedV18,/7 days or less/,'Historical seven-day policy remains unchanged');
const {faqsForLegalVersion}=load('src/lib/currentFaqs.ts');
const v33GafferCancellation=faqsForLegalVersion('2026-11-v33').find(faq=>faq.q==='How do cancellations work?').a;
assert.match(v33GafferCancellation,/Cancelling at least 48 hours before scheduled pickup/);
assert.match(v33GafferCancellation,/exactly 48 hours remains credit-only/);
assert.match(v33GafferCancellation,/less than 48 hours.*no rental refund or credit/);
assert.match(v33GafferCancellation,/130% account credit/);
const gafferFacts=load('convex/lib/gafferCancellationFacts.ts').gafferCancellationFacts(multiItemV33,at(2026,11,8,15));
assert.equal(gafferFacts.termsVersion,'2026-11-v33');
assert.equal(gafferFacts.policy,'store_credit','Gaffer rental-specific facts follow the exact v33 cutoff instead of generic FAQ fallbacks');
assert.equal(gafferFacts.timingBasis,'At least 48 hours before scheduled pickup, and fewer than seven London calendar days before the earliest equipment start');
const gafferV34Facts=load('convex/lib/gafferCancellationFacts.ts').gafferCancellationFacts(multiItemV34,at(2026,11,8,15));
assert.equal(gafferV34Facts.termsVersion,'2026-11-v34');
assert.equal(gafferV34Facts.policy,'no_refund','Gaffer rental-specific facts use the current exact-48-hour no-refund/no-credit cutoff');
assert.equal(gafferV34Facts.timingBasis,'48 hours or less before scheduled pickup');
console.log('PASS: London cancellation windows, DST, settlement limits, and v16-v34 versioned wording/guide rendering stay aligned.');
