/** A persisted receipt written only after checkout completion was verified. */
export function hasSuccessfulPaidCheckoutReceipt(booking: any): boolean {
  if (!booking || booking.checkoutPaymentStatus !== "paid") return false;

  const paidAt = booking.checkoutPaidAt;
  const amountPence = booking.checkoutPaymentAmountPence;
  const expectedAmountPence = booking.checkoutExpectedAmountPence;
  const paymentCurrency = booking.checkoutPaymentCurrency;
  const bookingCurrency = booking.currency;

  return Number.isSafeInteger(paidAt) && paidAt > 0 &&
    Number.isSafeInteger(amountPence) && amountPence > 0 &&
    Number.isSafeInteger(expectedAmountPence) && expectedAmountPence === amountPence &&
    typeof paymentCurrency === "string" && paymentCurrency.trim().length === 3 &&
    typeof bookingCurrency === "string" && bookingCurrency.trim().length === 3 &&
    paymentCurrency.toLowerCase() === bookingCurrency.toLowerCase() &&
    typeof booking.stripeCheckoutSessionId === "string" && booking.stripeCheckoutSessionId.trim().length > 0 &&
    typeof booking.stripePaymentIntentId === "string" && booking.stripePaymentIntentId.trim().length > 0;
}

export function isRejectedPendingDiditBooking(booking: any): boolean {
  return booking?.status === "pending_verification" &&
    booking?.verificationProvider === "didit" &&
    booking?.idVerifyStatus === "rejected" &&
    hasSuccessfulPaidCheckoutReceipt(booking);
}
