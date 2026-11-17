/**
 * A paid rental keeps its own recorded Didit approval for that booking. The
 * account's 90-day reuse badge is checked when creating later bookings; its
 * expiry must not force re-verification in the middle of this rental.
 */
export function hasBookingDiditApproval(booking: any): boolean {
  return !!booking &&
    booking.verificationProvider === "didit" &&
    booking.idVerifyStatus === "verified" &&
    ["didit", "reused_didit"].includes(booking.idVerificationSource) &&
    Number.isSafeInteger(booking.idVerifiedAt) && booking.idVerifiedAt > 0 &&
    ["identity", "selfie", "address"].every(key => booking.verificationChecks?.[key] === "approved");
}

export function renterRentalActionReady(booking: any): boolean {
  return !!booking &&
    ["confirmed", "active"].includes(booking.status) &&
    Number.isSafeInteger(booking.paidConfirmedAt) && booking.paidConfirmedAt > 0 &&
    hasBookingDiditApproval(booking);
}

export function assertRenterRentalActionReady(booking: any): void {
  if (!renterRentalActionReady(booking))
    throw Error("Rental changes are available after payment and Didit verification are complete.");
}
