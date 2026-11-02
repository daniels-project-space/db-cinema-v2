import { customerReviewGate } from "./reviewEligibility";

export function encoreGate(booking:any):string|null {
 const blocked=customerReviewGate(booking);if(blocked)return blocked;
 if(booking.cancellationDecision)return "cancelled";
 const inspection=booking.returnDecision?.inspection ?? booking.returnStatement?.inspection;
 if(!booking.actualReturnedAt || !inspection?.length)return "inspection_unrecorded";
 if(new Set(inspection.map((item:any)=>item.key)).size!==inspection.length)return "inspection_invalid";
 if(inspection.some((item:any)=>item.condition!=="good" || item.openCase || item.details?.trim()))return "return_issue";
 if((booking.lateFeeAmount??0)>0)return "late_return";
 return null;
}
export function encoreAccountOwnsRental(booking:any,account:any){
 return !!account && account.blockedAt==null && (!account.emailVerificationRequired || !!account.emailVerifiedAt) &&
  booking?.accountId===account._id && (booking.accountAccessRequired===false || !!booking.encoreOwnershipVerifiedAt);
}
