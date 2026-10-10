import { v } from "convex/values";

export const kitRequestInput = v.object({
  change: v.union(v.literal("add"), v.literal("swap"), v.literal("remove")),
  listingId: v.optional(v.id("listings")), lineIndex: v.optional(v.number()),
  source: v.optional(v.object({ listingId: v.id("listings"), qty: v.number(), start: v.number(), end: v.number() })),
  quantity: v.number(), note: v.string(),
});
export const kitRequestSnapshot = v.object({
  change: v.union(v.literal("add"), v.literal("swap"), v.literal("remove")),
  listingId: v.optional(v.id("listings")), lineIndex: v.optional(v.number()),
  source: v.optional(v.object({ listingId: v.id("listings"), qty: v.number(), start: v.number(), end: v.number() })),
  quantity: v.number(), note: v.string(),
  additionTitle: v.optional(v.string()), sourceTitle: v.optional(v.string()),
  sourceListingId: v.optional(v.id("listings")), sourceQty: v.optional(v.number()),
  sourceStart: v.optional(v.number()), sourceEnd: v.optional(v.number()),
});
