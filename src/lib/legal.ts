import { ASSESSMENT_SECURITY_POLICY_VERSION, hasCashDepositPolicy, isCardHoldSecurityPolicy, isSetupIntentSecurityPolicy, isImmediateClaimSecurityPolicy } from "../../shared/rentalSecurity";
import { CURRENT_PRIVACY_NOTICE_VERSION } from "../../shared/privacyNoticeVersion";

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
  { kind: "privacy", title: "Privacy Notice", version: CURRENT_PRIVACY_NOTICE_VERSION },
] as const;

export type AgreementDoc = { kind: string; version: string };

export const REFUNDABLE_DEPOSIT_LEGAL_VERSION = "2026-10-v14";
export const ASSESSMENT_DEPOSIT_LEGAL_VERSION = "2026-11-v17";
export const CANCELLATION_PROTECTION_LEGAL_VERSION = "2026-11-v18";
export const CARD_HOLD_LEGAL_VERSION = "2026-11-v19";
export const PREVIOUS_SETUP_INTENT_LEGAL_VERSION = "2026-11-v20";
export const SETUP_INTENT_LEGAL_VERSION = "2026-11-v21";
export const SETUP_INTENT_LEGAL_VERSIONS = [PREVIOUS_SETUP_INTENT_LEGAL_VERSION, SETUP_INTENT_LEGAL_VERSION];
export const PREVIOUS_IMMEDIATE_CLAIM_LEGAL_VERSION = "2026-11-v22";
export const PREVIOUS_INCLUSIVE_SEVEN_DAY_CANCELLATION_LEGAL_VERSION = "2026-11-v23";
export const PREVIOUS_COMPANY_CANCELLATION_LEGAL_VERSION = "2026-11-v24";
export const IMMEDIATE_CLAIM_LEGAL_VERSION = "2026-11-v25";
export const IMMEDIATE_CLAIM_LEGAL_VERSIONS = [PREVIOUS_IMMEDIATE_CLAIM_LEGAL_VERSION, PREVIOUS_INCLUSIVE_SEVEN_DAY_CANCELLATION_LEGAL_VERSION, PREVIOUS_COMPANY_CANCELLATION_LEGAL_VERSION, IMMEDIATE_CLAIM_LEGAL_VERSION] as const;
export const COMPANY_CANCELLATION_GUARANTEE_LEGAL_VERSIONS = [PREVIOUS_COMPANY_CANCELLATION_LEGAL_VERSION, IMMEDIATE_CLAIM_LEGAL_VERSION] as const;
export const INCLUSIVE_SEVEN_DAY_CANCELLATION_LEGAL_VERSION = IMMEDIATE_CLAIM_LEGAL_VERSION;
export const INCLUSIVE_SEVEN_DAY_CANCELLATION_LEGAL_VERSIONS = [PREVIOUS_INCLUSIVE_SEVEN_DAY_CANCELLATION_LEGAL_VERSION, INCLUSIVE_SEVEN_DAY_CANCELLATION_LEGAL_VERSION] as const;
export function agreementsForSecurityPolicy(policy?: string | null, cancellationProtection=false) {
  if (!hasCashDepositPolicy(policy) && !isCardHoldSecurityPolicy(policy) && !isSetupIntentSecurityPolicy(policy)) return AGREEMENTS;
  const setupIntentPolicy=isSetupIntentSecurityPolicy(policy),immediateClaim=isImmediateClaimSecurityPolicy(policy);
  const version=immediateClaim?IMMEDIATE_CLAIM_LEGAL_VERSION:setupIntentPolicy?SETUP_INTENT_LEGAL_VERSION:isCardHoldSecurityPolicy(policy)?CARD_HOLD_LEGAL_VERSION:policy===ASSESSMENT_SECURITY_POLICY_VERSION?(cancellationProtection?CANCELLATION_PROTECTION_LEGAL_VERSION:ASSESSMENT_DEPOSIT_LEGAL_VERSION):REFUNDABLE_DEPOSIT_LEGAL_VERSION;
  return AGREEMENTS.map(doc => ({...doc,version:doc.version===LEGAL_VERSION||setupIntentPolicy&&doc.kind==="referrals"?version:doc.version,title:doc.kind==="deposit-agreement"?setupIntentPolicy?"Saved Card & Future Security Payments Agreement":isCardHoldSecurityPolicy(policy)?"Card Authorisation Hold & Return Agreement":policy===ASSESSMENT_SECURITY_POLICY_VERSION?"Refundable Deposit & Future Card Payments":"Refundable Deposit & Saved-Card Payment Agreement":doc.title}));
}
