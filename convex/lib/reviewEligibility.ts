import { verificationDeadlinePassed } from "../../shared/verificationProgress";
import { dateLabel, londonRentalInstant } from "../../shared/rentalWindow";
import { hasCheckoutPaymentProof, checkoutCreditFullyCoversDue, expectedCheckoutPaymentPence } from "./cleanCompletedRental";
import { hasBookingDiditApproval } from "./renterRentalActionGate";

function reviewPaymentConfirmed(b: any): boolean {
  if (!Number.isSafeInteger(b?.paidConfirmedAt) || b.paidConfirmedAt <= 0) return false;
  const expectedPaidPence = expectedCheckoutPaymentPence(b);
  if (!Number.isSafeInteger(expectedPaidPence) || expectedPaidPence < 0) return false;
  if (["checkoutPaidAt", "checkoutPaymentAmountPence", "checkoutPaymentCurrency", "checkoutPaymentStatus"]
    .some(key => b[key] !== undefined)) return hasCheckoutPaymentProof(b, expectedPaidPence);
  if (expectedPaidPence > 0) return typeof b.stripePaymentIntentId === "string" && b.stripePaymentIntentId.trim().length > 0;
  return b.checkoutCreditState === "spent" && checkoutCreditFullyCoversDue(b);
}

/** Review requests require settled security, not merely the scheduled end date. */
export function reviewFollowUpClaimed(b: any): boolean {
  return b.remindedReview === true || !!b.reviewInvitationMessageId ||
    ["sending", "sent", "failed"].includes(b.reviewFollowUpStatus ?? "");
}

export function reviewGate(b: any): string | null {
  if (reviewFollowUpClaimed(b)) return "already_sent";
  const reason = customerReviewGate(b);
  if (reason) return reason;
  if ((b.returnedAt || b.actualReturnedAt || b.returnDecision?.actualReturnedAt || (b.lineItems ?? []).some((line: any) => Number.isFinite(line.end))) &&
      Date.now() < reviewFollowUpDueAt(b)) return "review_not_due";
  return null;
}

export function reviewFollowUpDueAt(b: any, now = Date.now()): number {
  const itemEnds = (b.lineItems ?? []).map((line: any) => {
    if (!Number.isFinite(line.end)) return 0;
    const returnTime = line.returnTime ?? b.returnTime;
    if (typeof returnTime === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(returnTime)) {
      try { return londonRentalInstant(dateLabel(line.end), returnTime); } catch {}
    }
    return line.end + 86400000;
  });
  const returnAnchor = Math.max(b.returnedAt ?? 0, b.actualReturnedAt ?? 0, b.returnDecision?.actualReturnedAt ?? 0, ...itemEnds);
  const settledReturnDue = returnAnchor ? returnAnchor + 86400000 : 0;
  if (b.reviewFollowUpDueAt) return Math.max(b.reviewFollowUpDueAt, settledReturnDue);
  return returnAnchor ? settledReturnDue : now + 86400000;
}
/** An email already sent does not stop its recipient writing the review. */
export function customerReviewGate(b: any): string | null {
  if (b.status !== "returned") return "not_returned";
  if (!Number.isFinite(b.pickedUpAt)) return "not_collected";
  if (b.verificationLateBlockedAt && !b.verificationLateOverrideAt) return "verification_window_passed";
  if (b.verificationProvider === "didit" ? !hasBookingDiditApproval(b) : b.idVerifyStatus !== "verified")
    return verificationDeadlinePassed(b) ? "verification_window_passed" : "verification_incomplete";
  if (!reviewPaymentConfirmed(b)) return "payment_unconfirmed";
  if (b.accountRestricted) return "account_restricted";
  if (b.hasOpenExtensionRequest) return "extension_request_open";
  if ((b.depositKept ?? 0) > 0 || (b.depositHoldCapturedForDamage ?? 0) > 0 ||
      (b.returnDecision?.damageKept ?? 0) > 0 || (b.lateFeePaidFromHold ?? 0) > 0)
    return "deposit_retained";
  if (b.returnDecision && !b.actualReturnedAt) return "return_settlement_pending";
  if ((b.depositHoldAmount ?? 0) > 0 && !b.stripeDepositIntentId && !b.depositHoldRenewalIntentId &&
      !(b.depositHoldPreviousIntentIds ?? []).some(Boolean)) return "hold_release_unverified";
  if (b.depositAmount > 0 && !b.depositRefunded) return "refund_not_settled";
  if (b.depositRefundAmount !== undefined && b.depositRefundAmount < b.depositAmount)
    return "partial_refund";
  if ((b.lateFeeAmount ?? 0) > 0 && !["paid", "waived", "none"].includes(b.lateFeeStatus ?? ""))
    return "late_settlement_pending";
  return null;
}
export function reviewSettlementFingerprint(b: any): string {
  const returnSchedule = (b.lineItems ?? []).map((line: any) => [line.listingId ?? null, line.start ?? null, line.end ?? null,
    line.returnTime ?? b.returnTime ?? null, line.qty ?? null]);
  return JSON.stringify([reviewFingerprint(b), b.hasOpenExtensionRequest === true, returnSchedule,
    [...(b.paymentSources ?? [])].sort((a, c) => a.paymentIntentId.localeCompare(c.paymentIntentId)),
    [...(b.unappliedSecurityPayments ?? [])].sort(), [...(b.rentalRefundIds ?? [])].sort()]);
}
export function reviewFingerprint(b: any): string {
  return JSON.stringify([b.status,b.verificationProvider,b.idVerifyStatus,b.idVerificationSource,b.verificationChecks,b.idVerifiedAt,b.verificationExpiresAt,
    b.verificationLateBlockedAt,b.verificationLateBlockedEventId,b.verificationLateBlockedProviderStatus,b.verificationLateOverrideAt,
    b.depositAmount,b.depositRefunded,b.depositRefundAmount,
    b.depositKept,b.depositHoldCapturedForDamage,b.returnDecision?.damageKept,
    b.lateFeeAmount,b.lateFeeStatus,b.lateFeePaidFromHold,b.stripePaymentIntentId,
    b.paidConfirmedAt,b.checkoutPaidAt,b.checkoutPaymentAmountPence,b.checkoutPaymentCurrency,b.checkoutPaymentStatus,
    b.checkoutExpectedAmountPence,b.checkoutCreditState,b.rentalPaidPence,b.total,b.subtotal,b.deliveryFee,b.discount,b.creditApplied,b.currency,
    b.stripeDepositIntentId,b.depositHoldStatus,b.depositHoldRenewalIntentId,b.depositHoldPreviousIntentIds,
    b.pickedUpAt,b.actualReturnedAt,b.guestEmail]);
}
export function reviewSuppressed(reason: string): boolean {
  return ["account_restricted", "deposit_retained", "partial_refund", "verification_window_passed", "not_collected", "payment_unconfirmed"].includes(reason);
}
