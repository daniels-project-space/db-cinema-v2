import {isSavedCardRental} from './savedCardSecurity';
import {bookingVerificationExpired,verificationValidUntil} from './verificationProgress';
export type VerificationBooking = {
  status: string;
  fulfilment?: string | null;
  idVerifyStatus?: string;
  idVerificationSource?: string | null;
  verificationChecks?: Record<string, string> | null;
  requiresDroneLicence?: boolean;
  droneLicenceStatus?: string;
  depositHoldAmount?: number;
  depositHoldStatus?: string | null;
  securityPolicyVersion?: string | null;
  savedCardStatus?: string | null;
  depositHoldExpiresAt?: number | null;
  verificationArchiveReady?: boolean;
  verificationWindowClosed?: boolean;
  verificationExpiresAt?: number | null;
  idVerifiedAt?: number | null;
  documentExpiresAt?: number | null;
};
/** A paid stock reservation is separate from permission to hand over equipment. */
export function rentalStageLabel(b: VerificationBooking): string {
  if (b.status === "active") return "On hire";
  if (b.status === "returned") return "Returned";
  if (b.status === "cancelled") return "Cancelled";
  if (b.status === "pending_verification") {
    if (b.idVerifyStatus === "verified" && bookingVerificationExpired(b)) return "Verification expired";
    if (b.idVerifyStatus === "verified") return "Verification passed · confirmation pending";
    if (b.verificationWindowClosed) return "Verification window passed";
    if (b.idVerifyStatus === "manual_review") return "Verification needs review";
    if (b.idVerifyStatus === "requires_input") return "Documents needed";
    if (b.idVerifyStatus === "rejected") return "Verification needs attention";
    return "Verification pending";
  }
  if (b.status !== "confirmed") return "Awaiting payment";
  if (isSavedCardRental(b) && b.savedCardStatus !== 'saved') return "Awaiting saved-card setup";
  if (b.depositHoldAmount && (b.depositHoldStatus !== "held" || (b.depositHoldExpiresAt != null && b.depositHoldExpiresAt <= Date.now()))) return "Awaiting card authorisation";
  if (b.idVerifyStatus === "manual_review") return "Verification needs review";
  if (b.idVerifyStatus === "requires_input") return "Documents needed";
  if (b.idVerifyStatus === "rejected") return "Verification needs attention";
  const verificationExpiresAt = verificationValidUntil(b);
  if (b.idVerifyStatus !== "verified" || verificationExpiresAt == null || bookingVerificationExpired(b) || (b.idVerificationSource !== "manual" && b.verificationChecks && ["identity", "selfie", "address"].some(key => b.verificationChecks?.[key] !== "approved"))) return "Awaiting verification";
  if (b.verificationArchiveReady === false) return "Document storage not confirmed";
  if (b.requiresDroneLicence && b.droneLicenceStatus !== "approved") return "Awaiting drone licence";
  return "Verification approved";
}
