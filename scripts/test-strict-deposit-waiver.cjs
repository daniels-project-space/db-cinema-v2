const assert = require('node:assert/strict');
const { load, db, put } = require('./lib/rentalTestHarness.cjs');
const { strictDepositWaiverReason } = load('convex/lib/strictDepositWaiver.ts');
const { reviewContext } = load('convex/lib/reviewContext.ts');
const { reviewSettlementFingerprint } = load('convex/lib/reviewEligibility.ts');

const DAY = 86400000;
const ctx = { db };

function cleanPriorRental(account, index) {
  const returnedAt = Date.now() - (index + 1) * DAY;
  const inspection = [{ key: `legacy:0:${index}`, title: 'Camera', condition: 'good', details: '', openCase: false }];
  const line = {
    listingId: `listing-${index}`,
    title: 'Camera',
    qty: 1,
    start: Date.UTC(2025, 0, 1 + index * 5),
    end: Date.UTC(2025, 0, 2 + index * 5),
    lineTotal: 100,
  };
  return put('bookings', {
    accountId: account._id,
    guestEmail: account.email,
    status: 'returned',
    stripeCheckoutSessionId: `cs-clean-${account._id}-${index}`,
    depositAmount: 0,
    depositHoldAmount: 0,
    total: 100,
    subtotal: 100,
    paidConfirmedAt: returnedAt - DAY,
    actualReturnedAt: returnedAt,
    lineItems: [line],
    returnDecision: {
      actualReturnedAt: returnedAt,
      damageKept: 0,
      depositKept: 0,
      chargeLate: false,
      inspection,
    },
    returnStatement: {
      actualReturnedAt: returnedAt,
      inspection,
      rentalRefunded: 0,
      securityPaid: 0,
      securityRefunded: 0,
      holdStatus: 'not_applicable',
      damageTotal: 0,
      damageFromHold: 0,
      lateAssessed: 0,
      lateWaived: 0,
    },
  });
}

(async () => {
  const manualEncore = put('accounts', { email: 'manual-encore@example.invalid', adminEncoreLevel: 3 });
  cleanPriorRental(manualEncore, 0);
  assert.equal(
    await strictDepositWaiverReason(ctx, manualEncore, 99900),
    undefined,
    'an admin Encore III override with only one clean rental does not waive security',
  );

  const firstRentalPaidMember = put('accounts', {
    email: 'first-rental-paid-member@example.invalid',
    stripeSubscriptionId: 'sub_first_rental',
    membershipActive: true,
    membershipStatus: 'active',
    membershipPaidThrough: Date.now() + DAY,
  });
  put('membership_credit_grants', {
    accountId: firstRentalPaidMember._id,
    subscriptionId: 'sub_first_rental',
    invoiceId: 'in_first_rental',
    paidMembershipPence: 4900,
    periodEnd: Date.now() + DAY,
    membershipRefundedPence: 0,
  });
  assert.equal(
    await strictDepositWaiverReason(ctx, firstRentalPaidMember, 99900),
    undefined,
    'a paid subscription cannot waive security on the account’s first rental',
  );

  const trialMember = put('accounts', {
    email: 'trial-member@example.invalid',
    stripeSubscriptionId: 'sub_trial',
    membershipActive: true,
    membershipStatus: 'active',
    membershipPaidThrough: Date.now() + DAY,
  });
  cleanPriorRental(trialMember, 0);
  assert.equal(
    await strictDepositWaiverReason(ctx, trialMember, 99900),
    undefined,
    'a free trial without a paid invoice cannot waive security',
  );

  const issueMember = put('accounts', {
    email: 'issue-member@example.invalid',
    stripeSubscriptionId: 'sub_issue',
    membershipActive: true,
    membershipStatus: 'active',
    membershipPaidThrough: Date.now() + DAY,
  });
  const issueRental = cleanPriorRental(issueMember, 0);
  issueRental.returnDecision.inspection[0].condition = 'damaged';
  issueRental.returnDecision.inspection[0].details = 'Scuff reported';
  put('membership_credit_grants', {
    accountId: issueMember._id,
    subscriptionId: 'sub_issue',
    invoiceId: 'in_issue',
    paidMembershipPence: 4900,
    periodEnd: Date.now() + DAY,
    membershipRefundedPence: 0,
  });
  assert.equal(
    await strictDepositWaiverReason(ctx, issueMember, 99900),
    undefined,
    'a paid member with no clean completed return cannot waive security',
  );

  const earnedEncore = put('accounts', { email: 'earned-encore@example.invalid' });
  for (let index = 0; index < 3; index++) {
    const booking = cleanPriorRental(earnedEncore, index);
    booking.reviewEligibilityFingerprint = reviewSettlementFingerprint(await reviewContext(ctx, booking));
    put('reviews', {
      verifiedBookingId: booking._id,
      source: 'native',
      authorAccountId: earnedEncore._id,
      rating: 5,
      text: 'A verified rental review.',
    });
  }
  assert.equal(
    await strictDepositWaiverReason(ctx, earnedEncore, 399999),
    'encore',
    'three qualifying owned reviews retain the earned Encore III waiver',
  );

  const member = put('accounts', {
    email: 'paid-member@example.invalid',
    stripeSubscriptionId: 'sub_paid',
    membershipActive: true,
    membershipStatus: 'active',
    membershipPaidThrough: Date.now() + DAY,
  });
  cleanPriorRental(member, 0);
  const grant = put('membership_credit_grants', {
    accountId: member._id,
    subscriptionId: 'sub_paid',
    invoiceId: 'in_paid',
    paidMembershipPence: 4900,
    periodEnd: Date.now() + DAY,
    membershipRefundedPence: 0,
  });
  assert.equal(
    await strictDepositWaiverReason(ctx, member, 399999),
    'active_membership',
    'a current paid invoice grant for the active subscription qualifies',
  );
  await db.patch(grant._id, { membershipRefundedPence: grant.paidMembershipPence });
  assert.equal(
    await strictDepositWaiverReason(ctx, member, 399999),
    undefined,
    'a fully refunded paid invoice no longer qualifies',
  );
  console.log('PASS strict deposit waiver: no first-booking or trial bypass, clean-return requirement, earned Encore, active paid invoice, and full-refund invalidation.');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
