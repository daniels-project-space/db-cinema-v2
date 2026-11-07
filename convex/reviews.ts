import { unlockLoyalty, encoreGate } from "./lib/loyalty";
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
    const withText = rows.filter((r) =>
      !!r.text && r.text.trim().length > 8 && (
        r.source === "native" || (
        r.source === "hygglo" &&
        r.sourceRatingVerified === true &&
        r.sourceRating === 5 &&
        r.rating === 5 &&
        r.sourcePhotoVerified === true &&
        r.authorImage?.startsWith("https://hygglo.imgix.net/")
        )
      ),
    );
    withText.sort((a, b) => b.date - a.date || b._creationTime - a._creationTime);
    const count = Math.min(50, Math.max(1, Math.floor(limit ?? 30)));
    // Reserve one card per desktop page for website reviews while both sources
    // have content. Fill unused places from either source; never filter ratings.
    const native = withText.filter(r => r.source === "native");
    const imported = withText.filter(r => r.source !== "native");
    const selected: typeof withText = [];
    let n = 0, h = 0;
    while (selected.length < count && (n < native.length || h < imported.length)) {
      const useNative = n < native.length && (selected.length % 3 === 0 || h >= imported.length);
      selected.push(useNative ? native[n++] : imported[h++]);
    }
    return Promise.all(selected.map(async (r) => {
      const account = r.authorAccountId ? await ctx.db.get(r.authorAccountId) : null;
      const photo = account?.avatarStorageId && account.avatarStorageId === account.avatarOwnedStorageId ? await ctx.storage.getUrl(account.avatarStorageId) : null;
      return ({
      _id: r._id,
      source: r.source,
      author: r.author,
      authorImage: photo ?? account?.googleAvatarUrl ?? (r.source === "native" ? null : r.authorImage ?? null),
      rating: r.rating,
      incentivized: r.incentivized ?? false,encoreReward:r.encoreReward??false,prizeEntry:r.prizeEntry??(!!r.incentivized&&!r.encoreReward),
      text: r.text,
      product: r.product ?? null,
    }); }));
  },
});

export const listVerifiedHyggloHighlights = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, { limit }) => {
    const count = Math.min(100, Math.max(1, Math.floor(limit ?? 100)));
    const candidates = await ctx.db
      .query("reviews")
      .withIndex("by_published_source_verified_date", (q) =>
        q.eq("published", true)
          .eq("source", "hygglo")
          .eq("sourceRating", 5)
          .eq("sourceRatingVerified", true)
          .eq("sourcePhotoVerified", true),
      )
      .order("desc")
      .take(200);
    return candidates
      .filter((review) =>
        review.sourceRatingVerified === true &&
        review.sourceRating === review.rating &&
        review.rating === 5 &&
        review.sourcePhotoVerified === true &&
        !!review.text && review.text.trim().length > 8 &&
        !!review.authorImage && review.authorImage.startsWith("https://hygglo.imgix.net/"),
      )
      .slice(0, count)
      .map((review) => ({
        _id: review._id,
        author: review.author,
        authorImage: review.authorImage!,
        rating: review.rating,
        text: review.text!,
        product: review.product ?? null,
      }));
  },
});

