import { internalQuery } from "./_generated/server";
import { v } from "convex/values";
import { rentalUnavailable } from "./lib/marketingInventory";
import { rentableCandidate } from "../shared/recommendationPolicy";

export const lookup = internalQuery({
  args: { category: v.optional(v.string()), search: v.optional(v.string()) },
  handler: async (ctx, { category, search }) => {
    if (!category && !search) return { listings: [], availability: "unchecked" as const };
    const candidates = search
      ? await ctx.db.query("listings").withSearchIndex("search_title", q => q.search("title", search).eq("active", true)).take(40)
      : await ctx.db.query("listings").withIndex("by_category_active_demand", q => q.eq("category", category!).eq("active", true)).order("desc").take(40);
    const listings = candidates.filter(item => (!category || item.category === category) && !rentalUnavailable(item) && rentableCandidate(item) && Array.isArray(item.components) && item.components.length > 0 && item.components.every(component => !!component.inventoryUnitId && Number.isSafeInteger(component.qty) && component.qty > 0))
      .slice(0, 4).map(item => ({
        listingId: item._id,
        title: item.title,
        slug: item.slug,
        category: item.category,
        daily: typeof item.pricing?.daily === "number" && Number.isFinite(item.pricing.daily) && item.pricing.daily > 0 ? item.pricing.daily : null,
        pricing: item.pricing,
      }));
    return { listings, availability: "unchecked" as const };
  },
});
