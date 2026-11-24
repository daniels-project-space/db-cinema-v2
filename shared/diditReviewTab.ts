import { verificationBookingOpen } from "./verificationProgress";

export function needsDiditReviewTab(booking: {
  status: string;
  verificationProvider?: string | null;
  idVerifyStatus?: string | null;
  verificationLateBlockedAt?: number | null;
  verificationLateBlockedProviderStatus?: string | null;
} | null | undefined) {
  return !!booking &&
    verificationBookingOpen(booking.status) &&
    booking.verificationProvider === "didit" &&
    booking.idVerifyStatus === "manual_review" &&
    !(booking.verificationLateBlockedAt && booking.verificationLateBlockedProviderStatus === "Approved");
}

export function rentalWorkspaceTabs(booking: Parameters<typeof needsDiditReviewTab>[0]): [string, string][] {
  const tabs: [string, string][] = [["order", "Order & payments"]];
  if (needsDiditReviewTab(booking)) tabs.push(["verification", "Verification review"]);
  return tabs;
}
