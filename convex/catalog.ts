import { query } from "./_generated/server";
import { v } from "convex/values";

/** Public catalog reads for the storefront. */

const PUBLIC_FIELDS = (l: any) => ({
  _id: l._id,
  slug: l.slug,
  title: l.title,
  category: l.category,
  heroImage: l.heroImageR2Key ?? null,
  pricing: l.pricing,
  depositAmount: l.depositAmount,
  minimumRentalDays: l.minimumRentalDays ?? 1,
});

export const listListings = query({
  args: {
    category: v.optional(v.string()),
    search: v.optional(v.string()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, { category, search, limit }) => {
    let rows;
    if (category && category !== "All") {
      rows = await ctx.db
        .query("listings")
        .withIndex("by_category", (q) => q.eq("category", category))
        .collect();
      rows = rows.filter((r) => r.active);
    } else {
      rows = await ctx.db
        .query("listings")
        .withIndex("by_active", (q) => q.eq("active", true))
        .collect();
    }
    if (search) {
      const s = search.toLowerCase();
      rows = rows.filter((r) => r.title.toLowerCase().includes(s));
    }
    rows.sort((a, b) => a.title.localeCompare(b.title));
    return rows.slice(0, limit ?? 120).map(PUBLIC_FIELDS);
  },
});

export const getListingBySlug = query({
  args: { slug: v.string() },
  handler: async (ctx, { slug }) => {
    const l = await ctx.db
      .query("listings")
      .withIndex("by_slug", (q) => q.eq("slug", slug))
      .first();
    if (!l || !l.active) return null;
    return {
      _id: l._id,
      slug: l.slug,
      title: l.title,
      category: l.category,
      heroImage: l.heroImageR2Key ?? null,
      gallery: l.gallery ?? [],
      pricing: l.pricing,
      depositAmount: l.depositAmount,
      minimumRentalDays: l.minimumRentalDays ?? 1,
      unavailableDates: l.unavailableDates ?? [],
    };
  },
});

export const categories = query({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db
      .query("listings")
      .withIndex("by_active", (q) => q.eq("active", true))
      .collect();
    const counts = new Map<string, number>();
    for (const r of rows) counts.set(r.category, (counts.get(r.category) ?? 0) + 1);
    return Array.from(counts.entries())
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count);
  },
});

export const featured = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, { limit }) => {
    const rows = await ctx.db
      .query("listings")
      .withIndex("by_active", (q) => q.eq("active", true))
      .take(200);
    // prefer ones with images, highest daily price (hero gear)
    const withImg = rows.filter((r) => r.heroImageR2Key);
    withImg.sort((a, b) => (b.pricing?.daily ?? 0) - (a.pricing?.daily ?? 0));
    return withImg.slice(0, limit ?? 12).map(PUBLIC_FIELDS);
  },
});
