/** Compose only from recorded state; unpaid drafts cannot disclose collection details. */
export function rentalReplyTemplates(booking: any, settings: any): { label: string; text: string }[] {
  if (!booking) return [{ label: "Thanks", text: "Thanks for your message. The DB Cinema team is here to help." }];
  if (booking.status === "pending_payment") return [{ label: "Complete checkout", text: "Your rental is awaiting payment and is not confirmed yet. Please complete checkout in your account. Collection details will follow once the rental is confirmed." }];
  const replies: { label: string; text: string }[] = [];
  if (["confirmed", "active"].includes(booking.status)) {
    const day = (value: number) => new Date(value).toLocaleDateString("en-GB", { timeZone: "UTC", day: "numeric", month: "short", year: "numeric" });
    const start = Math.min(...booking.lineItems.map((line: any) => line.start));
    const end = Math.max(...booking.lineItems.map((line: any) => line.end));
    const dates = `Collection: ${day(start)}${booking.pickupTime ? ` at ${booking.pickupTime} (London time)` : "; time to be confirmed"}. Return: ${day(end)}${booking.returnTime ? ` at ${booking.returnTime} (London time)` : "; time to be confirmed"}.`;
    replies.push({ label: "Rental details", text: `${booking.status === "confirmed" ? "Your rental is confirmed." : "Your rental is on hire."} ${dates}${booking.fulfilment === "pickup" && settings?.businessAddress ? ` Collection location: ${settings.businessAddress}.` : booking.fulfilment === "delivery" ? " This order is for delivery to the address on your booking." : " We will confirm the collection location here."}` });
    if (booking.idVerifyStatus === "requires_input") replies.push({ label: "Resubmit documents", text: "Please open verification in your account and follow the provider's instructions to resubmit the requested documents. Verification must be approved before handover." });
    if (booking.idVerifyStatus === "manual_review") replies.push({ label: "Verification review", text: "Your verification is awaiting a team review. We will update you here once a decision is recorded. Handover requires approved verification." });
    if (booking.idVerifyStatus === "rejected") replies.push({ label: "Verification declined", text: "Your verification has not been approved. Please contact the team here to discuss the next step before handover." });
  }
  replies.push({ label: "Thanks", text: "Thanks for your message. The DB Cinema team is here to help." });
  return replies;
}
