const assert = require('node:assert/strict');
const { load, db, put } = require('./lib/rentalTestHarness.cjs');
const { strictDepositWaiverReason } = load('convex/lib/strictDepositWaiver.ts');
const { reviewContext } = load('convex/lib/reviewContext.ts');
const { reviewSettlementFingerprint } = load('convex/lib/reviewEligibility.ts');
const { seedVerificationFiles } = require('./lib/verificationFiles.cjs');
const { depositWaiverEligibility,currentCheckoutWaiver } = load('convex/bookings.ts');
const security=load('shared/rentalSecurity.ts');

const DAY = 86400000;
const ctx = { db };

function verifiedAccount(email) {
  const now=Date.now();
  const account=put('accounts',{email,name:'Waiver Customer',address:'1 Example Road, London',emailVerifiedAt:now-DAY});
  const source=put('bookings',{accountId:account._id,accountAccessRequired:false,guestEmail:account.email,
    agreementName:account.name,billingAddress:account.address,diditSessionId:`didit-${account._id}`,
    verificationProvider:'didit',idVerificationSource:'didit',idVerifyStatus:'verified',
    verificationChecks:{identity:'approved',selfie:'approved',address:'approved'},status:'confirmed'});
  account.rentalVerification={sourceBookingId:source._id,name:'waiver customer',address:'1 example road, london',
    verifiedAt:now-10*DAY,expiresAt:now+80*DAY};
  const archive=put('verification_archives',{bookingId:source._id,accountId:account._id,sessionId:source.diditSessionId,
    email:account.email,source:'didit',status:'complete',attempts:1,dueAt:now,createdAt:now});
  seedVerificationFiles(put,archive);
  return account;
}

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
    currency:'GBP',
    paidConfirmedAt: returnedAt - DAY,
    checkoutPaidAt:returnedAt-DAY,
    checkoutPaymentAmountPence:10000,
    checkoutPaymentCurrency:'GBP',
    checkoutPaymentStatus:'paid',
    checkoutCreditState:'spent',
    stripePaymentIntentId:`pi-clean-${account._id}-${index}`,
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
  assert.equal(await strictDepositWaiverReason(ctx,null,99900),undefined,'guests without an account can never receive a waiver');
  const manualEncore = verifiedAccount('manual-encore@example.invalid');
  manualEncore.adminEncoreLevel=3;
  cleanPriorRental(manualEncore, 0);
  assert.equal(
    await strictDepositWaiverReason(ctx, manualEncore, 99900),
    undefined,
    'an admin Encore III override with only one clean rental does not waive security',
  );

  const firstRentalPaidMember = verifiedAccount('first-rental-paid-member@example.invalid');
  Object.assign(firstRentalPaidMember, {
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

  const trialMember = verifiedAccount('trial-member@example.invalid');
  Object.assign(trialMember, {
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

  const complimentary=verifiedAccount('complimentary@example.invalid');
  Object.assign(complimentary,{stripeSubscriptionId:'sub_comp',membershipActive:true,membershipStatus:'active',
    membershipSource:'collective-comp',membershipPaidThrough:Date.now()+DAY});
  cleanPriorRental(complimentary,0);
  put('membership_credit_grants',{accountId:complimentary._id,subscriptionId:'sub_comp',invoiceId:'in_comp',
    paidMembershipPence:4900,periodEnd:Date.now()+DAY,membershipRefundedPence:0});
  assert.equal(await strictDepositWaiverReason(ctx,complimentary,99900),undefined,'complimentary membership never qualifies even if stale paid-grant data exists');

  const issueMember = verifiedAccount('issue-member@example.invalid');
  Object.assign(issueMember, {
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

  const disputedMember=verifiedAccount('disputed-rental-member@example.invalid');
  Object.assign(disputedMember,{stripeSubscriptionId:'sub_disputed',membershipActive:true,membershipStatus:'active',membershipPaidThrough:Date.now()+DAY});
  const disputedRental=cleanPriorRental(disputedMember,0);
  disputedRental.stripeDisputedAt=Date.now()-DAY;
  disputedRental.stripeDisputeId='dp_synthetic';
  disputedRental.stripeDisputeStatus='won';
  put('membership_credit_grants',{accountId:disputedMember._id,subscriptionId:'sub_disputed',invoiceId:'in_disputed',
    paidMembershipPence:4900,periodEnd:Date.now()+DAY,membershipRefundedPence:0});
  assert.equal(await strictDepositWaiverReason(ctx,disputedMember,99900),undefined,
    'a prior rental with a Stripe dispute is not treated as issue-free even after the bank closes it');

  const earnedEncore = verifiedAccount('earned-encore@example.invalid');
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

  const member = verifiedAccount('paid-member@example.invalid');
  Object.assign(member, {
    email: 'paid-member@example.invalid',
    stripeSubscriptionId: 'sub_paid',
    membershipActive: true,
    membershipStatus: 'active',
    membershipPaidThrough: Date.now() + DAY,
  });
  const cleanPaidRental=cleanPriorRental(member, 0);
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
  assert.equal(await strictDepositWaiverReason(ctx,member,400000),undefined,'£4,000 exactly is outside the waiver boundary');
  assert.equal(await strictDepositWaiverReason(ctx,member,399999,[Date.now()+81*DAY],member.name,member.address),undefined,'verification must remain valid through the new rental start');
  const quoted=await depositWaiverEligibility.handler(ctx,{accountId:member._id,replacementValuePence:399999,
    starts:[Date.now()+DAY],agreementName:member.name,billingAddress:member.address});
  const created=await strictDepositWaiverReason(ctx,member,399999,[Date.now()+DAY],member.name,member.address);
  assert.equal(quoted,created,'the quote and checkout use the same server eligibility decision');
  const pending=put('bookings',{status:'pending_payment',accountId:member._id,securityPolicyVersion:security.ASSESSMENT_SECURITY_POLICY_VERSION,
    securityWaiverReason:'active_membership',agreementName:member.name,billingAddress:member.address,
    lineItems:[{listingId:'waiver-listing',start:Date.now()+DAY,end:Date.now()+2*DAY,qty:1}],
    replacementValues:[{listingId:'waiver-listing',unitPence:399999}]});
  assert.equal(await currentCheckoutWaiver.handler(ctx,{bookingId:pending._id}),'active_membership','an unpaid session retains its waiver only while the current proof still qualifies');
  member.membershipPaidThrough=Date.now()-1;
  assert.equal(await currentCheckoutWaiver.handler(ctx,{bookingId:pending._id}),undefined,'a pending unpaid session detects a membership that stopped qualifying');
  member.membershipPaidThrough=Date.now()+DAY;
  const missingReceipt=cleanPaidRental;missingReceipt.checkoutPaymentAmountPence=undefined;missingReceipt.checkoutPaymentCurrency=undefined;missingReceipt.checkoutPaymentStatus=undefined;
  assert.equal(await strictDepositWaiverReason(ctx,member,399999),'active_membership','legacy closed rentals keep their original verified paid Checkout receipt');
  missingReceipt.checkoutPaidAt=undefined;missingReceipt.stripePaymentIntentId=undefined;
  assert.equal(await strictDepositWaiverReason(ctx,member,399999),undefined,'a completed rental without any provider payment receipt does not qualify');
  missingReceipt.checkoutPaidAt=Date.now();missingReceipt.stripePaymentIntentId='pi-restored';missingReceipt.checkoutPaymentAmountPence=10000;missingReceipt.checkoutPaymentCurrency='USD';missingReceipt.checkoutPaymentStatus='paid';
  assert.equal(await strictDepositWaiverReason(ctx,member,399999),undefined,'a mismatched provider currency does not qualify');
  missingReceipt.checkoutPaymentCurrency='GBP';
  missingReceipt.stripePaymentIntentId=undefined;
  assert.equal(await strictDepositWaiverReason(ctx,member,399999),undefined,'a card-paid rental without its Stripe payment intent does not qualify');
  missingReceipt.stripePaymentIntentId='pi-restored';
  const badVerification=verifiedAccount('expired-verification@example.invalid');
  badVerification.rentalVerification.verifiedAt=Date.now()-91*DAY;badVerification.rentalVerification.expiresAt=Date.now()-DAY;
  cleanPriorRental(badVerification,0);
  badVerification.stripeSubscriptionId='sub_bad_verification';badVerification.membershipActive=true;badVerification.membershipStatus='active';badVerification.membershipPaidThrough=Date.now()+DAY;
  put('membership_credit_grants',{accountId:badVerification._id,subscriptionId:badVerification.stripeSubscriptionId,invoiceId:'in_bad',paidMembershipPence:4900,periodEnd:Date.now()+DAY,membershipRefundedPence:0});
  assert.equal(await strictDepositWaiverReason(ctx,badVerification,399999),undefined,'expired verification blocks an otherwise eligible account');
  await db.patch(grant._id, { membershipRefundedPence: grant.paidMembershipPence });
  assert.equal(
    await strictDepositWaiverReason(ctx, member, 399999),
    undefined,
    'a fully refunded paid invoice no longer qualifies',
  );
  console.log('PASS strict deposit waiver: verified ownership, provider-paid clean history, exact value boundary, paid subscription or earned Encore, no guest/trial/comp/expired-verification bypass, and quote-to-checkout consistency.');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
