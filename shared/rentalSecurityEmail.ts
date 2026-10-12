import { SECURITY_POLICY_VERSION } from "./rentalSecurity";
import { emailMoney } from "./rentalEmail";

type Security = {securityPolicyVersion?:string|null; savedCardLimit?:number|null; depositAmount?:number; depositHoldAmount?:number};

/** Customer emails follow the immutable policy accepted for this rental. */
export function rentalSecurityEmailRows(booking:Security):Array<[string,string]> {
  if (booking.securityPolicyVersion === SECURITY_POLICY_VERSION)
    return [["Saved-card collection permission · not charged", emailMoney(booking.savedCardLimit ?? 0)]];
  return booking.depositAmount ? [["Refundable deposit paid", emailMoney(booking.depositAmount)]] : [];
}

export function rentalSecurityEmailNote(booking:Security):string {
  if (booking.securityPolicyVersion === SECURITY_POLICY_VERSION)
    return "No security money was taken or blocked. Your combined damage and late-fee permission is separate from the payment total. Any later charge follows the agreed rental terms and notice process.";
  return booking.depositHoldAmount ? "Any card authorisation is separate from the payment total shown above." : "";
}
