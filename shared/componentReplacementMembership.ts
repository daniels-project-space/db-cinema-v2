import { agreementRequestFingerprint } from "./rentalAgreement";
import { hasFirstEligibleRentalConfirmation, membershipActiveNow, membershipRentalBenefitsActiveNow, membershipTierFor, paidDepositExempt } from "./membership";
import { memberRentalBenefitCandidates, membershipDeliveryBenefit } from "./rentalBenefits";

export function replacementMembershipFingerprint(account: any) {
  return agreementRequestFingerprint(account ? {
    active: membershipActiveNow(account), rentalBenefitsActive: membershipRentalBenefitsActiveNow(account), tier: membershipTierFor(account) ?? null,
    firstRental: hasFirstEligibleRentalConfirmation(account), depositExempt: paidDepositExempt(account),
    rentalCandidates: memberRentalBenefitCandidates({ account, subtotalPence: 1000000, weekendSavingPence: 10000 }),
    deliveryStandard: membershipDeliveryBenefit(account, 10000, false), deliveryStudio: membershipDeliveryBenefit(account, 10000, true),
    introUsed: !!account.membershipIntroUsed, signupOfferUsed: !!account.membershipSignupOfferUsed, starterOfferUsed: !!account.starterRentalOfferUsed,
    creditDebtPence: account.membershipCreditDebtPence ?? 0, pendingPerksBooking: account.membershipPerksPendingBookingId ?? null,
    blocked: account.blockedAt != null,
  } : null);
}
