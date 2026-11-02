import { encoreGate } from "./loyalty";
import { reviewContext } from "./reviewContext";
import { reviewSettlementFingerprint } from "./reviewEligibility";
import { qualifyingRentalCount } from "../../shared/loyalty";

export async function encoreGuestClaimEligible(ctx:any,booking:any,account:any){
 if(!booking||!account||account.blockedAt!=null||booking.accountId!==account._id||booking.accountAccessRequired===false||booking.encoreOwnershipVerifiedAt||
   !booking.guestEmail?.trim()||booking.guestEmail.trim().toLowerCase()!==account.email?.trim().toLowerCase()||encoreGate(booking)||qualifyingRentalCount([booking])!==1)return false;
 if(await ctx.db.query("rental_damage_cases").withIndex("by_booking",(query:any)=>query.eq("bookingId",booking._id)).first())return false;
 return !!booking.reviewEligibilityFingerprint&&booking.reviewEligibilityFingerprint===reviewSettlementFingerprint(await reviewContext(ctx,booking));
}
