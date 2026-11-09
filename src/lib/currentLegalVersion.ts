import {ConvexHttpClient} from "convex/browser";
import {api} from "@cvx/_generated/api";
import {LEGAL_VERSION,REFUNDABLE_DEPOSIT_LEGAL_VERSION,ASSESSMENT_DEPOSIT_LEGAL_VERSION,CANCELLATION_PROTECTION_LEGAL_VERSION,CARD_HOLD_LEGAL_VERSION,IMMEDIATE_CLAIM_LEGAL_VERSION} from "./legal";

type LegalPolicyFlags = {
 setupIntentSecurityEnabled?: boolean;
 cardHoldSecurityEnabled?: boolean;
 assessmentSecurityEnabled?: boolean;
 cancellationProtectionEnabled?: boolean;
 refundableDepositEnabled?: boolean;
};

export function legalVersionForPolicy(flags: LegalPolicyFlags) {
 return flags.setupIntentSecurityEnabled?IMMEDIATE_CLAIM_LEGAL_VERSION:flags.cardHoldSecurityEnabled?CARD_HOLD_LEGAL_VERSION:flags.assessmentSecurityEnabled?(flags.cancellationProtectionEnabled?CANCELLATION_PROTECTION_LEGAL_VERSION:ASSESSMENT_DEPOSIT_LEGAL_VERSION):flags.refundableDepositEnabled?REFUNDABLE_DEPOSIT_LEGAL_VERSION:LEGAL_VERSION;
}

function configuredPolicyFlags(): LegalPolicyFlags {
 const assessmentSecurityEnabled=process.env.ASSESSMENT_SECURITY_POLICY_ENABLED==="true";
 return {
  setupIntentSecurityEnabled:process.env.SETUP_INTENT_SECURITY_POLICY_ENABLED==="true",
  cardHoldSecurityEnabled:process.env.CARD_HOLD_SECURITY_POLICY_ENABLED==="true",
  assessmentSecurityEnabled,
  cancellationProtectionEnabled:process.env.CANCELLATION_PROTECTION_POLICY_ENABLED==="true"&&assessmentSecurityEnabled,
  refundableDepositEnabled:assessmentSecurityEnabled||process.env.REFUNDABLE_DEPOSIT_POLICY_ENABLED==="true",
 };
}

/** Public wording follows the source checkout gate; accepted versions stay archived. */
export async function currentLegalVersion(){
 const fallback=legalVersionForPolicy(configuredPolicyFlags());
 const url=process.env.NEXT_PUBLIC_CONVEX_URL;if(!url)return fallback;
 try{return legalVersionForPolicy(await new ConvexHttpClient(url).query(api.settings.get,{}))}catch{return fallback}
}
