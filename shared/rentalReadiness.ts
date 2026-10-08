export type VerificationBooking = {
  status: string;
  idVerifyStatus?: string;
  idVerificationSource?: string | null;
  verificationChecks?: Record<string, string> | null;
  requiresDroneLicence?: boolean;
  droneLicenceStatus?: string;
  depositHoldAmount?: number;
  depositHoldStatus?: string | null;
  depositHoldExpiresAt?: number | null;
  verificationArchiveReady?: boolean;
  verificationExpiresAt?: number | null;
  documentExpiresAt?: number | null;
};
/** A paid stock reservation is separate from permission to hand over equipment. */
export function rentalStageLabel(b: VerificationBooking): string {
  if (b.status === "active") return "On hire";
  if (b.status === "returned") return "Returned";
  if (b.status === "cancelled") return "Cancelled";
  if (b.status !== "confirmed") return "Awaiting payment";
  if (b.depositHoldAmount && (b.depositHoldStatus !== "held" || (b.depositHoldExpiresAt != null && b.depositHoldExpiresAt <= Date.now()))) return "Awaiting card authorisation";
  if (b.idVerifyStatus === "manual_review") return "Verification under review";
  if (b.idVerifyStatus === "requires_input") return "Documents needed";
  if (b.idVerifyStatus === "rejected") return "Verification needs attention";
  if (b.idVerifyStatus !== "verified" || (b.verificationExpiresAt != null && b.verificationExpiresAt <= Date.now()) || (b.documentExpiresAt != null && b.documentExpiresAt <= Date.now()) || (b.idVerificationSource !== "manual" && b.verificationChecks && ["identity", "selfie", "address"].some(key => b.verificationChecks?.[key] !== "approved"))) return "Awaiting verification";
  if (b.verificationArchiveReady === false) return "Saving verification documents";
  if (b.requiresDroneLicence && b.droneLicenceStatus !== "approved") return "Awaiting drone licence";
  return "Verification approved";
}
