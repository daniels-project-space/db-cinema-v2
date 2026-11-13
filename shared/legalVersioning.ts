import {
  LEGAL_VERSION,
  REFUNDABLE_DEPOSIT_LEGAL_VERSION,
  ASSESSMENT_DEPOSIT_LEGAL_VERSION,
  CANCELLATION_PROTECTION_LEGAL_VERSION,
  CARD_HOLD_LEGAL_VERSION,
  IMMEDIATE_CLAIM_LEGAL_VERSION,
} from "../src/lib/legal";

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

// Bump whenever the current privacy notice changes. Keeping this in a small
// module lets server code record the exact notice without bundling the archive.
export { CURRENT_PRIVACY_NOTICE_VERSION } from "./privacyNoticeVersion";
