import { renterHandoverDetailsReady } from "./renterRentalActionGate";
import { LEO_SUPPORT_PHONE, TRAFALGAR_PICKUP_ADDRESS, TRAFALGAR_PICKUP_INSTRUCTIONS } from "../../shared/pickupLocation";

/** Compose only from recorded state; unpaid drafts cannot disclose collection details. */
export function rentalReplyTemplates(booking: any, settings: any): { label: string; text: string }[] {
  if (!booking) return [{ label: "Thanks", text: "Thanks for your message. The DB Cinema team is here to help." }];
  if (booking.status === "pending_payment") return [{ label: "Complete checkout", text: "Your rental is awaiting payment and is not confirmed yet. Please complete checkout in your account. Collection details will follow once the rental is confirmed." }];
  if (booking.status === "pending_verification") {
    const stage = booking.idVerifyStatus === "verified"
      ? "Didit has approved your verification, but we are still finishing the booking. It is not confirmed yet; please do not pay again."
      : booking.idVerifyStatus === "manual_review"
        ? "Your payment is recorded, but Didit has paused verification for review. The rental is not confirmed yet; we will update you here."
        : booking.idVerifyStatus === "requires_input"
          ? "Your payment is recorded, but the rental is not confirmed yet. Didit needs a replacement document; open verification in your account and follow its instructions."
          : booking.idVerifyStatus === "rejected"
            ? "Your payment is recorded, but Didit has not approved verification, so the rental is not confirmed. Please message us here to resolve it."
            : "Your payment is recorded, but the rental is not confirmed until Didit approves verification. Continue verification in your account; please do not pay again.";
    return [{ label: "Verification update", text: stage }];
  }
  const replies: { label: string; text: string }[] = [];
  if (["confirmed", "active"].includes(booking.status)) {
    const handoverReady = renterHandoverDetailsReady(booking);
    const day = (value: number) => new Date(value).toLocaleDateString("en-GB", { timeZone: "UTC", day: "numeric", month: "short", year: "numeric" });
    const start = Math.min(...booking.lineItems.map((line: any) => line.start));
    const end = Math.max(...booking.lineItems.map((line: any) => line.end));
    const dates = `Collection: ${day(start)}${booking.pickupTime ? ` at ${booking.pickupTime} (London time)` : "; time to be confirmed"}. Return: ${day(end)}${booking.returnTime ? ` at ${booking.returnTime} (London time)` : "; time to be confirmed"}.`;
    const stage = handoverReady
      ? booking.status === "active" ? "Your rental is on hire." : "Your rental is confirmed."
      : booking.paidConfirmedAt
        ? "Your payment is recorded; collection details will follow once verification and booking checks are complete."
        : "Your rental is not ready for collection yet. We will share details once payment and verification are complete.";
    const location = handoverReady && booking.fulfilment === "pickup"
      ? ` Collection location: ${TRAFALGAR_PICKUP_ADDRESS}. ${TRAFALGAR_PICKUP_INSTRUCTIONS}`
      : booking.fulfilment === "delivery" && handoverReady
        ? booking.deliveryLegs === "one_way"
          ? ` This order is delivered to your address; return it to ${TRAFALGAR_PICKUP_ADDRESS}. ${TRAFALGAR_PICKUP_INSTRUCTIONS}`
          : " This order is delivered to the address on your booking."
        : " Collection details will be shared once the booking is ready.";
    const contact = handoverReady ? ` Call Leo on ${LEO_SUPPORT_PHONE} if you need help.` : "";
    replies.push({ label: "Rental details", text: `${stage} ${dates}${location}${contact}` });
    if (booking.idVerifyStatus === "requires_input") replies.push({ label: "Resubmit documents", text: "Please open verification in your account and follow the provider's instructions to resubmit the requested documents. Verification must be approved before handover." });
    if (booking.idVerifyStatus === "manual_review") replies.push({ label: "Verification review", text: "Your verification is awaiting a team review. We will update you here once a decision is recorded. Handover requires approved verification." });
    if (booking.idVerifyStatus === "rejected") replies.push({ label: "Verification declined", text: "Your verification has not been approved. Please contact the team here to discuss the next step before handover." });
  }
  replies.push({ label: "Thanks", text: "Thanks for your message. The DB Cinema team is here to help." });
  return replies;
}
