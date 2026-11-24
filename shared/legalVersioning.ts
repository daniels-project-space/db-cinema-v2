import {
  LEGAL_VERSION,
  REFUNDABLE_DEPOSIT_LEGAL_VERSION,
  ASSESSMENT_DEPOSIT_LEGAL_VERSION,
  CANCELLATION_PROTECTION_LEGAL_VERSION,
  CARD_HOLD_LEGAL_VERSION,
  IMMEDIATE_CLAIM_LEGAL_VERSION,
} from "../src/lib/legal";
import { CURRENT_PRIVACY_NOTICE_VERSION } from "./privacyNoticeVersion";

export type LegalPolicyFlags = {
  setupIntentSecurityEnabled?: boolean;
  cardHoldSecurityEnabled?: boolean;
  assessmentSecurityEnabled?: boolean;
  cancellationProtectionEnabled?: boolean;
  refundableDepositEnabled?: boolean;
};

/** Keep the version shown by /legal/terms identical to the server-side
 * account-creation acknowledgement. */
export function legalVersionForPolicy(flags: LegalPolicyFlags) {
  return flags.setupIntentSecurityEnabled
    ? IMMEDIATE_CLAIM_LEGAL_VERSION
    : flags.cardHoldSecurityEnabled
      ? CARD_HOLD_LEGAL_VERSION
      : flags.assessmentSecurityEnabled
        ? flags.cancellationProtectionEnabled
          ? CANCELLATION_PROTECTION_LEGAL_VERSION
          : ASSESSMENT_DEPOSIT_LEGAL_VERSION
        : flags.refundableDepositEnabled
          ? REFUNDABLE_DEPOSIT_LEGAL_VERSION
          : LEGAL_VERSION;
}

export function guestMembershipAccountConsentMatchesRentalAgreement(
  selection: {
    accountTermsPrivacyAcknowledged?: boolean;
    accountTermsVersion?: string;
    privacyNoticeVersion?: string;
  } | undefined,
  documents: readonly { kind: string; version: string }[] | undefined,
  flags: LegalPolicyFlags,
) {
  const termsVersion = legalVersionForPolicy(flags);
  const acceptedTerms = documents?.filter(document => document.kind === "terms") ?? [];
  const acceptedPrivacy = documents?.filter(document => document.kind === "privacy") ?? [];
  return selection?.accountTermsPrivacyAcknowledged === true &&
    selection.accountTermsVersion === termsVersion &&
    selection.privacyNoticeVersion === CURRENT_PRIVACY_NOTICE_VERSION &&
    acceptedTerms.length === 1 && acceptedTerms[0].version === termsVersion &&
    acceptedPrivacy.length === 1 && acceptedPrivacy[0].version === CURRENT_PRIVACY_NOTICE_VERSION;
}

// Bump whenever the current privacy notice changes. Keeping this in a small
// module lets server code record the exact notice without bundling the archive.
export { CURRENT_PRIVACY_NOTICE_VERSION } from "./privacyNoticeVersion";
