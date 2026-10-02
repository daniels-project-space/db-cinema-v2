import { query } from "./_generated/server";
import { v } from "convex/values";

/** Retired gear discounts. Keep the endpoint for cached clients and Gaffer. */
export const forCart = query({
  args: {
    items: v.array(v.object({
      listingId: v.id("listings"),
      start: v.number(),
      end: v.number(),
      total: v.number(),
    })),
  },
  handler: async () => [],
});
