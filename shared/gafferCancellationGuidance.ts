type CancellationEligibilityBooking = {
  stage?: string;
  verification?: { status?: string | null; expired?: boolean; lateApprovalBlocked?: boolean };
  cancellation?: {
    policy?: "full_refund" | "store_credit" | "no_refund" | null;
    termsVersion?: string | null;
    termsText?: string | null;
    timingBasis?: string | null;
    decisionPending?: boolean;
  };
};

export function cancellationEligibilityRecovery(message: string, booking: CancellationEligibilityBooking | null | undefined, accountRentalCount?: number): string | null {
  const text = message.toLowerCase().replace(/[’]/g, "'");
  const asksEligibility = /(?:\b(?:am i|can i|could i|would i|will i|do i|is my|can you tell|can you check|can you confirm)\b.{0,100}\b(?:eligible|qualif\w*|entitled|refund\w*|money back|account credit|cancel\w*)\b|\b(?:eligible|eligibility|qualif\w*|entitled)\b.{0,80}\b(?:refund\w*|money back|account credit|cancel\w*)?\b)/.test(text);
  if (!asksEligibility) return null;
  if (/\b(?:what if|what happens if|suppose)\b|\bif i (?:cancel|cancelled|were to cancel)\b.{0,80}\b(?:in|within|at least|more than|less than|before|after)\b/.test(text)) return null;
  const asksToExecute = /\b(?:please|i want to|i'd like to|i need you to|can you|could you)\s+(?:cancel|refund|issue|apply|pay)\b.{0,70}\b(?:my|the|this)?\s*(?:booking|rental|reservation|payment|refund|credit)?\b|\b(?:cancel|refund)\s+(?:my|the|this)\s+(?:booking|rental|reservation|payment)\b/.test(text);
  if (asksToExecute) return null;
  if (!booking && accountRentalCount !== undefined && accountRentalCount > 1)
    return "Which rental do you mean? Share an item name or pickup date and I’ll check that rental’s signed terms. Nothing has been changed.";
  if (!booking) return "I can check the cancellation window, but I need the rental selected so I can use its signed terms and pickup time. Open that rental's chat and ask me there.";
  const cancellation = booking.cancellation;
  if (!cancellation?.termsVersion || !cancellation.termsText) return "I can't verify the signed cancellation terms saved for this rental, so I won't guess whether a refund or credit applies. No cancellation or refund has been made.";
  if (booking.stage !== "confirmed" || booking.verification?.status !== "verified" || booking.verification.expired || booking.verification.lateApprovalBlocked || cancellation.decisionPending) return null;
  const timing = cancellation.timingBasis ? ` ${cancellation.timingBasis}.` : "";
  if (cancellation.policy === "full_refund") return `Based on this rental's recorded dates and pickup time, the full-refund window applies under the terms you accepted (${cancellation.termsVersion}).${timing} This is an eligibility check only; nothing has been cancelled or refunded. Any refundable security is handled separately.`;
  if (cancellation.policy === "store_credit") return `Based on this rental's recorded dates and pickup time, the account-credit-only window applies under the terms you accepted (${cancellation.termsVersion}).${timing} No cash refund applies in this window. This is an eligibility check only; nothing has been cancelled or credited. Any refundable security is handled separately.`;
  if (cancellation.policy === "no_refund") return `Based on this rental's recorded pickup time, the no-rental-refund/no-credit window applies under the terms you accepted (${cancellation.termsVersion}).${timing} Any refundable security is handled separately. This is an eligibility check only; nothing has been cancelled or refunded.`;
  return null;
}
