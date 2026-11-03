import { internal } from "../_generated/api";
import { encoreAccountOwnsRental, encoreGate } from "./encoreEligibility";
import { reviewContext } from "./reviewContext";
import { reviewSettlementFingerprint } from "./reviewEligibility";
import { qualifyingRentalCount } from "../../shared/loyalty";

export async function validEncoreEvidence(ctx:any,account:any,evidence:any){
 if(!account||!evidence||evidence.accountId!==account._id)return false;
 const booking=await ctx.db.get(evidence.bookingId);
 if(!encoreAccountOwnsRental(booking,account)||encoreGate(booking)||qualifyingRentalCount([booking])!==1)return false;
 if((booking.stripeCheckoutSessionId??booking.stripePaymentIntentId??String(booking._id))!==evidence.checkoutKey)return false;
 if(await ctx.db.query("rental_damage_cases").withIndex("by_booking",(query:any)=>query.eq("bookingId",booking._id)).first())return false;
 return booking.reviewEligibilityFingerprint===evidence.fingerprint&&evidence.fingerprint===reviewSettlementFingerprint(await reviewContext(ctx,booking));
}
export async function queueEncoreRollup(ctx:any,accountId:any){
 const existing=await ctx.db.query("encore_account_rollups").withIndex("by_account",(query:any)=>query.eq("accountId",accountId)).unique();
 const now=Date.now(),generation=(existing?.generation??0)+1;
 const patch={generation,state:"running",cursor:undefined,candidates:[],updatedAt:now,dueAt:now+5*60000};
 if(existing)await ctx.db.patch(existing._id,patch);else await ctx.db.insert("encore_account_rollups",{accountId,...patch});
 await ctx.scheduler.runAfter(0,internal.encoreRollups.page,{accountId,generation});
}
