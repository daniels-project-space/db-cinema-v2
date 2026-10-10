import { londonRentalInstant } from "../../shared/rentalWindow";
/** One policy for the cancellation action, account UI, and signed agreement. */
export const CANCELLATION_FULL_REFUND_DAYS = 14;
export const CANCELLATION_CREDIT_DAYS = 365;

export function londonStartOfDay(ms: number): number {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(new Date(ms));
  const year = Number(parts.find((part) => part.type === "year")!.value);
  const month = Number(parts.find((part) => part.type === "month")!.value);
  const day = Number(parts.find((part) => part.type === "day")!.value);
  return Date.UTC(year, month - 1, day);
}

export function cancelKind(start: number, now: number, fullRefundDays = CANCELLATION_FULL_REFUND_DAYS): "full_refund" | "store_credit" {
  const days = Math.round((londonStartOfDay(start) - londonStartOfDay(now)) / 86400000);
  return days >= fullRefundDays ? "full_refund" : "store_credit";
}

/** Preserve the more generous policy already agreed by earlier renters. */
export function cancellationDaysForBooking(booking: { agreementDocs?: { kind: string; version: string }[] }): number {
  return booking.agreementDocs?.some(d => d.kind === "cancellation" && ["2026-10-v11", "2026-10-v12"].includes(d.version))
    ? CANCELLATION_FULL_REFUND_DAYS : 3;
}

export function bookingCancelKind(booking: Parameters<typeof rentalCancellationStart>[0] & Parameters<typeof cancellationDaysForBooking>[0], now: number) {
  return cancelKind(rentalCancellationStart(booking), now, cancellationDaysForBooking(booking));
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

/** Removing kit cannot silently move the agreed cancellation deadline. */
export function rentalCancellationStart(booking: { lineItems: { start: number }[]; removedItems?: { start: number }[]; cancellationPolicyStart?: number }): number {
  if (booking.cancellationPolicyStart !== undefined) return booking.cancellationPolicyStart;
  return Math.min(...booking.lineItems.map(line => line.start), ...(booking.removedItems ?? []).map(line => line.start));
}

/** Actual current pickup, independent of the preserved cancellation-policy date.
 * Missing or invalid scheduling fails closed; an early handover also starts rental. */
export function rentalStartsAt(booking: { lineItems: { start: number; end?: number; pickupTime?: string | null }[]; pickupTime?: string | null }): number | null {
  try {
    if (!booking.lineItems.length) return null;
    const starts = booking.lineItems.map(line => londonRentalInstant(line.start,
      (line.pickupTime === undefined ? booking.pickupTime : line.pickupTime) || "00:00"));
    return Math.min(...starts);
  } catch { return null; }
}
export function rentalHasStarted(booking: Parameters<typeof rentalStartsAt>[0] & { status?: string; pickedUpAt?: number }, now: number): boolean {
  const start = rentalStartsAt(booking);
  return ["active", "returned"].includes(booking.status ?? "") ||
    (booking.pickedUpAt !== undefined && booking.pickedUpAt <= now) || start === null || now >= start;
}
export const STARTED_RENTAL_REFUND_MESSAGE = "This rental has started. Refunds can only be arranged by the team. Please use the rental conversation for help.";
