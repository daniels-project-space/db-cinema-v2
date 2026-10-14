import { ASSESSMENT_SECURITY_POLICY_VERSION, depositForBookingPolicy, hasCashDepositPolicy, SECURITY_POLICY_VERSION, REFUNDABLE_DEPOSIT_POLICY_VERSION, refundableDepositFor, savedCardChargeLimit } from "./rentalSecurity";
import { readAgreementSnapshot } from "./rentalAgreement";

export const SECURITY_COLLECTION_NOTICE_HOURS = 7 * 24;
export const SECURITY_COLLECTION_DAYS = 30;
export function savedCardConsentText(limit: number, refundableDeposit?: number) {
  if (!Number.isFinite(limit) || limit < 0) throw Error("Invalid saved-card collection limit.");
  if (refundableDeposit !== undefined && (!Number.isFinite(refundableDeposit) || refundableDeposit < 0 || ![0,50,100].includes(refundableDeposit))) throw Error("Invalid refundable deposit.");
  const security = refundableDeposit === undefined ? "No security payment is charged and no funds are blocked at checkout or pickup." : `A refundable deposit of £${refundableDeposit.toFixed(2)} is included in today’s payment; no additional funds are blocked. Any retained deposit counts toward this combined limit and the same assessed loss, reducing later card collection. Unused deposit is refunded to the original payment card after the return decision, with retained amounts and reasons itemised.`;
  return `I authorise DB Cinema Rentals to save my card through Stripe and attempt later card payments for evidenced equipment damage or loss and properly assessed late-return fees, up to £${limit.toFixed(2)} in total for this rental. This is 10% of the quoted equipment replacement value (£100 per £1,000). ${security} Before collection I will receive an itemised notice and evidence with at least seven days to raise an error or dispute. Collection may be attempted within 30 days after the recorded return. My bank may decline a payment or require authentication. Fair wear, pre-existing defects and loss attributable to DB are excluded. Amounts above this card-payment limit require a separate payment agreement; statutory and bank dispute rights remain unchanged.`;
}
export function isSavedCardRental(b: any) { return [SECURITY_POLICY_VERSION, REFUNDABLE_DEPOSIT_POLICY_VERSION, ASSESSMENT_SECURITY_POLICY_VERSION].includes(b?.securityPolicyVersion); }
export function savedCardRentalValue(b: any) {
  return b.lineItems.reduce((sum:number,line:any)=>{
    const value=b.replacementValues?.find((row:any)=>row.listingId===line.listingId)?.unitPence;
    if(!Number.isSafeInteger(value)||value<0||!Number.isSafeInteger(line.qty)||line.qty<1)throw Error("The retained equipment replacement value needs review.");
    return sum+value*line.qty/100;
  },0);
}
export function securityAmendmentConsentText(limit:number,deposit:number,priorLimit:number,priorDeposit:number,policy?:string) {
  if(policy===ASSESSMENT_SECURITY_POLICY_VERSION)return `I accept this equipment change and authorise the future card payments in the linked rental terms. Total refundable deposit £${deposit.toFixed(2)}, with £${(deposit-priorDeposit).toFixed(2)} extra due. `+assessmentConsentText(deposit);
  const permission=savedCardConsentText(limit,deposit).replace(`A refundable deposit of £${deposit.toFixed(2)} is included in today’s payment;`,`The total refundable deposit for this rental is £${deposit.toFixed(2)}; £${(deposit-priorDeposit).toFixed(2)} extra is due with this equipment update;`);
  return `I accept the proposed equipment change. This updates permission for the card currently saved for this rental; paying this equipment update with another card does not replace that saved card. The refundable deposit changes from £${priorDeposit.toFixed(2)} to £${deposit.toFixed(2)}, and the combined saved-card damage/late-fee limit changes from £${priorLimit.toFixed(2)} to £${limit.toFixed(2)}. `+permission;
}
export function assessmentConsentText(deposit:number){
 if(![0,20,50,100].includes(deposit))throw Error("Invalid refundable deposit");
 return `I agree to the linked rental terms and authorise DB Cinema Rentals to save my card through Stripe for future payments for evidenced damage, loss and late-return fees. A refundable deposit of £${deposit.toFixed(2)} is included today. Any retained deposit reduces the same assessment; unused deposit is refunded automatically to the original card after a return without issues. Later payments require an itemised notice and evidence with at least seven days for review and may be attempted within 30 days of return. Fair wear, pre-existing defects and loss attributable to DB are excluded. My bank may decline or require authentication; statutory and bank dispute rights remain unchanged.`;
}
function assertAssessmentConsent(b:any){
 const snapshot=readAgreementSnapshot(b.agreementSnapshot);
 const fail=()=>{throw Error("The retained future-payment consent is missing or inconsistent. No charge is permitted.")};
 if(!snapshot || snapshot.version!==(b.cancellationProtectionEnabled?"2026-10-v16":"2026-10-v15") || snapshot.acceptedAt!==b.agreementSignedAt || !b.laterChargeConsentAt || snapshot.signer!==b.agreementName || snapshot.particulars.securityPolicyVersion!==ASSESSMENT_SECURITY_POLICY_VERSION || snapshot.particulars.savedCardLimit!==0 || b.savedCardLimit!==0 || (b.depositHoldAmount??0)!==0)return fail();
 if((snapshot.particulars.securityWaiverReason??null)!==(b.securityWaiverReason??null) || b.securityWaiverReason && !["active_membership","encore","membership_checkout"].includes(b.securityWaiverReason))return fail();
 let deposit=snapshot.particulars.securityPayment;
 if(snapshot.particulars.savedCardConsent!==assessmentConsentText(deposit))return fail();
 const seen=new Set<string>();
 let expected=assessmentConsentText(deposit),lastAt=snapshot.acceptedAt;
 for(const r of b.securityAmendments??[]){
  if(!r.additionId || seen.has(r.additionId) || !Number.isSafeInteger(r.replacementValuePence) || r.replacementValuePence<0 || !Number.isSafeInteger(Math.round(r.depositAmount*100)) || !Number.isFinite(r.acceptedAt) || !r.accountId || r.accountId!==b.accountId || r.acceptedAt<lastAt || r.priorDeposit!==deposit || r.priorLimit!==0 || r.savedCardLimit!==0 || r.depositAmount!==Math.max(deposit,depositForBookingPolicy(b,r.replacementValuePence/100)) || (r.depositAmount>deposit && !(r.paymentIntentId || r.draftReplacement&&r.sessionId&&b.stripePaymentIntentId)))return fail();
  expected=securityAmendmentConsentText(0,r.depositAmount,0,deposit,ASSESSMENT_SECURITY_POLICY_VERSION);
  if(r.consentText!==expected)return fail();seen.add(r.additionId);deposit=r.depositAmount;lastAt=r.acceptedAt;
 }
 if(b.depositAmount!==deposit || b.savedCardConsentText!==expected)return fail();
 return 0;
}

