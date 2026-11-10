import { LEGAL_VERSION, REFUNDABLE_DEPOSIT_LEGAL_VERSION, ASSESSMENT_DEPOSIT_LEGAL_VERSION, CANCELLATION_PROTECTION_LEGAL_VERSION, CARD_HOLD_LEGAL_VERSION, SETUP_INTENT_LEGAL_VERSION, SETUP_INTENT_LEGAL_VERSIONS, IMMEDIATE_CLAIM_LEGAL_VERSION, IMMEDIATE_CLAIM_LEGAL_VERSIONS, agreementsForSecurityPolicy } from "../src/lib/legal";
import { ASSESSMENT_SECURITY_POLICY_VERSION, CARD_HOLD_SECURITY_POLICY_VERSION, isCardHoldSecurityPolicy, isSetupIntentSecurityPolicy, isImmediateClaimSecurityPolicy } from "./rentalSecurity";
import { LEGAL_DOCS, LEGAL_ARCHIVE, RENTAL_DRAFT_RELEASE_READY, type LegalDoc } from "./legalDocuments";
import { CURRENT_PRIVACY_NOTICE } from "./currentPrivacyNotice";
import { TRAFALGAR_PICKUP_AREA } from "./pickupLocation";

export const DELIVERY_TERMS_VERSION = "2026-10-delivery-v2";
export const DELIVERY_ACCEPTANCE_TEXT = "Delivery uses an agreed third-party courier. Times are estimates and may be affected by traffic. The final delivery price is shown in your accepted quotation. Courier delays do not remove statutory rights; tell us promptly so we can assess the delay and available remedy.";
/** Convex/object key ordering is not agreement substance. */
export function agreementRequestFingerprint(value: unknown): string {
  const ordered=(v:any):any=>Array.isArray(v)?v.map(ordered):v&&typeof v==="object"
    ? Object.fromEntries(Object.keys(v).sort().filter(k=>v[k]!==undefined).map(k=>[k,ordered(v[k])])) : v;
  return JSON.stringify(ordered(value));
}
type Accepted = { kind: string; version: string };
export type AgreementSnapshot = {
  format: 1; version: string; acceptedAt: number; signer: string;
  documents: (Accepted & { text: LegalDoc })[];
  particulars: {
    customerName: string; email: string; billingAddress: string;
    fulfilment: string; address: string | null; pickupArea: string | null; deliveryTermsAccepted: boolean; pickupTime: string; returnTime: string;
    timeZone: "Europe/London";
    lineItems: { listingId: string; title: string; start: number; end: number; qty: number; lineTotal: number; dailyRate?: number;pickupTime?:string|null;returnTime?:string|null }[];
    subtotal: number; discount: number; deliveryFee: number; securityPayment: number;
    securityHold: number; total: number; creditApplied: number;useAccountCredit?:boolean; currency: string;
    securityPolicyVersion: string | null; securityWaiverReason: string | null;
    savedCardLimit?: number; savedCardConsent?: string;
    serialConditionSchedule: "pending-agreed-handover";
  };
};

export function assertCurrentAgreement(a: { name?: string; securityHoldConsent?: boolean; laterChargeConsent?: boolean; deliveryAccepted?:boolean; documents?: Accepted[]; securityPolicyVersion?: string; cancellationProtectionEnabled?:boolean } | undefined, fulfilment: string) {
  if (!a?.name || a.name.trim().length < 3 || !a.securityHoldConsent || (!isCardHoldSecurityPolicy(a.securityPolicyVersion) && !a.laterChargeConsent))
    throw Error("Please sign the rental agreement to continue.");
  if(isCardHoldSecurityPolicy(a.securityPolicyVersion)&&a.laterChargeConsent)
    throw Error("This hold agreement does not authorise later off-session charges.");
  const expected: Accepted[] = [...agreementsForSecurityPolicy(a?.securityPolicyVersion,a?.cancellationProtectionEnabled)];
  if (fulfilment === "delivery") expected.push({kind:"delivery-disclaimer",version:DELIVERY_TERMS_VERSION});
  if (a.documents?.length !== expected.length || !expected.every(e => a.documents!.filter(d => d.kind === e.kind && d.version === e.version).length === 1))
    throw Error("Please review and accept the current rental agreements before paying.");
  if (fulfilment === "delivery" && a.deliveryAccepted !== true)
    throw Error("Please accept the delivery arrangements before paying.");
}

/** Created only inside the booking transaction from its canonical saved price.
 * Never reconstruct accepted text from whatever the public pages now say. */
