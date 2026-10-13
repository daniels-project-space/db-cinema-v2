import {ASSESSMENT_SECURITY_POLICY_VERSION,depositForBookingPolicy} from "../../shared/rentalSecurity";
/** Conservative substitution: same category/type/mount and no increase in security exposure. */
export function replacementCompatible(original: any, candidate: any, booking?:any): boolean {
  const sourceFamily=/v[ -]?mount/i.test(original.title)&&!/camera|bmpcc|blackmagic/i.test(original.title)?"vmount":/np[ -]?f/i.test(original.title)?"npf":null;
  const candidateFamily=/v[ -]?mount/i.test(candidate?.title??"")?"vmount":/np[ -]?f/i.test(candidate?.title??"")?"npf":null;
  return (
    (!sourceFamily || sourceFamily===candidateFamily) &&
    !!candidate &&
    original._id !== candidate._id &&
    candidate.active === true &&
    !candidate.suppressed &&
    !candidate.marketingOnly &&
    candidate.stockMappingStatus === "complete" &&
    candidate.components?.length > 0 &&
    candidate.category === original.category &&
    !!original.itemType &&
    candidate.itemType === original.itemType &&
    (!original.specs?.mount ||
      candidate.specs?.mount === original.specs.mount) &&
    Number.isFinite(original.depositAmount) &&
    Number.isFinite(candidate.depositAmount) &&
    candidate.depositAmount >= 0 &&
    (candidate.depositAmount <= original.depositAmount || booking?.securityPolicyVersion===ASSESSMENT_SECURITY_POLICY_VERSION && depositForBookingPolicy(booking,booking.lineItems.reduce((sum:number,line:any)=>sum+(line.listingId===original._id?candidate.depositAmount:(booking.replacementValues?.find((v:any)=>v.listingId===line.listingId)?.unitPence??0)/100)*line.qty,0))<=booking.depositAmount)
  );
}
export function assertReplacementSnapshot(saved: any, next: any) {
  for (const key of [
    "lineIndex",
    "oldListingId",
    "newListingId",
    "qty",
    "start",
    "end",
  ]) {
    if (saved[key] !== next[key])
      throw Error(
        "The kit or replacement request changed. Refresh and choose the item again.",
      );
  }
}
