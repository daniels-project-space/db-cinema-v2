// Booking presentation helpers — London timezone, inclusive rental days (Hygglo convention).
// Pure/display only; no money is moved here.

import { londonStartOfDay, cancelKind } from "./cancellationPolicy";
export { londonStartOfDay, cancelKind };

export type EnrichedLine = {
  listingId: string;
  title: string;
  start: number;
  end: number;
  qty: number;
  lineTotal: number;
  pickupTime?: string | null;
  returnTime?: string | null;
  slug: string | null;
  heroImage: string | null;
  imageSources?: string[];
  category: string | null;
  tip?: string | null;
};

export type EnrichedBooking = {
  _id: string;
  status: string;
  lineItems: EnrichedLine[];
  total: number;
  subtotal?: number;
  discount?: number;
  deliveryFee?: number;
  creditApplied?: number;
  depositAmount: number;
  depositHoldAmount?: number;
  depositHoldStatus?: string | null;
  depositHoldExpiresAt?: number | null;
  securityHoldPolicyVersion?: string | null;
  securityHoldDueAt?: number | null;
  depositHoldRenewalStatus?: string | null;
  depositHoldReleasePending?: boolean;
  depositRefunded?: boolean;
  hasReturnStatement?: boolean;
  lateFeeAmount?: number;
  lateFeeStatus?: string | null;
  currency: string;
  fulfilment: "pickup" | "delivery";
  address: string | null;
  pickupTime: string | null;
  returnTime: string | null;
  idVerifyStatus: string;
  verificationNote?: string | null;
  requiresDroneLicence?: boolean;
  droneLicenceStatus?: string;
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
  upcoming: { label: "Upcoming", blurb: "Reserved rentals and verification progress" },
  past: { label: "History", blurb: "Completed & cancelled rentals" },
};

export const STATUS_META: Record<string, { label: string; pill: string; dot: string }> = {
  pending_payment: { label: "Payment pending", pill: "bg-amber-500/15 text-amber-300 ring-1 ring-amber-400/30", dot: "bg-amber-400" },
  confirmed: { label: "Payment received", pill: "bg-emerald-500/15 text-emerald-300 ring-1 ring-emerald-400/30", dot: "bg-emerald-400" },
  awaiting_verification: { label: "Awaiting verification", pill: "bg-amber-500/15 text-amber-300 ring-1 ring-amber-400/30", dot: "bg-amber-400" },
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

// ── Rental progress stepper ───────────────────────────────────────
export type Step = { label: string; state: "done" | "current" | "todo" };

/** Saved lifecycle stages, including a separate card hold and manual drone review. */
export function bookingSteps(b: { status: string; idVerifyStatus: string; depositHoldAmount?: number; depositHoldStatus?: string | null; requiresDroneLicence?: boolean; droneLicenceStatus?: string }): { cancelled: boolean; steps: Step[] } {
  const verificationLabel = b.idVerifyStatus === "verified" ? "ID + address verified"
    : b.idVerifyStatus === "processing" ? "Verification in progress"
    : b.idVerifyStatus === "manual_review" ? "Human review needed"
    : b.idVerifyStatus === "requires_input" ? "Resubmission needed"
    : b.idVerifyStatus === "rejected" ? "Verification declined"
    : "Verify ID + address";
  const withHold = (b.depositHoldAmount ?? 0) > 0;
  const labels = withHold
    ? ["Payment", "Card hold", verificationLabel, "Pickup", "Return"]
    : ["Payment", verificationLabel, "Pickup", "Return"];
  if (b.requiresDroneLicence) labels.splice(labels.length - 2, 0, b.droneLicenceStatus === "approved" ? "Drone licence approved" : b.droneLicenceStatus === "review" ? "Drone licence review" : b.droneLicenceStatus === "requires_input" ? "Replace drone licence" : "Upload drone licence");
  if (b.status === "cancelled") {
    return { cancelled: true, steps: labels.map((label) => ({ label, state: "todo" as const })) };
  }
  const booked = ["confirmed", "active", "returned"].includes(b.status);
  const verified = b.idVerifyStatus === "verified" || b.idVerifyStatus === "not_required";
  const out = ["active", "returned"].includes(b.status);
  const back = b.status === "returned";
  let reached = 0; // index of the CURRENT step (earlier steps are done)
  if (back) reached = labels.length;
  else if (out) reached = labels.length - 1;
  else if (booked && withHold && b.depositHoldStatus !== "held") reached = 1;
  else if (booked && verified) reached = b.requiresDroneLicence && b.droneLicenceStatus !== "approved" ? labels.length - 3 : labels.length - 2;
  else if (booked) reached = withHold ? 2 : 1;
  else reached = 0; // pending_payment → "Confirmed" is in progress
  const steps: Step[] = labels.map((label, i) => ({
    label,
    state: i < reached ? "done" : i === reached ? "current" : "todo",
  }));
  return { cancelled: false, steps };
}
