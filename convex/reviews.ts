import { query, mutation } from "./_generated/server";
import { v } from "convex/values";

export const listPublished = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, { limit }) => {
    const rows = await ctx.db
      .query("reviews")
      .withIndex("by_published", (q) => q.eq("published", true))
      .collect();
    rows.sort((a, b) => b.date - a.date);
    return rows.slice(0, limit ?? 24).map((r) => ({
      _id: r._id,
      author: r.author,
      authorImage: r.authorImage ?? null,
      rating: r.rating,
      text: r.text,
      product: r.product ?? null,
      source: r.source,
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
    if (rows.length === 0) return { count: 0, average: 0 };
    const sum = rows.reduce((n, r) => n + r.rating, 0);
    return {
      count: rows.length,
      average: Math.round((sum / rows.length) * 100) / 100,
    };
  },
});

/** Seed/replace Hygglo-sourced reviews (attributed social proof). */
export const seedHygglo = mutation({
  args: {
    items: v.array(
      v.object({
        author: v.string(),
        authorImage: v.optional(v.string()),
        rating: v.number(),
        text: v.string(),
        product: v.optional(v.string()),
        date: v.optional(v.number()),
      }),
    ),
  },
  handler: async (ctx, { items }) => {
    const existing = await ctx.db
      .query("reviews")
      .withIndex("by_published", (q) => q.eq("published", true))
      .collect();
    for (const r of existing) if (r.source === "hygglo") await ctx.db.delete(r._id);

    let i = 0;
    for (const it of items) {
      await ctx.db.insert("reviews", {
        source: "hygglo",
        author: it.author,
        authorImage: it.authorImage,
        rating: it.rating,
        text: it.text,
        product: it.product,
        date: it.date ?? Date.now() - i * 86400000,
        published: true,
      });
      i++;
    }
    return { inserted: items.length };
  },
});
