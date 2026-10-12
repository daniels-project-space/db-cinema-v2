import { SECURITY_POLICY_VERSION } from "./rentalSecurity";
import { readAgreementSnapshot } from "./rentalAgreement";

export const SECURITY_COLLECTION_NOTICE_HOURS = 7 * 24;
export const SECURITY_COLLECTION_DAYS = 30;
export function savedCardConsentText(limit: number) {
  if (!Number.isFinite(limit) || limit < 0) throw Error("Invalid saved-card collection limit.");
  return `I authorise DB Cinema Rentals to save my card through Stripe and attempt later card payments for evidenced equipment damage or loss and properly assessed late-return fees, up to £${limit.toFixed(2)} in total for this rental. This is 10% of the quoted equipment replacement value (£100 per £1,000). No security payment is charged and no funds are blocked at checkout or pickup. Before collection I will receive an itemised notice and evidence with at least seven days to raise an error or dispute. Collection may be attempted within 30 days after the recorded return. My bank may decline a payment or require authentication. Fair wear, pre-existing defects and loss attributable to DB are excluded. Amounts above this card-payment limit require a separate payment agreement; statutory and bank dispute rights remain unchanged.`;
}
export function isSavedCardRental(b: any) { return b?.securityPolicyVersion === SECURITY_POLICY_VERSION; }
export function savedCardRentalValue(b: any) {
  return b.lineItems.reduce((sum:number,line:any)=>{
    const value=b.replacementValues?.find((row:any)=>row.listingId===line.listingId)?.unitPence;
    if(!Number.isSafeInteger(value)||value<0||!Number.isSafeInteger(line.qty)||line.qty<1)throw Error("The retained equipment replacement value needs review.");
    return sum+value*line.qty/100;
  },0);
}
export function assertSavedCardConsent(b: any) {
  const snapshot = readAgreementSnapshot(b?.agreementSnapshot);
  if (!isSavedCardRental(b) || !Number.isFinite(b.savedCardLimit) || b.savedCardLimit < 0 || !b.laterChargeConsentAt || !b.agreementSignedAt ||
      !snapshot || snapshot.acceptedAt !== b.agreementSignedAt || snapshot.signer !== b.agreementName ||
      snapshot.particulars.securityPolicyVersion !== SECURITY_POLICY_VERSION ||
      snapshot.particulars.savedCardLimit !== b.savedCardLimit ||
      snapshot.particulars.savedCardConsent !== savedCardConsentText(b.savedCardLimit) ||
      b.savedCardConsentText !== savedCardConsentText(b.savedCardLimit) ||
      b.depositAmount !== 0 || (b.depositHoldAmount ?? 0) !== 0)
    throw Error("The retained saved-card payment consent is missing or inconsistent. No charge is permitted.");
  return b.savedCardLimit as number;
}
export function assertSavedCardCollection(b: any, now = Date.now()) {
  assertSavedCardConsent(b);
  if (b.status !== "returned" || !b.actualReturnedAt || !b.pickedUpAt || b.actualReturnedAt < b.pickedUpAt || b.cancellationDecision ||
      now > b.actualReturnedAt + SECURITY_COLLECTION_DAYS * 86400000)
    throw Error("Saved-card collection is only available within 30 days after this rental's recorded return.");
  if (b.savedCardStatus !== "saved" || !b.savedCardCustomerId || !b.savedCardPaymentMethodId)
    throw Error("A reusable card bound to this rental is required before collection.");
}
