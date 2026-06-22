// Booking presentation helpers — London timezone, inclusive rental days (Hygglo convention).
// Pure/display only; no money is moved here.

export type EnrichedLine = {
  listingId: string;
  title: string;
  start: number;
  end: number;
  qty: number;
  lineTotal: number;
  slug: string | null;
  heroImage: string | null;
  category: string | null;
};

export type EnrichedBooking = {
  _id: string;
  status: string;
  lineItems: EnrichedLine[];
  total: number;
  subtotal?: number;
  discount?: number;
  depositAmount: number;
  depositRefunded?: boolean;
  currency: string;
  fulfilment: "pickup" | "delivery";
  address: string | null;
  pickupTime: string | null;
  returnTime: string | null;
  idVerifyStatus: string;
  reviewed: boolean;
  firstSlug: string | null;
  start: number | null;
  end: number | null;
  at: number;
};

export type BookingGroup = "pending" | "upcoming" | "active" | "past";

export function groupOf(b: { status: string }): BookingGroup {
  switch (b.status) {
    case "pending_payment":
      return "pending";
    case "active":
      return "active";
    case "confirmed":
      return "upcoming";
    default:
      return "past"; // returned | cancelled
  }
}

export const GROUP_ORDER: BookingGroup[] = ["pending", "active", "upcoming", "past"];

export const GROUP_META: Record<BookingGroup, { label: string; blurb: string }> = {
  pending: { label: "Needs payment", blurb: "Finish checkout to lock these in" },
  active: { label: "Out now", blurb: "Currently in your hands" },
  upcoming: { label: "Upcoming", blurb: "Confirmed and on the way" },
  past: { label: "History", blurb: "Completed & cancelled rentals" },
};

export const STATUS_META: Record<string, { label: string; pill: string; dot: string }> = {
  pending_payment: { label: "Payment pending", pill: "bg-amber-500/15 text-amber-300 ring-1 ring-amber-400/30", dot: "bg-amber-400" },
  confirmed: { label: "Confirmed", pill: "bg-emerald-500/15 text-emerald-300 ring-1 ring-emerald-400/30", dot: "bg-emerald-400" },
  active: { label: "Out now", pill: "bg-sky-500/15 text-sky-300 ring-1 ring-sky-400/30", dot: "bg-sky-400" },
  returned: { label: "Completed", pill: "bg-white/10 text-white/55 ring-1 ring-white/15", dot: "bg-white/40" },
  cancelled: { label: "Cancelled", pill: "bg-rose-500/15 text-rose-300 ring-1 ring-rose-400/30", dot: "bg-rose-400" },
};

export function statusMeta(s: string) {
  return STATUS_META[s] ?? STATUS_META.returned;
}

const LDN = "Europe/London";
const dfDay = new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: LDN });
const dfDayYear = new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric", timeZone: LDN });

export function fmtDate(ms: number) {
  return dfDay.format(new Date(ms));
}
export function fmtDateYear(ms: number) {
  return dfDayYear.format(new Date(ms));
}
export function fmtRange(start: number, end: number) {
  return `${fmtDate(start)} → ${fmtDate(end)}`;
}

// inclusive rental days (Hygglo convention — matches checkout repriceLines)
export function rentalDays(start: number, end: number) {
  return Math.max(1, Math.round((end - start) / 86400000) + 1);
}

// London "start of civil day" in ms — for countdown + cancellation-window math
export function londonStartOfDay(ms: number): number {
  const p = new Intl.DateTimeFormat("en-CA", { timeZone: LDN, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date(ms));
  const y = +p.find((x) => x.type === "year")!.value;
  const m = +p.find((x) => x.type === "month")!.value;
  const d = +p.find((x) => x.type === "day")!.value;
  return Date.UTC(y, m - 1, d);
}

function dayDelta(target: number, now: number) {
  return Math.round((londonStartOfDay(target) - londonStartOfDay(now)) / 86400000);
}

export function countdown(start: number, now: number): string {
  const d = dayDelta(start, now);
  if (d < 0) return "started";
  if (d === 0) return "today";
  if (d === 1) return "tomorrow";
  if (d < 7) return `in ${d} days`;
  if (d < 14) return "in 1 week";
  return `in ${Math.round(d / 7)} weeks`;
}

// cancellation window (locked decision): ≥3 London-days before start → full cash refund,
// otherwise a 90-day store credit. Cancel is never disabled — it converts.
export function cancelKind(start: number, now: number): "full_refund" | "store_credit" {
  return dayDelta(start, now) >= 3 ? "full_refund" : "store_credit";
}
