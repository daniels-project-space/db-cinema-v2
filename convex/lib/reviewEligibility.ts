/** Review requests require settled security, not merely the scheduled end date. */
export function reviewGate(b: any): string | null {
  if (b.remindedReview || b.reviewFollowUpStatus === "sent") return "already_sent";
  if (b.status !== "returned") return "not_returned";
  if ((b.depositKept ?? 0) > 0 || (b.depositHoldCapturedForDamage ?? 0) > 0 ||
      (b.returnDecision?.damageKept ?? 0) > 0 || (b.lateFeePaidFromHold ?? 0) > 0)
    return "deposit_retained";
  if (b.depositAmount > 0 && !b.depositRefunded) return "refund_not_settled";
  if (b.depositRefundAmount !== undefined && b.depositRefundAmount < b.depositAmount)
    return "partial_refund";
  if ((b.lateFeeAmount ?? 0) > 0 && !["paid", "waived", "none"].includes(b.lateFeeStatus ?? ""))
    return "late_settlement_pending";
  return null;
}
export function reviewFingerprint(b: any): string {
  return JSON.stringify([b.status,b.depositAmount,b.depositRefunded,b.depositRefundAmount,
    b.depositKept,b.depositHoldCapturedForDamage,b.returnDecision?.damageKept,
    b.lateFeeAmount,b.lateFeeStatus,b.lateFeePaidFromHold,b.stripePaymentIntentId,
    b.stripeDepositIntentId,b.depositHoldStatus,b.depositHoldRenewalIntentId,b.depositHoldPreviousIntentIds]);
}
export function reviewSuppressed(reason: string): boolean {
  return ["deposit_retained", "partial_refund"].includes(reason);
}
