/** Conservative substitution: same category/type/mount and no increase in security exposure. */
export function replacementCompatible(original: any, candidate: any): boolean {
  return (
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
    candidate.depositAmount <= original.depositAmount
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
