import { isPickupHoldPolicyVersion } from "./pickupSecurity";
import { isSavedCardRental } from "./savedCardSecurity";
import { dateLabel, londonRentalInstant } from "./rentalWindow";
export const VERIFICATION_FEATURES = ["identity", "selfie", "address"] as const;
export type VerificationCheck = "waiting" | "processing" | "approved" | "requires_input" | "review" | "rejected";
export type VerificationChecks = Record<(typeof VERIFICATION_FEATURES)[number], VerificationCheck>;
const VERIFICATION_START_GRACE_MS = 2 * 60 * 60 * 1000;
const validRentalClock = (value: unknown): value is string => typeof value === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(value);

export function verificationDeadlineAt(booking: {
  lineItems?: { start: number; pickupTime?: string | null }[];
  pickupTime?: string | null;
}) {
  if (!Array.isArray(booking.lineItems) || !booking.lineItems.length) return null;
  try {
    const lineDays = booking.lineItems.map(line => dateLabel(line.start));
    const earliestStart = Math.min(...lineDays);
    const earliestLines = booking.lineItems.filter((_, index) => lineDays[index] === earliestStart);
    if (booking.pickupTime != null && booking.pickupTime !== "" && !validRentalClock(booking.pickupTime)) return null;
    const lineTimes = earliestLines.map(line => line.pickupTime);
    if (lineTimes.some(time => time != null && time !== "" && !validRentalClock(time))) return null;
    const pickupTime = validRentalClock(booking.pickupTime)
      ? booking.pickupTime
      : lineTimes.length && lineTimes.every(validRentalClock)
        ? [...lineTimes].sort((left, right) => left.localeCompare(right))[0]
        : null;
    if (!pickupTime) return null;
    return londonRentalInstant(earliestStart, pickupTime) + VERIFICATION_START_GRACE_MS;
  } catch {
    return null;
  }
}

/** Only a provider approval time or archived reuse time can satisfy the cutoff.
 * Webhook delivery time is deliberately not accepted as evidence of when Didit decided. */
export function diditApprovalWithinVerificationWindow(booking: {
  lineItems?: { start: number; pickupTime?: string | null }[];
  pickupTime?: string | null;
  verificationLateOverrideAt?: number | null;
}, approvalAt: number | null | undefined, now = Date.now()) {
  const deadline = verificationDeadlineAt(booking);
  if (deadline === null) return false;
  if (Number.isSafeInteger(booking.verificationLateOverrideAt) && (booking.verificationLateOverrideAt ?? 0) > 0) return true;
  return deadline !== null && Number.isSafeInteger(approvalAt) && (approvalAt ?? 0) > 0 &&
    (approvalAt ?? 0) <= now && (approvalAt ?? 0) < deadline;
}

export function verificationDeadlinePassed(booking: {
  lineItems?: { start: number; pickupTime?: string | null }[];
  pickupTime?: string | null;
}, now = Date.now()) {
  const deadline = verificationDeadlineAt(booking);
  return deadline !== null && deadline <= now;
}

export function verificationWindowClosed(booking: {
  lineItems?: { start: number; pickupTime?: string | null }[];
  pickupTime?: string | null;
  verificationLateOverrideAt?: number | null;
  status?: string | null;
  idVerifyStatus?: string | null;
  idVerificationSource?: string | null;
  verificationChecks?: Record<string, string> | null;
  verificationExpiresAt?: number | null;
  idVerifiedAt?: number | null;
}, now = Date.now()) {
  if (Number.isFinite(booking.verificationLateOverrideAt) && (booking.verificationLateOverrideAt ?? 0) > 0) return false;
  if (booking.idVerifyStatus === "verified" && !bookingVerificationExpired(booking, now)) return false;
  return verificationDeadlinePassed(booking, now);
}

export function verificationChecks(decision: any): VerificationChecks {
  function check(fields: string[]): VerificationCheck {
    const rows = fields.flatMap(field => Array.isArray(decision?.[field]) ? decision[field] : []);
    if (!rows.length) return "waiting";
    const statuses = rows.map(row => row?.status);
    if (statuses.every(s => s === "Approved")) return "approved";
    if (statuses.every(s => s === "Not Started")) return "waiting";
    if (statuses.some(s => s === "Kyc Expired")) return "requires_input";
    if (statuses.some(s => s === "Declined")) return "rejected";
    if (statuses.some(s => ["Awaiting User", "Resubmitted", "Expired", "Abandoned", "Not Finished"].includes(s))) return "requires_input";
    if (statuses.some(s => s === "In Review")) return "review";
    return "processing";
  }
  return { identity: check(["id_verifications"]), selfie: check(["liveness_checks", "face_matches"]), address: check(["poa_verifications"]) };
}
export function verificationBookingOpen(status:string) {
  return ["pending_verification", "confirmed", "active"].includes(status);
}
export const DIDIT_CLOSED_RECONCILIATION_WINDOW_MS = 90 * 86400000;
export function diditSessionRefreshAllowed(booking: { status: string; returnedAt?: number | null }, now = Date.now()) {
  return verificationBookingOpen(booking.status) ||
    (booking.status === "returned" && Number.isSafeInteger(booking.returnedAt) &&
      (booking.returnedAt ?? 0) > now - DIDIT_CLOSED_RECONCILIATION_WINDOW_MS);
}
export function securityReady(booking: { status: string; depositHoldAmount?: number; depositHoldStatus?: string | null; securityPolicyVersion?:string|null; savedCardStatus?:string|null }) {
  if (isSavedCardRental(booking)) return verificationBookingOpen(booking.status) && booking.savedCardStatus === "saved";
  return verificationBookingOpen(booking.status) && (!(booking.depositHoldAmount ?? 0) || booking.depositHoldStatus === "held");
}

