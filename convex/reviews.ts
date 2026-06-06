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

/** A logged-in customer leaves a verified review for one of their bookings. */
export const submitNative = mutation({
  args: { token: v.string(), bookingId: v.id("bookings"), rating: v.number(), text: v.string() },
  handler: async (ctx, { token, bookingId, rating, text }) => {
    const s = await ctx.db
      .query("sessions")
      .withIndex("by_token", (q) => q.eq("token", token))
      .first();
    const acct: any = s ? await ctx.db.get(s.accountId) : null;
    if (!acct) throw new Error("Please sign in to review.");
    const b = await ctx.db.get(bookingId);
    if (!b || b.guestEmail !== acct.email) throw new Error("Not your booking.");
    if (rating < 1 || rating > 5) throw new Error("Rating must be 1-5.");
    const dupe = (await ctx.db.query("reviews").collect()).some(
      (r) => r.verifiedBookingId === bookingId,
    );
    if (dupe) throw new Error("You've already reviewed this booking.");
    await ctx.db.insert("reviews", {
      source: "native",
      author: acct.name ?? acct.email.split("@")[0],
      rating,
      text: text.trim(),
      product: b.lineItems[0]?.title,
      listingId: b.lineItems[0]?.listingId,
      verifiedBookingId: bookingId,
      date: Date.now(),
      published: true,
    });
    return { ok: true };
  },
});
