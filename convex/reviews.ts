import { query, mutation } from "./_generated/server";
import { v } from "convex/values";
import { accountForToken, ownedBooking } from "./lib/rentalChat";
import { customerReviewGate, reviewSettlementFingerprint } from "./lib/reviewEligibility";
import { reviewContext } from "./lib/reviewContext";
import { assertAdmin } from "./adminAuth";

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
    return Promise.all(withText.slice(0, Math.min(50, Math.max(1, limit ?? 30))).map(async (r) => {
      const account = r.authorAccountId ? await ctx.db.get(r.authorAccountId) : null;
      const photo = account?.avatarStorageId ? await ctx.storage.getUrl(account.avatarStorageId) : null;
      return ({
      _id: r._id,
      author: r.author,
      authorImage: photo ?? account?.googleAvatarUrl ?? r.authorImage ?? null,
      rating: r.rating,
      text: r.text,
      product: r.product ?? null,
    }); }));
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
  args: { token: v.string() },
  handler: async (ctx, { token }) => {
    await assertAdmin(ctx, token, "reviews.clearHygglo");
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
    token: v.string(),
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
  handler: async (ctx, { token, items }) => {
    await assertAdmin(ctx, token, "reviews.insertChunk");
    for (const it of items) {
      if (!Number.isInteger(it.rating) || it.rating < 1 || it.rating > 5) throw Error("Rating must be 1–5.");
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
    const acct = await accountForToken(ctx, token);
    if (!acct) throw new Error("Please sign in to review.");
    const b = await ownedBooking(ctx, acct, bookingId);
    if (!Number.isInteger(rating) || rating < 1 || rating > 5) throw new Error("Rating must be 1-5.");
    if (text.trim().length < 10 || text.trim().length > 2000) throw Error("Write a review between 10 and 2,000 characters.");
    if (customerReviewGate(b) || b.reviewEligibilityFingerprint !== reviewSettlementFingerprint(await reviewContext(ctx, b)))
      throw Error("A review is available after the rental is returned and its refundable security is fully settled.");
    const dupe = await ctx.db.query("reviews").withIndex("by_booking", q => q.eq("verifiedBookingId", bookingId)).first();
    if (dupe) throw new Error("You've already reviewed this booking.");
    await ctx.db.insert("reviews", {
      source: "native",
      author: acct.name ?? acct.email.split("@")[0],
      authorAccountId: acct._id,
      authorImage: (acct.avatarStorageId ? await ctx.storage.getUrl(acct.avatarStorageId) : null) ?? acct.googleAvatarUrl ?? undefined,
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
