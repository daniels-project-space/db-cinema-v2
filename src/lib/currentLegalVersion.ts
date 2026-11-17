import {ConvexHttpClient} from "convex/browser";
import {api} from "@cvx/_generated/api";
import { legalVersionForPolicy, type LegalPolicyFlags } from "../../shared/legalVersioning";
export { legalVersionForPolicy } from "../../shared/legalVersioning";

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
