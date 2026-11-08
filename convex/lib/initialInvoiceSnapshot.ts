import { rentalBillingLines } from "./rentalBillingLines";
import { readAgreementSnapshot } from "../../shared/rentalAgreement";

/** Stable customer invoice fields captured on first issue. Later rental changes
 * use separate adjustment and return records, never a rewritten base invoice. */
export function initialInvoiceSnapshot(booking:any,customerName?:string|null,customerEmail?:string|null) {
  return {
    number:`DBC-${String(booking._id).slice(-8).toUpperCase()}`,
    issuedAt:Number.isSafeInteger(booking._creationTime)?booking._creationTime:Date.now(),
    supplierName:"DB Cinema Rentals",supplierAddress:undefined,status:booking.status,
    customerName:customerName??booking.guestName??null,
    email:customerEmail??booking.guestEmail??null,
    fulfilment:booking.fulfilment,address:booking.address??null,currency:booking.currency??"GBP",
    equipmentImages:[],lineItems:rentalBillingLines(booking),
    subtotal:booking.subtotal,discount:booking.discount??0,deliveryFee:booking.deliveryFee??0,
    creditApplied:booking.creditApplied??0,membershipCreditApplied:booking.membershipCreditApplied??0,
    depositAmount:booking.depositAmount,depositHoldAmount:booking.depositHoldAmount??0,depositHoldStatus:booking.depositHoldStatus??null,
    securityPolicyVersion:booking.securityPolicyVersion??null,savedCardStatus:booking.savedCardStatus??null,savedCardLimit:booking.savedCardLimit??null,
    depositRefunded:booking.depositRefunded??false,depositRefundAmount:booking.depositRefundAmount??(booking.depositRefunded?null:0),
    total:booking.total,promoCode:booking.promoCode??null,
    agreementSnapshot:readAgreementSnapshot(booking.agreementSnapshot),
    acceptedAgreementEvidence:{name:booking.agreementName??null,signedAt:booking.agreementSignedAt??null,documents:booking.agreementDocs??[]},
    rentalRefunded:0,rentalRefunds:[],cancellationRefund:booking.refundAmount??0,accountCreditIssued:0,accountCreditBonus:0,
  };
}
