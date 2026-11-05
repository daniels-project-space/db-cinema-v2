import { ASSESSMENT_SECURITY_POLICY_VERSION, hasCashDepositPolicy, isCardHoldSecurityPolicy, isSetupIntentSecurityPolicy } from "../../shared/rentalSecurity";

/**
 * Versioned legal agreements the renter must e-sign at checkout. The accepted
 * {kind, version} list + signer name + timestamp are stored on the booking as
 * the binding consent record (used for the deposit, liability and insurance).
 * Bump LEGAL_VERSION whenever any agreement text changes.
 */
export const LEGAL_VERSION = "2026-10-v13";

export const AGREEMENTS = [
  { kind:"referrals",title:"Price Benefits & Referral Terms",version:"2026-10-referrals-v2" },
  { kind: "terms", title: "Terms & Conditions", version: LEGAL_VERSION },
  { kind: "rental-terms", title: "Rental Terms", version: LEGAL_VERSION },
  { kind: "rental-agreement", title: "Rental Agreement", version: LEGAL_VERSION },
  { kind: "deposit-agreement", title: "Saved Card & Later Damage/Late-Fee Payment Agreement", version: LEGAL_VERSION },
  { kind: "cancellation", title: "Cancellation & Refund Policy", version: LEGAL_VERSION },
  { kind: "insurance", title: "Equipment Protection & Liability Policy", version: LEGAL_VERSION },
  { kind: "data-processing", title: "Data Processing Terms", version: LEGAL_VERSION },
] as const;

export type AgreementDoc = { kind: string; version: string };

export const REFUNDABLE_DEPOSIT_LEGAL_VERSION = "2026-10-v14";
export const ASSESSMENT_DEPOSIT_LEGAL_VERSION = "2026-11-v17";
export const CANCELLATION_PROTECTION_LEGAL_VERSION = "2026-11-v18";
export const CARD_HOLD_LEGAL_VERSION = "2026-11-v19";
export const SETUP_INTENT_LEGAL_VERSION = "2026-11-v20";
export function agreementsForSecurityPolicy(policy?: string | null, cancellationProtection=false) {
  if (!hasCashDepositPolicy(policy) && !isCardHoldSecurityPolicy(policy) && !isSetupIntentSecurityPolicy(policy)) return AGREEMENTS;
  const version=isSetupIntentSecurityPolicy(policy)?SETUP_INTENT_LEGAL_VERSION:isCardHoldSecurityPolicy(policy)?CARD_HOLD_LEGAL_VERSION:policy===ASSESSMENT_SECURITY_POLICY_VERSION?(cancellationProtection?CANCELLATION_PROTECTION_LEGAL_VERSION:ASSESSMENT_DEPOSIT_LEGAL_VERSION):REFUNDABLE_DEPOSIT_LEGAL_VERSION;
  return AGREEMENTS.map(doc => ({...doc,version:doc.version===LEGAL_VERSION||isSetupIntentSecurityPolicy(policy)&&doc.kind==="referrals"?version:doc.version,title:doc.kind==="deposit-agreement"?isSetupIntentSecurityPolicy(policy)?"Saved Card & Future Security Payments Agreement":isCardHoldSecurityPolicy(policy)?"Card Authorisation Hold & Return Agreement":policy===ASSESSMENT_SECURITY_POLICY_VERSION?"Refundable Deposit & Future Card Payments":"Refundable Deposit & Saved-Card Payment Agreement":doc.title}));
}