/** Paid pickup-policy rentals can complete documents before the scheduled hold.
 * This never substitutes for actual security readiness at handover. */
export function verificationCanStart(booking: {status:string;depositHoldAmount?:number;depositHoldStatus?:string|null;securityHoldPolicyVersion?:string|null;securityPolicyVersion?:string|null;savedCardStatus?:string|null;cancellationDecision?:unknown;returnDecision?:unknown;lineItems?:{start:number;pickupTime?:string|null}[];pickupTime?:string|null;verificationLateOverrideAt?:number|null;idVerifyStatus?:string|null;verificationExpiresAt?:number|null;idVerifiedAt?:number|null}, now = Date.now()) {
  return !booking.cancellationDecision && !booking.returnDecision &&
    verificationDeadlineAt(booking) !== null &&
    !verificationWindowClosed(booking, now) && (securityReady(booking) ||
    ((isPickupHoldPolicyVersion(booking.securityHoldPolicyVersion)||isSavedCardRental(booking)) && verificationBookingOpen(booking.status)));
}

export function verificationValidUntil(verification?: { idVerifiedAt?: number | null; verifiedAt?: number | null; verificationExpiresAt?: number | null; expiresAt?: number | null } | null) {
  if (!verification) return null;
  const verifiedAt = verification.idVerifiedAt ?? verification.verifiedAt;
  if (verifiedAt != null && Number.isFinite(verifiedAt)) return verifiedAt + 90 * 86400000;
  const storedExpiry = verification.verificationExpiresAt ?? verification.expiresAt;
  return storedExpiry != null && Number.isFinite(storedExpiry) ? storedExpiry : null;
}

export function accountIdentityVerified(account?: { idVerified?: boolean | null; rentalVerification?: Parameters<typeof verificationValidUntil>[0] } | null, now = Date.now()) {
  if (!account?.rentalVerification) return false;
  const expiresAt = verificationValidUntil(account.rentalVerification);
  return expiresAt != null && expiresAt > now;
}

/** Didit's completed approval remains valid for its 90-day verification window. */
export function verificationExpired(booking: { verificationExpiresAt?: number | null; idVerifiedAt?: number | null }, now = Date.now()) {
  const expiresAt = verificationValidUntil(booking);
  return expiresAt != null && expiresAt <= now;
}
/**
 * The account's reusable verification expires after 90 days, but that expiry
 * cannot revoke a rental that already passed verification and was confirmed.
 * Pending bookings still use the strict account/pass expiry so they must
 * complete a fresh Didit check before confirmation.
 */
export function bookingVerificationExpired(booking: {
  status?: string | null;
  idVerifyStatus?: string | null;
  idVerificationSource?: string | null;
  verificationChecks?: Record<string, string> | null;
  verificationExpiresAt?: number | null;
  idVerifiedAt?: number | null;
}, now = Date.now()) {
  const checksComplete = !booking.verificationChecks ||
    ["identity", "selfie", "address"].every((key) => booking.verificationChecks?.[key] === "approved");
  const approvedRental = ["confirmed", "active"].includes(booking.status ?? "") &&
    booking.idVerifyStatus === "verified" &&
    (booking.idVerificationSource === "manual" || checksComplete);
  return !approvedRental && verificationExpired(booking, now);
}
export function verificationSessionCanOpen(booking: Parameters<typeof verificationCanStart>[0] & { idVerifyStatus?: string | null; idVerificationSource?: string | null; verificationChecks?: Record<string, string> | null; verificationExpiresAt?: number | null; idVerifiedAt?: number | null; documentExpiresAt?: number | null }, now = Date.now()) {
  return verificationCanStart(booking, now) && (["required", "processing", "requires_input"].includes(booking.idVerifyStatus ?? "required") ||
    (booking.idVerifyStatus === "verified" && bookingVerificationExpired(booking, now)));
}

/** Internal allocation policies stay private, including notes saved before this release. */
export function renterVerificationNote(note?: string | null) {
  if (!note) return null;
  return /£(?:12|15),?000|per-person (?:equipment )?limit|equipment allocation|renterPersonKey/i.test(note)
    ? "Your rental needs a team review before handover. Message us for an update." : note;
}
