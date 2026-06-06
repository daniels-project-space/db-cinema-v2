import { query, mutation } from "./_generated/server";
import { v } from "convex/values";

export const listPublished = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, { limit }) => {
    const rows = await ctx.db
      .query("reviews")
      .withIndex("by_published", (q) => q.eq("published", true))
      .collect();
    // carousel shows only reviews that actually have text
    const withText = rows.filter((r) => r.text && r.text.trim().length > 8);
    withText.sort((a, b) => b.date - a.date);
    return withText.slice(0, limit ?? 30).map((r) => ({
      _id: r._id,
      author: r.author,
      authorImage: r.authorImage ?? null,
      rating: r.rating,
      text: r.text,
      product: r.product ?? null,
    }));
  },
});

export const stats = query({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db
      .query("reviews")
      .withIndex("by_published", (q) => q.eq("published", true))
      .collect();
    if (rows.length === 0) return { count: 0, average: 0, withText: 0 };
    const sum = rows.reduce((n, r) => n + r.rating, 0);
    return {
      count: rows.length,
      average: Math.round((sum / rows.length) * 100) / 100,
      withText: rows.filter((r) => r.text && r.text.trim().length > 8).length,
    };
  },
});

export const clearHygglo = mutation({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db.query("reviews").collect();
    let n = 0;
    for (const r of rows)
      if (r.source === "hygglo") {
        await ctx.db.delete(r._id);
        n++;
      }
    return { deleted: n };
  },
});

export const insertChunk = mutation({
  args: {
    items: v.array(
      v.object({
        hyggloReviewId: v.optional(v.number()),
        author: v.string(),
        authorImage: v.optional(v.string()),
        rating: v.number(),
        text: v.optional(v.string()),
        product: v.optional(v.string()),
        listingSlug: v.optional(v.string()),
        date: v.number(),
      }),
    ),
  },
  handler: async (ctx, { items }) => {
    for (const it of items) {
      await ctx.db.insert("reviews", {
        source: "hygglo",
        hyggloReviewId: it.hyggloReviewId,
        author: it.author,
        authorImage: it.authorImage,
        rating: it.rating,
        text: it.text,
        product: it.product,
        listingSlug: it.listingSlug,
        date: it.date,
        published: true,
      });
    }
    return { inserted: items.length };
  },
});
