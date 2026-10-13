import { SECURITY_POLICY_VERSION, REFUNDABLE_DEPOSIT_POLICY_VERSION, refundableDepositFor } from "./rentalSecurity";
import { readAgreementSnapshot } from "./rentalAgreement";

export const SECURITY_COLLECTION_NOTICE_HOURS = 7 * 24;
export const SECURITY_COLLECTION_DAYS = 30;
export function savedCardConsentText(limit: number, refundableDeposit?: number) {
  if (!Number.isFinite(limit) || limit < 0) throw Error("Invalid saved-card collection limit.");
  if (refundableDeposit !== undefined && (!Number.isFinite(refundableDeposit) || refundableDeposit < 0 || ![0,50,100].includes(refundableDeposit))) throw Error("Invalid refundable deposit.");
  const security = refundableDeposit === undefined ? "No security payment is charged and no funds are blocked at checkout or pickup." : `A refundable deposit of £${refundableDeposit.toFixed(2)} is included in today’s payment; no additional funds are blocked. Any retained deposit counts toward this combined limit and the same assessed loss, reducing later card collection. Unused deposit is refunded to the original payment card after the return decision, with retained amounts and reasons itemised.`;
  return `I authorise DB Cinema Rentals to save my card through Stripe and attempt later card payments for evidenced equipment damage or loss and properly assessed late-return fees, up to £${limit.toFixed(2)} in total for this rental. This is 10% of the quoted equipment replacement value (£100 per £1,000). ${security} Before collection I will receive an itemised notice and evidence with at least seven days to raise an error or dispute. Collection may be attempted within 30 days after the recorded return. My bank may decline a payment or require authentication. Fair wear, pre-existing defects and loss attributable to DB are excluded. Amounts above this card-payment limit require a separate payment agreement; statutory and bank dispute rights remain unchanged.`;
}
export function isSavedCardRental(b: any) { return [SECURITY_POLICY_VERSION, REFUNDABLE_DEPOSIT_POLICY_VERSION].includes(b?.securityPolicyVersion); }
export function savedCardRentalValue(b: any) {
  return b.lineItems.reduce((sum:number,line:any)=>{
    const value=b.replacementValues?.find((row:any)=>row.listingId===line.listingId)?.unitPence;
    if(!Number.isSafeInteger(value)||value<0||!Number.isSafeInteger(line.qty)||line.qty<1)throw Error("The retained equipment replacement value needs review.");
    return sum+value*line.qty/100;
  },0);
}
export function assertSavedCardConsent(b: any) {
  if (!isSavedCardRental(b) || !Number.isFinite(b?.savedCardLimit) || b.savedCardLimit < 0)
    throw Error("The retained saved-card payment consent is missing or inconsistent. No charge is permitted.");
  const snapshot = readAgreementSnapshot(b?.agreementSnapshot);
  const cashPolicy = b?.securityPolicyVersion === REFUNDABLE_DEPOSIT_POLICY_VERSION;
  const deposit = cashPolicy ? b.depositAmount : undefined;
  const expectedConsent = savedCardConsentText(b?.savedCardLimit ?? 0, deposit);
  if (!isSavedCardRental(b) || !Number.isFinite(b.savedCardLimit) || b.savedCardLimit < 0 || !b.laterChargeConsentAt || !b.agreementSignedAt ||
      !snapshot || snapshot.acceptedAt !== b.agreementSignedAt || snapshot.signer !== b.agreementName ||
      snapshot.particulars.securityPolicyVersion !== b.securityPolicyVersion ||
      snapshot.particulars.savedCardLimit !== b.savedCardLimit ||
      snapshot.particulars.savedCardConsent !== expectedConsent ||
      b.savedCardConsentText !== expectedConsent ||
      (cashPolicy ? b.depositAmount !== refundableDepositFor(savedCardRentalValue(b)) || snapshot.particulars.securityPayment !== b.depositAmount : b.depositAmount !== 0) || (b.depositHoldAmount ?? 0) !== 0)
    throw Error("The retained saved-card payment consent is missing or inconsistent. No charge is permitted.");
  return b.savedCardLimit as number;
}
/** Cash retained is already collected; it consumes the combined allowance permanently. */
export function retainedDepositPence(b: any) {
  if (b?.securityPolicyVersion !== REFUNDABLE_DEPOSIT_POLICY_VERSION) return 0;
  const kept = b.depositKept ?? 0;
  const pence = Math.round(kept * 100);
  if (!Number.isFinite(kept) || kept < 0 || !Number.isSafeInteger(pence) || pence / 100 !== kept || kept > b.depositAmount || kept > b.savedCardLimit)
    throw Error("The recorded retained deposit requires review before further collection.");
  return pence;
}
export function assertSavedCardCollection(b: any, now = Date.now()) {
  assertSavedCardConsent(b);
  retainedDepositPence(b);
  if (b.securityPolicyVersion === REFUNDABLE_DEPOSIT_POLICY_VERSION && b.depositAmount > 0 && !b.depositRefunded)
    throw Error("Finish the refundable deposit settlement before preparing or collecting a later card charge.");
  if (b.status !== "returned" || !b.actualReturnedAt || !b.pickedUpAt || b.actualReturnedAt < b.pickedUpAt || b.cancellationDecision ||
      now > b.actualReturnedAt + SECURITY_COLLECTION_DAYS * 86400000)
    throw Error("Saved-card collection is only available within 30 days after this rental's recorded return.");
  if (b.savedCardStatus !== "saved" || !b.savedCardCustomerId || !b.savedCardPaymentMethodId)
    throw Error("A reusable card bound to this rental is required before collection.");
}
