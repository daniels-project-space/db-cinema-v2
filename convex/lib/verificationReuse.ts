import { postRentalMessage } from "./rentalChat";
import { accountForRental } from "./rentalAccount";
import { bookingStockLines } from "../../shared/rentalWindow";
import { pickupMapAvailable } from "../../shared/pickupLocation";
import { verificationExpired, verificationValidUntil } from "../../shared/verificationProgress";

/** Rental risk policy, separate from a Collective membership badge. */
export const VERIFICATION_REUSE_DAYS = 90;
export function verificationDetail(value: unknown) {
  return typeof value === "string" ? value.normalize("NFKC").trim().toLowerCase().replace(/\s+/g, " ") : "";
}
export async function verificationReuseIdentityDigest(booking:any,recipientEmail:string) {
  const bytes=new TextEncoder().encode(JSON.stringify([verificationDetail(booking.agreementName),verificationDetail(booking.billingAddress),verificationDetail(booking.guestEmail),verificationDetail(recipientEmail)]));
  return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",bytes))).map(byte=>byte.toString(16).padStart(2,"0")).join("");
}
export async function verificationReuseOwnerMatches(ctx:any,booking:any) {
  if(!booking?.accountId)return false;
  const account=await ctx.db.get(booking.accountId);
  if(!account || account.blockedAt!=null)return false;
  if(booking.accountAccessRequired===false)return true;
  if(!account.emailVerifiedAt)return false;
  return verificationDetail(account.email)===verificationDetail(booking.guestEmail) &&
    !!verificationDetail(account.name) && verificationDetail(account.name)===verificationDetail(booking.agreementName);
}
export function validReuse(record: any, booking: any, now = Date.now()) {
  const expiresAt = verificationValidUntil(record);
  return !!record && Array.isArray(booking.lineItems) && booking.lineItems.length > 0 &&
    expiresAt != null && booking.lineItems.every((li: any) => Number.isFinite(li.start) && expiresAt > li.start) && expiresAt > now &&
    !!verificationDetail(booking.agreementName) && !!verificationDetail(booking.billingAddress) && !!verificationDetail(record.address) &&
    record.name === verificationDetail(booking.agreementName);
}
export async function saveAccountDiditVerification(ctx: any, booking: any, verifiedAt: number, documentExpiresAt: number | undefined, checks: any, personKey: string | undefined) {
  if (booking.identityRiskNotice || !await verificationReuseOwnerMatches(ctx,booking) || !booking.diditSessionId || booking.verificationReuseBlockedSessionId === booking.diditSessionId ||
      !["identity", "selfie", "address"].every(key => checks?.[key] === "approved") ||
      !personKey || !Number.isFinite(verifiedAt) || (documentExpiresAt != null && !Number.isFinite(documentExpiresAt))) return false;
  const name = verificationDetail(booking.agreementName), address = verificationDetail(booking.billingAddress);
  const expiresAt = verifiedAt + VERIFICATION_REUSE_DAYS * 86400000;
  if (!name || !address || expiresAt <= Date.now()) return false;
  const account = await ctx.db.get(booking.accountId);
  if (!account || account.blockedAt != null || !account.emailVerifiedAt || !account.name || verificationDetail(account.name) !== name) return false;
  if ((account.rentalVerification?.verifiedAt ?? 0) > verifiedAt) return false;
  const current=account.rentalVerification;
  if(current && current.verifiedAt===verifiedAt && current.sourceBookingId!==booking._id)return false;
  if(current?.sourceBookingId===booking._id && current.name===name && current.address===address && current.verifiedAt===verifiedAt && current.expiresAt===expiresAt)return true;
  await ctx.db.patch(account._id, { rentalVerification: { sourceBookingId: booking._id, name, address, verifiedAt, expiresAt } });
  return true;
}
export async function verificationUpdateMessage(ctx: any, bookingId: any, previous: string | undefined, status: string) {
  if (previous === status) return;
  const booking = await ctx.db.get(bookingId);
  if (!booking || !["pending_verification", "confirmed", "active"].includes(booking.status)) return;
  if (status === "verified" && verificationExpired(booking)) return;
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
  let pickupMap = false;
  if(status==="verified"){
    const settings=await ctx.db.query("settings").first();
    if(booking.fulfilment==="pickup"){
      pickupMap = pickupMapAvailable(settings?.businessAddress);
      const schedule=bookingStockLines(booking).map((line:any)=>`${line.title}: ${new Date(line.start).toISOString().slice(0,10)}${line.pickupTime ? ` at ${line.pickupTime}` : " (time to be confirmed)"}`).join("\n");
      message+=`${settings?.businessAddress ? `\n\nPickup location:\n${settings.businessAddress}` : "\n\nThe team will confirm the pickup location here."}${schedule ? `\n\nPickup schedule (London time):\n${schedule}` : ""}`;
    }
    message+="\n\nIf you have any issues at collection, you can reach Leo on +44 7933 019849. Please keep the conversation here in your rental chat where possible.";
  }
  await postRentalMessage(ctx, { accountId: account._id, bookingId, sender: "system", text: message, meta: { kind: "verification_update", status, ...(pickupMap ? { pickupMap: true } : {}) } });
}