export function snapshotAgreement(a: any, acceptedAt: number, chargedTotal: number, creditApplied: number): string {
  assertCurrentAgreement({name:a.agreementName,securityHoldConsent:a.securityHoldConsent,laterChargeConsent:a.laterChargeConsent,deliveryAccepted:a.deliveryAccepted,documents:a.agreementDocs,securityPolicyVersion:a.securityPolicyVersion,cancellationProtectionEnabled:a.cancellationProtectionEnabled},a.fulfilment);
  if (!a.customerName?.trim() || !a.billingAddress?.trim() || !a.pickupTime || !a.returnTime || !a.lineItems?.length)
    throw Error("Complete booking particulars are required for agreement acceptance.");
  const legalVersion = agreementsForSecurityPolicy(a.securityPolicyVersion,a.cancellationProtectionEnabled).find(doc=>doc.kind==="rental-agreement")!.version;
  const docs = legalVersion === LEGAL_VERSION ? LEGAL_DOCS : LEGAL_ARCHIVE[legalVersion];
  const snapshot: AgreementSnapshot = {
    format:1, version:legalVersion, acceptedAt, signer:a.agreementName.trim(),
    documents:a.agreementDocs.map((d:Accepted) => ({...d,text:d.kind === "delivery-disclaimer"
      ? {title:"Delivery arrangements",updated:"October 2026",sections:[{h:"Delivery",p:DELIVERY_ACCEPTANCE_TEXT}]}
      : d.kind === "privacy" ? CURRENT_PRIVACY_NOTICE : docs[d.kind]})),
    particulars:{customerName:a.customerName.trim(),email:a.customerEmail.trim().toLowerCase(),billingAddress:a.billingAddress,
      fulfilment:a.fulfilment,address:a.address??null,pickupArea:a.fulfilment === "pickup" ? TRAFALGAR_PICKUP_AREA : null,
      deliveryTermsAccepted:a.fulfilment === "delivery" && a.deliveryAccepted === true,pickupTime:a.pickupTime,returnTime:a.returnTime,timeZone:"Europe/London",
      lineItems:a.lineItems.map((line:any)=>({...line})),subtotal:a.subtotal,discount:a.discount??0,deliveryFee:a.deliveryFee,
      ...(a.useAccountCredit!==undefined?{useAccountCredit:a.useAccountCredit}:{}),securityPayment:a.depositAmount,securityHold:a.depositHoldAmount??0,total:chargedTotal,creditApplied,currency:a.currency,
      securityPolicyVersion:a.securityPolicyVersion??null,securityWaiverReason:a.securityWaiverReason??null,
      ...(a.savedCardLimit !== undefined ? {savedCardLimit:a.savedCardLimit,savedCardConsent:a.savedCardConsentText} : {}),
      serialConditionSchedule:"pending-agreed-handover"},
  };
  return JSON.stringify(snapshot);
}

export function readAgreementSnapshot(value: string | undefined): AgreementSnapshot | null {
  if (!value) return null;
  try {
    const s=JSON.parse(value);
    return s.format===1 && typeof s.version==="string" && typeof s.signer==="string" && Number.isFinite(s.acceptedAt) &&
      Array.isArray(s.documents) && s.documents.length>0 && s.documents.every((d:any)=>typeof d.kind==="string" && typeof d.version==="string" && Array.isArray(d.text?.sections) && d.text.sections.every((x:any)=>typeof x.h==="string" && typeof x.p==="string")) &&
      s.particulars?.timeZone==="Europe/London" && Array.isArray(s.particulars.lineItems) ? s : null;
  } catch { return null; }
}

export function assertAgreementBeforeRelease(b: any) {
  if (!b.agreementName?.trim() || !b.agreementSignedAt ||
      !b.agreementDocs?.some((d:Accepted)=>d.kind==="rental-agreement" && !!d.version))
    throw Error("Retained agreement acceptance is required before handover; do not backfill or infer consent.");
  const acceptedVersion=b.agreementDocs.find((d:Accepted)=>d.kind==="rental-agreement")?.version??"";
  if ([LEGAL_VERSION,REFUNDABLE_DEPOSIT_LEGAL_VERSION,"2026-10-v15","2026-10-v16",ASSESSMENT_DEPOSIT_LEGAL_VERSION,CANCELLATION_PROTECTION_LEGAL_VERSION,CARD_HOLD_LEGAL_VERSION,...SETUP_INTENT_LEGAL_VERSIONS,...IMMEDIATE_CLAIM_LEGAL_VERSIONS].includes(acceptedVersion)) {
    const s=readAgreementSnapshot(b.agreementSnapshot);
    const allowedVersions=isImmediateClaimSecurityPolicy(b.securityPolicyVersion)?IMMEDIATE_CLAIM_LEGAL_VERSIONS:isSetupIntentSecurityPolicy(b.securityPolicyVersion)?SETUP_INTENT_LEGAL_VERSIONS:b.securityPolicyVersion===CARD_HOLD_SECURITY_POLICY_VERSION?[CARD_HOLD_LEGAL_VERSION]:b.securityPolicyVersion===ASSESSMENT_SECURITY_POLICY_VERSION
      ?b.cancellationProtectionEnabled?["2026-10-v16",CANCELLATION_PROTECTION_LEGAL_VERSION]:["2026-10-v15",ASSESSMENT_DEPOSIT_LEGAL_VERSION]
      :b.securityPolicyVersion===REFUNDABLE_DEPOSIT_LEGAL_VERSION?[REFUNDABLE_DEPOSIT_LEGAL_VERSION]:[LEGAL_VERSION];
    if (!s || !allowedVersions.includes(acceptedVersion) || s.version!==acceptedVersion || s.signer!==b.agreementName.trim() || s.acceptedAt!==b.agreementSignedAt ||
      !b.securityHoldConsentAt || (!isCardHoldSecurityPolicy(b.securityPolicyVersion) && !b.laterChargeConsentAt) ||
      s.documents.length!==b.agreementDocs.length || !s.documents.every(d=>b.agreementDocs.some((e:Accepted)=>e.kind===d.kind && e.version===d.version)))
      throw Error("The accepted agreement copy is missing or inconsistent; release is blocked.");
  }
  // A historic signature is preserved, but it cannot certify new operational
  // evidence or turn an unreviewed Didit/reuse decision into broker approval.
  if (!RENTAL_DRAFT_RELEASE_READY)
    throw Error("Broker, legal and operational review of agreement and verification evidence is outstanding; equipment release is blocked.");
}
