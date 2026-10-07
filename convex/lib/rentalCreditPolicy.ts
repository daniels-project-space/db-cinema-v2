import { bookingCancelKind } from "../../src/lib/cancellationPolicy";

export function creditOfferFingerprint(b: any) {
  return JSON.stringify([b.total, b.creditApplied ?? 0, b.stripePaymentIntentId, b.stripeDepositIntentId,
    b.depositHoldRenewalIntentId, b.activeAdditionId, b.lineItems]);
}
export function assertCreditOffer(offer: any, b: any) {
  if (!offer || offer.bookingId !== b._id || offer.expiresAt <= Date.now() || b.status !== "confirmed" ||
    bookingCancelKind(b, Date.now()) !== "full_refund" ||
    offer.fingerprint !== creditOfferFingerprint(b) || b.activeAdditionId || b.returnDecision)
    throw Error("This credit offer is no longer available. Please ask the team for a new quote.");
}
