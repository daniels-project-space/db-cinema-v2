import { postRentalMessage } from "./rentalChat";
import { accountForRental } from "./rentalAccount";
import { bookingStockLines } from "../../shared/rentalWindow";

/** Rental risk policy, separate from a Collective membership badge. */
export const VERIFICATION_REUSE_DAYS = 90;
export function verificationDetail(value: unknown) {
  return typeof value === "string" ? value.normalize("NFKC").trim().toLowerCase().replace(/\s+/g, " ") : "";
}
export function validReuse(record: any, booking: any, now = Date.now()) {
  return !!record && Array.isArray(booking.lineItems) && booking.lineItems.length > 0 &&
    booking.lineItems.every((li: any) => Number.isFinite(li.start) && record.expiresAt > li.start) && record.expiresAt > now &&
    !!verificationDetail(booking.agreementName) && !!verificationDetail(booking.billingAddress) &&
    record.name === verificationDetail(booking.agreementName) && record.address === verificationDetail(booking.billingAddress);
}
export async function saveAccountDiditVerification(ctx: any, booking: any, verifiedAt: number, documentExpiresAt: number | undefined, checks: any, personKey: string | undefined) {
  if (!booking.accountId || booking.accountAccessRequired !== false || !booking.diditSessionId || booking.verificationReuseBlockedSessionId === booking.diditSessionId ||
      !["identity", "selfie", "address"].every(key => checks?.[key] === "approved") ||
      !personKey || !Number.isFinite(verifiedAt) || !Number.isFinite(documentExpiresAt)) return false;
  const name = verificationDetail(booking.agreementName), address = verificationDetail(booking.billingAddress);
  const expiresAt = Math.min(verifiedAt + VERIFICATION_REUSE_DAYS * 86400000, documentExpiresAt!);
  if (!name || !address || expiresAt <= Date.now()) return false;
  const account = await ctx.db.get(booking.accountId);
  if (!account || account.blockedAt != null || account.emailVerificationRequired && !account.emailVerifiedAt) return false;
  if (account.name && verificationDetail(account.name) !== name || account.address && verificationDetail(account.address) !== address) return false;
  if ((account.rentalVerification?.verifiedAt ?? 0) > verifiedAt) return false;
  await ctx.db.patch(account._id, { rentalVerification: { sourceBookingId: booking._id, name, address, verifiedAt, expiresAt } });
  return true;
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
  let message=text[status];
  if(status==="verified"){
    const settings=await ctx.db.query("settings").first();
    if(booking.fulfilment==="pickup"){
      const schedule=bookingStockLines(booking).map((line:any)=>`${line.title}: ${new Date(line.start).toISOString().slice(0,10)}${line.pickupTime ? ` at ${line.pickupTime}` : " (time to be confirmed)"}`).join("\n");
      message+=`${settings?.businessAddress ? `\n\nPickup location:\n${settings.businessAddress}` : "\n\nThe team will confirm the pickup location here."}${schedule ? `\n\nPickup schedule (London time):\n${schedule}` : ""}`;
    }
    message+="\n\nHandover remains subject to any remaining checks and approval. Message us here if you need help.";
  }
  await postRentalMessage(ctx, { accountId: account._id, bookingId, sender: "system", text: message, meta: { kind: "verification_update", status } });
}
