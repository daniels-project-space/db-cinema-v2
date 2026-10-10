import { accountForRental } from "./rentalAccount";
/** Rental risk policy, separate from a Collective membership badge. */
export const VERIFICATION_REUSE_DAYS = 90;
export function verificationDetail(value: unknown) {
  return typeof value === "string" ? value.normalize("NFKC").trim().toLowerCase().replace(/\s+/g, " ") : "";
}
export function validReuse(record: any, booking: any, now = Date.now()) {
  return !!record && record.expiresAt > now && record.expiresAt > Math.min(...booking.lineItems.map((li: any) => li.start)) &&
    !!verificationDetail(booking.agreementName) && !!verificationDetail(booking.billingAddress) &&
    record.name === verificationDetail(booking.agreementName) && record.address === verificationDetail(booking.billingAddress);
}
export async function verificationUpdateMessage(ctx: any, bookingId: any, previous: string | undefined, status: string) {
  if (previous === status) return;
  const booking = await ctx.db.get(bookingId);
  if (!booking || !["confirmed", "active"].includes(booking.status)) return;
  const account = await accountForRental(ctx, booking);
  if (!account) return;
  const text: Record<string, string> = {
    verified: "Your identity and address verification is approved for this rental.",
    manual_review: "Your verification is awaiting a team review. We will post the decision here; handover requires approval.",
    requires_input: "More verification information is needed. Open verification in your account to complete or resubmit the requested documents before handover.",
    rejected: "Your verification has not been approved. Contact the team here before arranging handover.",
  };
  if (!text[status]) return;
  const { postRentalMessage } = await import("./rentalChat");
  await postRentalMessage(ctx, { accountId: account._id, bookingId, sender: "system", text: text[status], meta: { kind: "verification_update", status } });
}
