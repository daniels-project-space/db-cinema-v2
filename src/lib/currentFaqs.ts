import { currentLegalVersion, legalVersionForPolicy } from "./currentLegalVersion";
import { FAQS } from "./guides";
import { faqsForSecurityPolicy } from "../../shared/gafferPublicKnowledge";
import {
  ASSESSMENT_DEPOSIT_LEGAL_VERSION,
  CARD_HOLD_LEGAL_VERSION,
  CANCELLATION_PROTECTION_LEGAL_VERSION,
  REFUNDABLE_DEPOSIT_LEGAL_VERSION,
  SETUP_INTENT_LEGAL_VERSION,
  PREVIOUS_SETUP_INTENT_LEGAL_VERSION,
  IMMEDIATE_CLAIM_LEGAL_VERSION,
  IMMEDIATE_CLAIM_LEGAL_VERSIONS,
  COMPANY_CANCELLATION_GUARANTEE_LEGAL_VERSIONS,
  INCLUSIVE_SEVEN_DAY_CANCELLATION_LEGAL_VERSIONS,
} from "./legal";

export type CurrentFaq = (typeof FAQS)[number];

export function faqsForLegalVersion(version: string): CurrentFaq[] {
  return faqsForSecurityPolicy({
    setupIntentSecurityEnabled: [PREVIOUS_SETUP_INTENT_LEGAL_VERSION, SETUP_INTENT_LEGAL_VERSION, ...IMMEDIATE_CLAIM_LEGAL_VERSIONS].includes(version),
    cancellationPolicyEnabled: [SETUP_INTENT_LEGAL_VERSION, ...IMMEDIATE_CLAIM_LEGAL_VERSIONS].includes(version),
    inclusiveSevenDayCancellationBoundary: (INCLUSIVE_SEVEN_DAY_CANCELLATION_LEGAL_VERSIONS as readonly string[]).includes(version),
    companyCancellationForAnyReasonEnabled: (COMPANY_CANCELLATION_GUARANTEE_LEGAL_VERSIONS as readonly string[]).includes(version),
    cardHoldSecurityEnabled: version === CARD_HOLD_LEGAL_VERSION,
    assessmentSecurityEnabled: [ASSESSMENT_DEPOSIT_LEGAL_VERSION, CANCELLATION_PROTECTION_LEGAL_VERSION, "2026-10-v15", "2026-10-v16"].includes(version),
    refundableDepositEnabled: version === REFUNDABLE_DEPOSIT_LEGAL_VERSION,
  });
}

export function faqsForPolicy(policy: Parameters<typeof legalVersionForPolicy>[0]): CurrentFaq[] {
  return faqsForLegalVersion(legalVersionForPolicy(policy));
}

export async function getCurrentFaqs(): Promise<CurrentFaq[]> {
  return faqsForLegalVersion(await currentLegalVersion());
}
