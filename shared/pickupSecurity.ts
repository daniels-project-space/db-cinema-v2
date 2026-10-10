/** New bookings authorise the agreed hold at the London pickup slot, not checkout. */
export const PICKUP_HOLD_POLICY = "2026-10-pickup-hold-v1";
import {londonRentalInstant} from "./rentalWindow";
export function pickupHoldAt(booking:{lineItems:{start:number;pickupTime?:string|null}[];pickupTime?:string}) {
 if(!booking.lineItems.length)throw Error("An agreed pickup date and time are required for the security hold.");
 return Math.min(...booking.lineItems.map(line=>{
  const time=line.pickupTime===undefined?booking.pickupTime:line.pickupTime;
  if(!time||!/^([01]\d|2[0-3]):[0-5]\d$/.test(time))throw Error("An agreed pickup date and time are required for the security hold.");
  try{return londonRentalInstant(line.start,time);}catch{throw Error("This pickup time is ambiguous or does not exist because the clocks change. Choose another time.");}
 }));
}
export function pickupHoldEligible(b: any) {
  return (
    !!b &&
    b.securityHoldPolicyVersion === PICKUP_HOLD_POLICY &&
    ["confirmed", "active"].includes(b.status) &&
    !b.cancellationDecision &&
    !b.returnDecision &&
    !b.returnedAt &&
    (b.depositHoldAmount ?? 0) > 0
  );
}

/** Only an untouched pickup job may change amount without retiring an intent.
 * A saved settlement prevents handover and may finish after its pickup slot. */
export function canDeferAdditionSecurity(b:any,now=Date.now()) {
 const waitingForSettlement=b?.status==="confirmed"&&b.pickedUpAt==null&&
  !!(b.activeAdditionId||b.activeSwapRefundId||b.activeExtensionId);
 return pickupHoldEligible(b)&&(pickupHoldAt(b)>now||waitingForSettlement)&&
  b.depositHoldStatus==="scheduled"&&!b.stripeDepositIntentId&&
  !!b.securityHoldCustomerId&&!!b.securityHoldPaymentMethodId&&
  !(b.securityHoldAttempts??0)&&!b.securityHoldLeaseUntil&&
  !b.securityHoldRecoverySessionId;
}
