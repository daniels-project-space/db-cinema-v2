import { query, mutation } from "./_generated/server";
import { v } from "convex/values";
import { accountForToken, ownedBooking } from "./lib/rentalChat";
import { accountForRental } from "./lib/rentalAccount";
import { customerReviewGate, reviewSettlementFingerprint } from "./lib/reviewEligibility";
import { reviewContext } from "./lib/reviewContext";
import { loyaltyProgress, unlockLoyalty } from "./lib/loyalty";
import { assertAdmin, checkAdminToken } from "./adminAuth";

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
        (r.source === "native" && (r.moderationStatus === undefined || r.moderationStatus === "approved")) || (
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
      const photo = r.source === "native" && r.authorImagePublic === true
        ? (account?.avatarStorageId && account.avatarStorageId === account.avatarOwnedStorageId ? await ctx.storage.getUrl(account.avatarStorageId) : null) ?? (account?.googleAvatarRemoved === true ? null : account?.googleAvatarUrl ?? null)
        : null;
      return ({
      _id: r._id,
      source: r.source,
      author: r.author,
      authorImage: r.source === "native" ? photo : r.authorImage ?? null,
      rating: r.rating,
      incentivized: r.incentivized ?? false,encoreReward:r.encoreReward??false,prizeEntry:r.prizeEntry === true,
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
      (review.moderationStatus === undefined || review.moderationStatus === "approved") &&
      !!review.text &&
      review.text.trim().length > 8 &&
      Number.isInteger(review.rating) &&
      review.rating >= 1 &&
      review.rating <= 5,
    );
    return Promise.all(withText.map(async (review) => {
      const account = review.authorAccountId ? await ctx.db.get(review.authorAccountId) : null;
      const photo = review.authorImagePublic === true
        ? (account?.avatarStorageId && account.avatarStorageId === account.avatarOwnedStorageId ? await ctx.storage.getUrl(account.avatarStorageId) : null) ?? (account?.googleAvatarRemoved === true ? null : account?.googleAvatarUrl ?? null)
        : null;
      return {
        _id: review._id,
        source: review.source,
        author: review.author,
        authorImage: photo,
        rating: review.rating,
        incentivized: review.incentivized ?? false,
        encoreReward: review.encoreReward ?? false,
        prizeEntry: review.prizeEntry === true,
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
    const ordinary = rows.filter(r =>
      (r.source === "native" && (r.moderationStatus === undefined || r.moderationStatus === "approved") && (!r.incentivized || (r.encoreReward === true && r.prizeEntry !== true))) ||
      (r.source === "hygglo" && r.sourceRatingVerified === true && r.sourceRating === r.rating),
    );
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

export const adminPendingNative = query({
  args: { token: v.string(), limit: v.optional(v.number()) },
  handler: async (ctx, { token, limit }) => {
    if (!checkAdminToken(token)) return { authorized: false as const, items: [] };
    const count = Math.min(80, Math.max(1, Math.floor(limit ?? 40)));
    const rows = await ctx.db.query("reviews")
      .withIndex("by_moderation_status_date", (q) => q.eq("source", "native").eq("moderationStatus", "pending"))
      .order("desc")
      .take(count);
    return {
      authorized: true as const,
      items: rows.map((review) => ({
        _id: review._id,
        bookingId: review.verifiedBookingId ?? null,
        author: review.author,
        rating: review.rating,
        text: review.text ?? "",
        product: review.product ?? null,
        date: review.date,
        incentivized: review.incentivized === true,
        encoreReward: review.encoreReward === true,
        prizeEntry: review.prizeEntry === true,
      })),
    };
  },
});

export const moderateNative = mutation({
  args: {
    token: v.string(),
    reviewId: v.id("reviews"),
    decision: v.union(v.literal("approve"), v.literal("reject")),
    note: v.optional(v.string()),
  },
  handler: async (ctx, { token, reviewId, decision, note }) => {
    await assertAdmin(ctx, token, "reviews.moderateNative");
    const review = await ctx.db.get(reviewId);
    if (!review || review.source !== "native" || review.moderationStatus !== "pending" || review.published)
      throw Error("This review is no longer waiting for moderation.");
    const moderationNote = note?.trim();
    if (moderationNote && moderationNote.length > 500) throw Error("Moderation note is too long.");
    if (decision === "reject" && (!moderationNote || moderationNote.length < 5))
      throw Error("Add a short reason before rejecting this review.");
    if (decision === "approve") {
      if (!review.verifiedBookingId || !Number.isInteger(review.rating) || review.rating < 1 || review.rating > 5 ||
          !review.text || review.text.trim().length < 10 || review.text.trim().length > 2000)
        throw Error("This review is missing valid rental or review details.");
      const booking = await ctx.db.get(review.verifiedBookingId);
      if (!booking) throw Error("The linked rental could not be found.");
      const context = await reviewContext(ctx, booking);
      const owner = await accountForRental(ctx, booking);
      if (!owner || !review.authorAccountId || owner._id !== review.authorAccountId)
        throw Error("The review owner no longer matches the linked rental.");
      if (customerReviewGate(context) || booking.reviewEligibilityFingerprint !== reviewSettlementFingerprint(context))
        throw Error("The rental is no longer eligible for public review display.");
    }
    const approved = decision === "approve";
    await ctx.db.patch(reviewId, {
      published: approved,
      moderationStatus: approved ? "approved" : "rejected",
      moderationAt: Date.now(),
      moderationNote: moderationNote || undefined,
    });
    return { status: approved ? "approved" as const : "rejected" as const };
  },
});

/** A logged-in customer leaves a verified review for one of their bookings. */
export const submitNative = mutation({
  args: { token: v.string(), bookingId: v.id("bookings"), rating: v.number(), text: v.string(), showProfilePhoto: v.optional(v.boolean()) },
  handler: async (ctx, { token, bookingId, rating, text, showProfilePhoto }) => {
    const acct = await accountForToken(ctx, token);
    if (!acct) throw new Error("Please sign in to review.");
    const b = await ownedBooking(ctx, acct, bookingId);
    if (!Number.isInteger(rating) || rating < 1 || rating > 5) throw new Error("Rating must be 1-5.");
    if (text.trim().length < 10 || text.trim().length > 2000) throw Error("Write a review between 10 and 2,000 characters.");
    const context = await reviewContext(ctx, b);
    if (customerReviewGate(context) || b.reviewEligibilityFingerprint !== reviewSettlementFingerprint(context))
      throw Error("A review is available after the rental is returned and its refundable security is fully settled.");
    const priorLoyalty = await loyaltyProgress(ctx, acct);
    const existing = await ctx.db.query("reviews").withIndex("by_booking", q => q.eq("verifiedBookingId", bookingId)).first();
    if (existing && (existing.authorAccountId !== acct._id || existing.moderationStatus !== "rejected"))
      throw new Error("You've already reviewed this booking.");
    const review = {
      source: "native" as const,
      author: acct.name ?? acct.email.split("@")[0],
      authorAccountId: acct._id,
      authorImagePublic: showProfilePhoto === true,
      rating,
      text: text.trim(),
      product: b.lineItems[0]?.title,
      listingId: b.lineItems[0]?.listingId,
      verifiedBookingId: bookingId,
      date: Date.now(),
      published: false,
      moderationStatus: "pending" as const,
      moderationAt: undefined,
      moderationNote: undefined,
      incentivized: false,
      encoreReward: false,
    };
    const reviewId = existing ? existing._id : await ctx.db.insert("reviews", review);
    if (existing) await ctx.db.patch(reviewId, review);
    const earnedLoyalty = await unlockLoyalty(ctx, acct);
    const earnedEncoreReward = earnedLoyalty.completed !== null && earnedLoyalty.earnedLevel > (priorLoyalty.earnedLevel ?? 0);
    if (earnedEncoreReward) await ctx.db.patch(reviewId, { incentivized: true, encoreReward: true });
    return { ok: true, status: "pending" as const };
  },
});
