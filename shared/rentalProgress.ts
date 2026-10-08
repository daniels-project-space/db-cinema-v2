import { rentalStageLabel, type VerificationBooking } from "./rentalReadiness";
export type ProgressBooking = VerificationBooking & { returnChecking?: boolean };
export function rentalProgress(b: ProgressBooking) {
  if (b.status === "cancelled") return { cancelled: true, index: -1, caption: "Rental cancelled" };
  if (b.status === "returned") return { cancelled: false, index: 4, caption: "Rental completed" };
  if (b.status !== "confirmed" && b.status !== "active") return { cancelled: false, index: 0, caption: "Waiting for payment confirmation" };
  if (b.returnChecking) return { cancelled: false, index: 3, caption: "Checking your return" };
  if (b.status === "active") return { cancelled: false, index: 2, caption: "Your kit is out on rental" };
  if (b.idVerifyStatus === "verified") return { cancelled: false, index: 1, caption: rentalStageLabel(b) === "Verification approved" ? "Verification approved · awaiting handover" : rentalStageLabel(b) };
  const captions: Record<string, string> = { requires_input: "Please resubmit the requested documents", rejected: "Verification needs attention", manual_review: "Documents are being reviewed", processing: "Checking your ID, selfie and address" };
  return { cancelled: false, index: 1, caption: captions[b.idVerifyStatus ?? ""] ?? "Verify your ID, selfie and address" };
}
