import { documentedIncludedTypes } from "../../shared/recommendationPolicy";

/** The active camera catalogue is a bounded inventory (405 total offers at
 * rollout). This indexed read runs once per recommendation request, not once
 * per candidate or stock slot. Only owner-confirmed, fully mapped kits prove
 * a mechanical pairing; delivery weight estimates do not prove payload fit.
 */
export async function verifiedKitEvidence(ctx: any) {
  const cameras = await ctx.db.query("listings")
    .withIndex("by_active_itemType", (q: any) => q.eq("active", true).eq("itemType", "camera-body"))
    .collect();
  return cameras.filter((item: any) => item.stockMappingStatus === "complete" &&
    item.inventoryFacts?.owned === true && item.inventoryFacts?.reviewRequired === false &&
    item.components?.length > 1 && documentedIncludedTypes(item).includes("gimbal"))
    .map((item: any) => ({ components: item.components }));
}
