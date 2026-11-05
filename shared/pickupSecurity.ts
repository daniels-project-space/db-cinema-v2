/** Existing pickup-time holds remain supported for already-booked rentals. */
export const PICKUP_HOLD_POLICY = "2026-10-pickup-hold-v1";
export const CHECKOUT_HOLD_POLICY = "2026-11-checkout-hold-v1";
export const CHECKOUT_CARD_HOLD_POLICY = "2026-11-checkout-card-hold-v1";
export const PICKUP_HOLD_RENEWAL_LEAD_MS = 5 * 60 * 60 * 1000;
export function isPickupHoldPolicyVersion(version: unknown): boolean {
 return version === PICKUP_HOLD_POLICY || version === CHECKOUT_HOLD_POLICY || version === CHECKOUT_CARD_HOLD_POLICY;
}
export function isCheckoutHoldPolicy(booking: { securityHoldPolicyVersion?: string | null } | null | undefined): boolean {
 return booking?.securityHoldPolicyVersion === CHECKOUT_HOLD_POLICY || booking?.securityHoldPolicyVersion === CHECKOUT_CARD_HOLD_POLICY;
}
export function isCheckoutCardHoldPolicy(booking: { securityHoldPolicyVersion?: string | null } | null | undefined): boolean {
 return booking?.securityHoldPolicyVersion === CHECKOUT_CARD_HOLD_POLICY;
}
import {londonRentalInstant} from "./rentalWindow";
export function pickupHoldAt(booking:{lineItems:{start:number;pickupTime?:string|null}[];pickupTime?:string}) {
 if(!booking.lineItems.length)throw Error("An agreed pickup date and time are required for the security hold.");
 return Math.min(...booking.lineItems.map(line=>{
  const time=line.pickupTime===undefined?booking.pickupTime:line.pickupTime;
  if(!time||!/^([01]\d|2[0-3]):[0-5]\d$/.test(time))throw Error("An agreed pickup date and time are required for the security hold.");
  try{return londonRentalInstant(line.start,time);}catch{throw Error("This pickup time is ambiguous or does not exist because the clocks change. Choose another time.");}
 }));
}
export function pickupHoldScheduleMatches(booking: any): boolean {
  const pickupAt = pickupHoldAt(booking);
  return isCheckoutHoldPolicy(booking)
    ? booking.securityHoldPickupAt === pickupAt
    : booking.securityHoldDueAt === pickupAt;
}
export function pickupHoldDueAt(booking: any, now = Date.now()): number {
  const pickupAt = pickupHoldAt(booking);
  return isCheckoutHoldPolicy(booking) ? Math.min(now, pickupAt) : pickupAt;
}
export function pickupHoldRenewalAt(booking: any): number {
  return pickupHoldAt(booking) - PICKUP_HOLD_RENEWAL_LEAD_MS;
}
export function pickupHoldEligible(b: any) {
  return (
    !!b &&
    isPickupHoldPolicyVersion(b.securityHoldPolicyVersion) &&
    (["confirmed", "active"].includes(b.status) || (isCheckoutCardHoldPolicy(b) && b.status === "pending_verification")) &&
    !b.cancellationDecision &&
    !b.returnDecision &&
    !b.returnedAt &&
    (b.depositHoldAmount ?? 0) > 0
  );
}

/** Only an untouched future pickup job may change amount without retiring an intent. */
export function canDeferAdditionSecurity(b:any,now=Date.now()) {
  return pickupHoldEligible(b)&&pickupHoldAt(b)>now&&b.securityHoldDueAt>now&&
  b.depositHoldStatus==="scheduled"&&!b.stripeDepositIntentId&&
  !!b.securityHoldCustomerId&&!!b.securityHoldPaymentMethodId&&
  !(b.securityHoldAttempts??0)&&!b.securityHoldLeaseUntil&&
  !b.securityHoldRecoverySessionId;
}
