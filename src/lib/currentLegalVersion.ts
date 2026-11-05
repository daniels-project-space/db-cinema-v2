import {ConvexHttpClient} from "convex/browser";
import {api} from "@cvx/_generated/api";
import {LEGAL_VERSION,REFUNDABLE_DEPOSIT_LEGAL_VERSION,ASSESSMENT_DEPOSIT_LEGAL_VERSION,CANCELLATION_PROTECTION_LEGAL_VERSION,CARD_HOLD_LEGAL_VERSION,SETUP_INTENT_LEGAL_VERSION} from "./legal";

/** Public wording follows the source checkout gate; accepted versions stay archived. */
export async function currentLegalVersion(){
 const setupIntentEnabled=process.env.SETUP_INTENT_SECURITY_POLICY_ENABLED==="true";
 const url=process.env.NEXT_PUBLIC_CONVEX_URL;if(!url)return setupIntentEnabled?SETUP_INTENT_LEGAL_VERSION:LEGAL_VERSION;
 try{const settings=await new ConvexHttpClient(url).query(api.settings.get,{});return settings.setupIntentSecurityEnabled?SETUP_INTENT_LEGAL_VERSION:settings.cardHoldSecurityEnabled?CARD_HOLD_LEGAL_VERSION:settings.assessmentSecurityEnabled?(settings.cancellationProtectionEnabled?CANCELLATION_PROTECTION_LEGAL_VERSION:ASSESSMENT_DEPOSIT_LEGAL_VERSION):settings.refundableDepositEnabled?REFUNDABLE_DEPOSIT_LEGAL_VERSION:LEGAL_VERSION}catch{return setupIntentEnabled?SETUP_INTENT_LEGAL_VERSION:LEGAL_VERSION}
}
