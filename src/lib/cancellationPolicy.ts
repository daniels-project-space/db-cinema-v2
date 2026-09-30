/** One policy for the cancellation action, account UI, and signed agreement. */
export const CANCELLATION_FULL_REFUND_DAYS = 3;
export const CANCELLATION_CREDIT_DAYS = 90;

export function londonStartOfDay(ms: number): number {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(new Date(ms));
  const year = Number(parts.find((part) => part.type === "year")!.value);
  const month = Number(parts.find((part) => part.type === "month")!.value);
  const day = Number(parts.find((part) => part.type === "day")!.value);
  return Date.UTC(year, month - 1, day);
}

export function cancelKind(start: number, now: number): "full_refund" | "store_credit" {
  const days = Math.round((londonStartOfDay(start) - londonStartOfDay(now)) / 86400000);
  return days >= CANCELLATION_FULL_REFUND_DAYS ? "full_refund" : "store_credit";
}

/** Amounts in pence. The card refund is bounded by Stripe's captured payment;
 * previously redeemed account credit is restored only after confirmation used it. */
export function cancellationSettlement(
  kind: "full_refund" | "store_credit",
  paidPence: number,
  securityPence: number,
  redeemedCreditPence: number,
  restoreRedeemedCredit: boolean,
): { refundPence: number; creditPence: number } {
  if (![paidPence, securityPence, redeemedCreditPence].every((amount) =>
    Number.isSafeInteger(amount) && amount >= 0)) throw new Error("Invalid cancellation amount");
  const restored = restoreRedeemedCredit ? redeemedCreditPence : 0;
  if (kind === "full_refund") return { refundPence: paidPence, creditPence: restored };
  const refundPence = Math.min(paidPence, securityPence);
  return { refundPence, creditPence: paidPence - refundPence + restored };
}
