import { isPickupHoldPolicyVersion } from "./pickupSecurity";
import { isSavedCardRental } from "./savedCardSecurity";
export const VERIFICATION_FEATURES = ["identity", "selfie", "address"] as const;
export type VerificationCheck = "waiting" | "processing" | "approved" | "requires_input" | "review" | "rejected";
export type VerificationChecks = Record<(typeof VERIFICATION_FEATURES)[number], VerificationCheck>;
export function verificationChecks(decision: any): VerificationChecks {
  function check(fields: string[]): VerificationCheck {
    const rows = fields.flatMap(field => Array.isArray(decision?.[field]) ? decision[field] : []);
    if (!rows.length) return "waiting";
    const statuses = rows.map(row => row?.status);
    if (statuses.every(s => s === "Approved")) return "approved";
    if (statuses.every(s => s === "Not Started")) return "waiting";
    if (statuses.some(s => s === "Declined" || s === "Kyc Expired")) return "rejected";
    if (statuses.some(s => ["Awaiting User", "Resubmitted", "Expired", "Abandoned", "Not Finished"].includes(s))) return "requires_input";
    if (statuses.some(s => s === "In Review")) return "review";
    return "processing";
  }
  return { identity: check(["id_verifications"]), selfie: check(["liveness_checks", "face_matches"]), address: check(["poa_verifications"]) };
}
export function verificationBookingOpen(status:string) {
  return ["pending_verification", "confirmed", "active"].includes(status);
}
export function securityReady(booking: { status: string; depositHoldAmount?: number; depositHoldStatus?: string | null; securityPolicyVersion?:string|null; savedCardStatus?:string|null }) {
  if (isSavedCardRental(booking)) return verificationBookingOpen(booking.status) && booking.savedCardStatus === "saved";
  return verificationBookingOpen(booking.status) && (!(booking.depositHoldAmount ?? 0) || booking.depositHoldStatus === "held");
}

/** Paid pickup-policy rentals can complete documents before the scheduled hold.
 * This never substitutes for actual security readiness at handover. */
export function verificationCanStart(booking: {status:string;depositHoldAmount?:number;depositHoldStatus?:string|null;securityHoldPolicyVersion?:string|null;securityPolicyVersion?:string|null;savedCardStatus?:string|null;cancellationDecision?:unknown;returnDecision?:unknown}) {
  return !booking.cancellationDecision && !booking.returnDecision && (securityReady(booking) ||
    ((isPickupHoldPolicyVersion(booking.securityHoldPolicyVersion)||isSavedCardRental(booking)) && verificationBookingOpen(booking.status)));
}

export function verificationValidUntil(verification?: { idVerifiedAt?: number | null; verifiedAt?: number | null; verificationExpiresAt?: number | null; expiresAt?: number | null } | null) {
  if (!verification) return null;
  const verifiedAt = verification.idVerifiedAt ?? verification.verifiedAt;
  if (verifiedAt != null && Number.isFinite(verifiedAt)) return verifiedAt + 90 * 86400000;
  const storedExpiry = verification.verificationExpiresAt ?? verification.expiresAt;
  return storedExpiry != null && Number.isFinite(storedExpiry) ? storedExpiry : null;
}

/** Didit's completed approval remains valid for its 90-day verification window. */
export function verificationExpired(booking: { verificationExpiresAt?: number | null; idVerifiedAt?: number | null }, now = Date.now()) {
  const expiresAt = verificationValidUntil(booking);
  return expiresAt != null && expiresAt <= now;
}
export function verificationSessionCanOpen(booking: Parameters<typeof verificationCanStart>[0] & { idVerifyStatus?: string | null; verificationExpiresAt?: number | null; idVerifiedAt?: number | null; documentExpiresAt?: number | null }, now = Date.now()) {
  return verificationCanStart(booking) && (["required", "processing", "requires_input"].includes(booking.idVerifyStatus ?? "required") ||
    (booking.idVerifyStatus === "verified" && verificationExpired(booking, now)));
}

/** Internal allocation policies stay private, including notes saved before this release. */
export function renterVerificationNote(note?: string | null) {
  if (!note) return null;
  return /£15,?000|per-person (?:equipment )?limit|equipment allocation|renterPersonKey/i.test(note)
    ? "Your rental needs a team review before handover. Message us for an update." : note;
}