export const listNativePublished = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, { limit }) => {
    const count = Math.min(100, Math.max(1, Math.floor(limit ?? 18)));
    const rows = await ctx.db
      .query("reviews")
      .withIndex("by_published_source_date", (q) =>
        q.eq("published", true).eq("source", "native"),
      )
      .order("desc")
      .take(count);
    const withText = rows.filter((review) =>
      review.source === "native" &&
      !!review.text &&
      review.text.trim().length > 8 &&
      Number.isInteger(review.rating) &&
      review.rating >= 1 &&
      review.rating <= 5,
    );
    return Promise.all(withText.map(async (review) => {
      const account = review.authorAccountId ? await ctx.db.get(review.authorAccountId) : null;
      const photo = account?.avatarStorageId && account.avatarStorageId === account.avatarOwnedStorageId ? await ctx.storage.getUrl(account.avatarStorageId) : null;
      return {
        _id: review._id,
        source: review.source,
        author: review.author,
        authorImage: photo ?? account?.googleAvatarUrl ?? (review.source === "native" ? null : review.authorImage ?? null),
        rating: review.rating,
        incentivized: review.incentivized ?? false,
        encoreReward: review.encoreReward ?? false,
        prizeEntry: review.prizeEntry ?? (!!review.incentivized && !review.encoreReward),
        text: review.text,
        product: review.product ?? null,
      };
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
    const ordinary = rows.filter(r=>!r.incentivized && (r.source === "native" || (r.sourceRatingVerified === true && r.sourceRating === r.rating)));
    if (ordinary.length === 0) return { count: 0, average: 0, withText: 0 };
    const sum = ordinary.reduce((n, r) => n + r.rating, 0);
    return {
      count: ordinary.length,
      average: Math.round((sum / ordinary.length) * 100) / 100,
      withText: ordinary.filter((r) => r.text && r.text.trim().length > 8).length,
    };
  },
});

export const insertChunk = mutation({
  args: {
    token: v.string(),
    items: v.array(
      v.object({
        hyggloReviewId: v.number(),
        author: v.string(),
        authorImage: v.string(),
        rating: v.number(),
        sourceRating: v.number(),
        sourcePhotoVerified: v.boolean(),
        text: v.string(),
        product: v.optional(v.string()),
        listingSlug: v.optional(v.string()),
        date: v.number(),
      }),
    ),
  },
  handler: async (ctx, { token, items }) => {
    await assertAdmin(ctx, token, "reviews.insertChunk");
    const seenIds = new Set<number>();
    const verifiedAt = Date.now();
    let upserted = 0;
    for (const it of items) {
      if (!Number.isSafeInteger(it.hyggloReviewId) || it.hyggloReviewId <= 0 || seenIds.has(it.hyggloReviewId)) throw Error("Each source review ID must be unique and positive.");
      seenIds.add(it.hyggloReviewId);
      if (it.rating !== 5 || it.sourceRating !== it.rating) throw Error("A verified source rating must exactly match five stars.");
      if (!it.text.trim() || it.text.trim().length <= 8) throw Error("An eligible source review must contain text.");
      if (!it.sourcePhotoVerified || !it.authorImage.startsWith("https://hygglo.imgix.net/")) throw Error("An eligible source review must have a verified profile photo.");
      if (!Number.isFinite(it.date) || !it.author.trim()) throw Error("Source review details are invalid.");
      const review = {
        source: "hygglo" as const,
        hyggloReviewId: it.hyggloReviewId,
        author: it.author,
        authorImage: it.authorImage,
        rating: it.rating,
        sourceRating: it.sourceRating,
        text: it.text,
        product: it.product,
        listingSlug: it.listingSlug,
        date: it.date,
        published: true,
        sourceRatingVerified: true,
        sourceRatingVerifiedAt: verifiedAt,
        sourcePhotoVerified: true,
        sourcePhotoVerifiedAt: verifiedAt,
      };
      const existing = await ctx.db
        .query("reviews")
        .withIndex("by_source_hygglo_review_id", (q) =>
          q.eq("source", "hygglo").eq("hyggloReviewId", it.hyggloReviewId),
        )
        .unique();
      if (existing) await ctx.db.patch(existing._id, review);
      else await ctx.db.insert("reviews", review);
      upserted++;
    }
    return { upserted };
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
      authorImage: (acct.avatarStorageId && acct.avatarStorageId === acct.avatarOwnedStorageId ? await ctx.storage.getUrl(acct.avatarStorageId) : null) ?? acct.googleAvatarUrl ?? undefined,
      rating,
      text: text.trim(),
      product: b.lineItems[0]?.title,
      listingId: b.lineItems[0]?.listingId,
      verifiedBookingId: bookingId,
      date: Date.now(),
      published: true,
      incentivized:!encoreGate(b),encoreReward:!encoreGate(b),
    });
    const encore=await unlockLoyalty(ctx,acct);
    return { ok: true,encoreLevel:encore.level };
  },
});