export function assertSavedCardConsent(b:any) {
  if(b?.securityPolicyVersion===ASSESSMENT_SECURITY_POLICY_VERSION)return assertAssessmentConsent(b);
  const fail=()=>{throw Error("The retained saved-card payment consent is missing or inconsistent. No charge is permitted.")};
  if(!isSavedCardRental(b)||!Number.isFinite(b.savedCardLimit)||b.savedCardLimit<0) return fail();
  const snapshot=readAgreementSnapshot(b.agreementSnapshot),cashPolicy=b.securityPolicyVersion===REFUNDABLE_DEPOSIT_POLICY_VERSION;
  if(!snapshot||!b.laterChargeConsentAt||!b.agreementSignedAt||snapshot.acceptedAt!==b.agreementSignedAt||snapshot.signer!==b.agreementName||snapshot.particulars.securityPolicyVersion!==b.securityPolicyVersion||(b.depositHoldAmount??0)!==0)return fail();
  let limit:number=snapshot.particulars.savedCardLimit as number,deposit=cashPolicy?snapshot.particulars.securityPayment:0;
  if(typeof limit!=="number"||!Number.isFinite(limit)||limit<0||snapshot.particulars.savedCardConsent!==savedCardConsentText(limit,cashPolicy?deposit:undefined))return fail();
  const rows=b.securityAmendments??[];if(!cashPolicy&&rows.length)return fail();
  const seen=new Set();let lastAt=snapshot.acceptedAt;
  for(const r of rows){
    if(!r.additionId||seen.has(r.additionId)||!r.accountId||!Number.isSafeInteger(r.acceptedAt)||r.acceptedAt<=0||(b.accountId&&r.accountId!==b.accountId)||!Number.isSafeInteger(r.replacementValuePence)||r.replacementValuePence<0||r.acceptedAt<lastAt||r.priorDeposit!==deposit||r.priorLimit!==limit||r.depositAmount<deposit||r.savedCardLimit!==Math.max(limit,Math.round(r.replacementValuePence/10)/100)||r.consentText!==securityAmendmentConsentText(r.savedCardLimit,r.depositAmount,limit,deposit)||r.depositAmount!==Math.max(deposit,refundableDepositFor(r.replacementValuePence/100))||(r.depositAmount>deposit&&!(r.paymentIntentId||r.draftReplacement&&r.sessionId&&b.stripePaymentIntentId)))return fail();
    seen.add(r.additionId);deposit=r.depositAmount;limit=r.savedCardLimit;lastAt=r.acceptedAt;
  }
  if(cashPolicy&&savedCardChargeLimit(savedCardRentalValue(b))>limit)return fail();
  if(b.savedCardLimit!==limit||b.depositAmount!==deposit||b.savedCardConsentText!==(rows.length?rows[rows.length-1].consentText:savedCardConsentText(limit,cashPolicy?deposit:undefined)))return fail();
  return limit;
}
/** Cash retained is already collected; it consumes the combined allowance permanently. */
export function retainedDepositPence(b: any) {
  if (!hasCashDepositPolicy(b?.securityPolicyVersion)) return 0;
  const kept = b.depositKept ?? 0;
  const pence = Math.round(kept * 100);
  if (!Number.isFinite(kept) || kept < 0 || !Number.isSafeInteger(pence) || pence / 100 !== kept || kept > b.depositAmount || b.securityPolicyVersion!==ASSESSMENT_SECURITY_POLICY_VERSION && kept > b.savedCardLimit)
    throw Error("The recorded retained deposit requires review before further collection.");
  return pence;
}
export function assertSavedCardCollection(b: any, now = Date.now()) {
  assertSavedCardConsent(b);
  retainedDepositPence(b);
  if (hasCashDepositPolicy(b.securityPolicyVersion) && b.depositAmount > 0 && !b.depositRefunded)
    throw Error("Finish the refundable deposit settlement before preparing or collecting a later card charge.");
  if (b.status !== "returned" || !b.actualReturnedAt || !b.pickedUpAt || b.actualReturnedAt < b.pickedUpAt || b.cancellationDecision ||
      now > b.actualReturnedAt + SECURITY_COLLECTION_DAYS * 86400000)
    throw Error("Saved-card collection is only available within 30 days after this rental's recorded return.");
  if (b.savedCardStatus !== "saved" || !b.savedCardCustomerId || !b.savedCardPaymentMethodId)
    throw Error("A reusable card bound to this rental is required before collection.");
}
