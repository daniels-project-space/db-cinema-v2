import {
  displayListingCopy,
  isVerifiedGimbalOwner,
  mayHaveGimbalComponents,
} from "../../shared/verifiedRentalCopy";

/**
 * Public copy is derived from the current catalog row and any exact,
 * owner-confirmed gimbal component it shares. The indexed lookup is bounded;
 * ambiguous or oversized evidence fails closed and leaves seller copy intact
 * apart from removal of internal operational notes.
 */
export function createPublicListingCopy(ctx: any) {
  let evidencePromise: Promise<any[]> | null = null;

  return async (listings: any[]) => {
    const rows = listings.filter(Boolean);
    if (!rows.some(mayHaveGimbalComponents)) return rows.map((row) => displayListingCopy(row));

    evidencePromise ??= ctx.db
      .query("listings")
      .withIndex("by_active_itemType", (q: any) =>
        q.eq("active", true).eq("itemType", "gimbal"),
      )
      .take(65)
      .then((matches: any[]) =>
        matches.length > 64 ? [] : matches.filter(isVerifiedGimbalOwner),
      );

    const evidence = await evidencePromise;
    return rows.map((row) => displayListingCopy(row, evidence ?? undefined));
  };
}
