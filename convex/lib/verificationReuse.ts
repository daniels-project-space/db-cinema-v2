import { postRentalMessage } from "./rentalChat";
import { accountForRental } from "./rentalAccount";
import { LEO_SUPPORT_PHONE, pickupMapAvailable } from "../../shared/pickupLocation";
import { verificationExpired, verificationValidUntil } from "../../shared/verificationProgress";
import { renterHandoverDetailsReady } from "./renterRentalActionGate";
import { WATERSTONES_MAP_URL } from "./pickupMap";

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
async function activeAccountVerificationSourceMatches(ctx:any,account:any,record:any,name:string) {
  if (!record?.sourceBookingId || !Number.isSafeInteger(record.verifiedAt) || record.name !== name) return false;
  const source=await ctx.db.get(record.sourceBookingId);
  return !!source && source.accountId===account._id && source.verificationProvider==="didit" &&
    source.idVerificationSource==="didit" && source.idVerifyStatus==="verified" &&
    !!source.diditSessionId && source.verificationReuseBlockedSessionId!==source.diditSessionId &&
    source.idVerifiedAt===record.verifiedAt && verificationDetail(source.agreementName)===record.name &&
    verificationDetail(source.billingAddress)===record.address &&
    ["identity","selfie","address"].every(key=>source.verificationChecks?.[key]==="approved") &&
    await verificationReuseOwnerMatches(ctx,source);
}
export function validReuse(record: any, booking: any, now = Date.now()) {
  const expiresAt = verificationValidUntil(record);
  return !!record && Array.isArray(booking.lineItems) && booking.lineItems.length > 0 &&
    expiresAt != null && booking.lineItems.every((li: any) => Number.isFinite(li.start) && expiresAt > li.start) && expiresAt > now &&
    !!verificationDetail(booking.agreementName) && !!verificationDetail(booking.billingAddress) && !!verificationDetail(record.address) &&
    record.name === verificationDetail(booking.agreementName);
}
export async function saveAccountDiditVerification(ctx: any, booking: any, verifiedAt: number, documentExpiresAt: number | undefined, checks: any, personKey: string | undefined) {
  if (!await verificationReuseOwnerMatches(ctx,booking) || booking.verificationProvider !== "didit" ||
      booking.idVerificationSource !== "didit" || booking.idVerifyStatus !== "verified" || !booking.diditSessionId ||
      booking.verificationReuseBlockedSessionId === booking.diditSessionId || !Number.isSafeInteger(verifiedAt) ||
      !Number.isSafeInteger(booking.idVerifiedAt) ||
      !["identity", "selfie", "address"].every(key => checks?.[key] === "approved" && booking.verificationChecks?.[key] === "approved") ||
      (documentExpiresAt != null && !Number.isFinite(documentExpiresAt))) return false;
  const name = verificationDetail(booking.agreementName), address = verificationDetail(booking.billingAddress);
  const approvedAt = booking.idVerifiedAt;
  const expiresAt = approvedAt + VERIFICATION_REUSE_DAYS * 86400000;
  if (!name || !address || expiresAt <= Date.now()) return false;
  const account = await ctx.db.get(booking.accountId);
  if (!account || account.blockedAt != null || !account.emailVerifiedAt || !account.name || verificationDetail(account.name) !== name) return false;
  const current=account.rentalVerification;
  if ((current?.verifiedAt ?? 0) > approvedAt) return false;
  if (current?.name === name && (verificationValidUntil(current) ?? 0) > Date.now() &&
      await activeAccountVerificationSourceMatches(ctx,account,current,name)) return true;
  if(current && current.verifiedAt===approvedAt && current.sourceBookingId!==booking._id)return false;
  if(current?.sourceBookingId===booking._id && current.name===name && current.address===address && current.verifiedAt===approvedAt && current.expiresAt===expiresAt)return true;
  await ctx.db.patch(account._id, { rentalVerification: { sourceBookingId: booking._id, name, address, verifiedAt: approvedAt, expiresAt } });
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
    processing: "Your booking is paid. Continue verification below; the rental is not confirmed until Didit approves it.",
    verified: "Your identity and address verification is approved for this rental.",
    manual_review: "Your verification is awaiting a team review. We will post the decision here; handover requires approval.",
    requires_input: "More verification information is needed. Open verification in your account to complete or resubmit the requested documents before handover.",
    rejected: "Your verification was not approved, so this rental is not ready for collection. Please contact the team here to discuss the outcome. If someone else will rent, they must place their own booking using their own account and identity. They must be the renter; they cannot verify or book on your behalf, and normal checks still apply.",
  };
  if (!text[status]) return;
  let message=text[status];
  let pickupMapUrl: string | undefined;
  let supportPhone: string | undefined;
  let handoverMode: "pickup" | "delivery" | undefined;
  if(status==="verified"){
    const handoverReady = renterHandoverDetailsReady(booking);
    if (handoverReady) {
      handoverMode = booking.fulfilment === "pickup" ? "pickup" : "delivery";
      if(booking.fulfilment==="pickup"){
        const settings=await ctx.db.query("settings").first();
        if (pickupMapAvailable(settings?.businessAddress)) pickupMapUrl = WATERSTONES_MAP_URL;
        message = "Verification approved. Your pickup map and support contact are below.";
      } else {
        message = "Verification approved. Your support contact is below.";
      }
      supportPhone = LEO_SUPPORT_PHONE;
    } else {
      message += booking.status === "pending_verification"
        ? " Your verification passed. We’re checking the rental now and will post collection details here once it is confirmed."
        : " Your verification passed. Collection details will appear here once any remaining handover steps are complete.";
    }
  }
  await postRentalMessage(ctx, { accountId: account._id, bookingId, sender: "system", text: message, meta: { kind: "verification_update", status, ...(pickupMapUrl ? { pickupMapUrl } : {}), ...(supportPhone ? { supportPhone } : {}), ...(handoverMode ? { handoverMode } : {}) } });
}
