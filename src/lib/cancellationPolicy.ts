/** One policy for the cancellation action, account UI, and signed agreement. */
export const CANCELLATION_FULL_REFUND_DAYS = 14;
export const CANCELLATION_CREDIT_DAYS = 365;
export const SEVEN_DAY_CANCELLATION_VERSION = "2026-11-v18";
export const NO_REFUND_WITHIN_48_HOURS_CANCELLATION_VERSION = "2026-11-v21";
export const SEVEN_DAY_CANCELLATION_VERSIONS = ["2026-10-v16", SEVEN_DAY_CANCELLATION_VERSION, "2026-11-v19", "2026-11-v20", NO_REFUND_WITHIN_48_HOURS_CANCELLATION_VERSION];

type CancellationBooking = {
  lineItems: { start: number; pickupTime?: string | null }[];
  removedItems?: { start: number }[];
  cancellationPolicyStart?: number;
  pickupTime?: string;
  agreementDocs?: { kind: string; version: string }[];
};

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
  if(booking.agreementDocs?.some(d=>d.kind==="cancellation"&&SEVEN_DAY_CANCELLATION_VERSIONS.includes(d.version)))return 7;
  return booking.agreementDocs?.some(d=>d.kind==="cancellation"&&["2026-10-v11","2026-10-v12","2026-10-v13","2026-10-v14","2026-10-v15","2026-11-v17"].includes(d.version))?CANCELLATION_FULL_REFUND_DAYS:3;
}

function londonPickupInstant(start: number, pickupTime: string): number {
  const dateParts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(new Date(start));
  const value = (type: string) => Number(dateParts.find(part => part.type === type)?.value);
  const [hour, minute] = pickupTime.split(":").map(Number);
  const localAsUtc = Date.UTC(value("year"), value("month") - 1, value("day"), hour, minute);
  let instant = localAsUtc;
  for (let attempt = 0; attempt < 4; attempt++) {
    const parts = new Intl.DateTimeFormat("en-GB", {
      timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", hourCycle: "h23",
    }).formatToParts(instant);
    const partValue = (type: string) => Number(parts.find(part => part.type === type)?.value);
    const representedLocalAsUtc = Date.UTC(partValue("year"), partValue("month") - 1, partValue("day"), partValue("hour"), partValue("minute"));
    const correction = localAsUtc - representedLocalAsUtc;
    if (!correction) break;
    instant += correction;
  }
  return instant;
}

export function bookingCancelKind(booking: CancellationBooking, now: number) {
  if(booking.agreementDocs?.some(d=>d.kind==="cancellation"&&d.version===NO_REFUND_WITHIN_48_HOURS_CANCELLATION_VERSION)){
    const start=rentalCancellationStart(booking);
    const pickup=booking.lineItems.filter(item=>item.start===start).map(item=>item.pickupTime).find(time=>typeof time==="string"&&/^([01]\d|2[0-3]):[0-5]\d$/.test(time))??(typeof booking.pickupTime==="string"&&/^([01]\d|2[0-3]):[0-5]\d$/.test(booking.pickupTime)?booking.pickupTime:"00:00");
    const pickupInstant=londonPickupInstant(start,pickup);
    if(pickupInstant-now<=48*60*60*1000)return "no_refund" as const;
    const days=Math.round((londonStartOfDay(start)-londonStartOfDay(now))/86400000);
    return days>7?"full_refund" as const:"store_credit" as const;
  }
  if(booking.agreementDocs?.some(d=>d.kind==="cancellation"&&SEVEN_DAY_CANCELLATION_VERSIONS.includes(d.version))){
    const days=Math.round((londonStartOfDay(rentalCancellationStart(booking))-londonStartOfDay(now))/86400000);
    return days>7?"full_refund" as const:"store_credit" as const;
  }
  return cancelKind(rentalCancellationStart(booking), now, cancellationDaysForBooking(booking));
}

/** Amounts in pence. The card refund is bounded by Stripe's captured payment;
 * previously redeemed account credit is restored only after confirmation used it. */
export function cancellationSettlement(
  kind: "full_refund" | "store_credit" | "no_refund",
  paidPence: number,
  securityPence: number,
  redeemedCreditPence: number,
  restoreRedeemedCredit: boolean,
): { refundPence: number; creditPence: number } {
  if (![paidPence, securityPence, redeemedCreditPence].every((amount) =>
    Number.isSafeInteger(amount) && amount >= 0)) throw new Error("Invalid cancellation amount");
  const restored = restoreRedeemedCredit ? redeemedCreditPence : 0;
  if (kind === "full_refund") return { refundPence: paidPence, creditPence: restored };
  if (kind === "no_refund") return { refundPence: securityPence, creditPence: 0 };
  const refundPence = Math.min(paidPence, securityPence);
  return { refundPence, creditPence: paidPence - refundPence + restored };
}

/** Removing kit cannot silently move the agreed cancellation deadline. */
export function rentalCancellationStart(booking: { lineItems: { start: number }[]; removedItems?: { start: number }[]; cancellationPolicyStart?: number }): number {
  if (booking.cancellationPolicyStart !== undefined) return booking.cancellationPolicyStart;
  return Math.min(...booking.lineItems.map(line => line.start), ...(booking.removedItems ?? []).map(line => line.start));
}
