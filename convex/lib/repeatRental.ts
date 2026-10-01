import { exactKitKey } from "../../shared/membership";
import { reviewSettlementFingerprint } from "./reviewEligibility";
export function safeRepeatRental(b:any,account:any,kit:{listingId:string;qty:number}[]) {
 return !!account && b?.guestEmail===account.email && b?.status==="returned" && !!b.actualReturnedAt &&
   (!(b.depositAmount>0)||b.depositRefunded===true) &&
   (!(b.lateFeeAmount>0)||["paid","waived","none"].includes(b.lateFeeStatus)) && exactKitKey(b.lineItems)===exactKitKey(kit);
}
export function repeatRentalFingerprint(b:any){return JSON.stringify([reviewSettlementFingerprint(b),exactKitKey(b.lineItems)]);}
