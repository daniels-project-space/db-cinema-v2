const assert = require('node:assert/strict');
const { load } = require('./lib/rentalTestHarness.cjs');
const { voiceCartShareSignature, voiceCartReviewSignature } = load('src/components/gaffer/cartSnapshot.ts');
const original = { listingId: 'camera', start: '2026-11-20', end: '2026-11-21', pickupTime: '10:00', returnTime: '17:00', days: 2, perDay: 30, total: 60, deposit: 50 };
const share = voiceCartShareSignature([original]);
for (const change of [{ pickupTime: '11:00' }, { returnTime: '18:00' }, { start: '2026-11-19' }, { end: '2026-11-22' }, { listingId: 'lens' }])
  assert.notEqual(voiceCartShareSignature([{ ...original, ...change }]), share);
assert.notEqual(voiceCartShareSignature([original, original]), share, 'A duplicate line changes the saved basket');
assert.equal(voiceCartShareSignature([{ ...original, total: 70 }]), share, 'Saved links contain dates and items rather than client prices');
const cart = { items: [original], promo: null, membership: null };
const reviewed = voiceCartReviewSignature(cart);
for (const change of [{ pickupTime: '11:00' }, { returnTime: '18:00' }, { total: 70 }, { deposit: 100 }, { days: 3 }, { perDay: 35 }])
  assert.notEqual(voiceCartReviewSignature({ ...cart, items: [{ ...original, ...change }] }), reviewed);
assert.notEqual(voiceCartReviewSignature({ ...cart, promo: 'DB10OFF' }), reviewed);
assert.notEqual(voiceCartReviewSignature({ ...cart, membership: { tier: 'pro' } }), reviewed);
const context = { accountId:'fixture', membershipTier:'pro', membershipActive:true, creditAvailable:12, cancellationProtection:true, setupIntentSecurity:true, assessmentSecurity:false };
const withContext = voiceCartReviewSignature(cart, context);
for (const change of [{accountId:'other'}, {membershipTier:'standard'}, {membershipActive:false}, {creditAvailable:0}, {cancellationProtection:false}, {setupIntentSecurity:false}, {assessmentSecurity:true}])
  assert.notEqual(voiceCartReviewSignature(cart, {...context,...change}), withContext, 'Changes to the checkout account or policy require another review');
console.log('PASS Gaffer basket snapshots: times, line count, pricing and membership changes invalidate the appropriate review or shared-link state.');
