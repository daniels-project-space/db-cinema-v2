import {ConvexHttpClient} from "convex/browser";
import {api} from "@cvx/_generated/api";
import {LEGAL_VERSION,REFUNDABLE_DEPOSIT_LEGAL_VERSION} from "./legal";

/** Public wording follows the source checkout gate; accepted versions stay archived. */
export async function currentLegalVersion(){
 const url=process.env.NEXT_PUBLIC_CONVEX_URL;if(!url)return LEGAL_VERSION;
 try{const settings=await new ConvexHttpClient(url).query(api.settings.get,{});return settings.refundableDepositEnabled?REFUNDABLE_DEPOSIT_LEGAL_VERSION:LEGAL_VERSION}catch{return LEGAL_VERSION}
}
