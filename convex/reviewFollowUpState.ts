import { reviewContext } from "./lib/reviewContext";
import { internalMutation, internalQuery } from "./_generated/server";
import { v } from "convex/values";
import { reviewFingerprint, reviewGate, reviewSuppressed } from "./lib/reviewEligibility";

export const candidates = internalQuery({
  args: {},
  handler: async (ctx) => {const rows=await ctx.db.query("bookings")
    .withIndex("by_review_check", q => q.eq("status", "returned"))
    .order("asc")
    .filter(q => q.and(q.neq(q.field("remindedReview"), true),
      q.neq(q.field("reviewFollowUpStatus"), "sent"),
      q.neq(q.field("reviewFollowUpStatus"), "sending")))
    .take(50);return Promise.all(rows.map(b => reviewContext(ctx, b)));},
});
export const context = internalQuery({
  args: { bookingId: v.id("bookings") },
  handler: (ctx, { bookingId }) => ctx.db.get(bookingId),
});
/** Recheck inside the transaction so a stale provider read cannot authorize mail. */
export const recordCheck = internalMutation({
  args: { bookingId: v.id("bookings"), fingerprint: v.string(), reason: v.optional(v.string()), claim: v.boolean() },
  handler: async (ctx, { bookingId, fingerprint, reason, claim }) => {
    const b = await ctx.db.get(bookingId);
    if (!b || reviewFingerprint(b) !== fingerprint || b.reviewFollowUpStatus === "sending") return false;
    const blocked = reviewGate(b) ?? reason;
    if (blocked) {
      if (blocked !== "already_sent") await ctx.db.patch(bookingId, {
        reviewFollowUpStatus: reviewSuppressed(blocked) ? "suppressed" : "waiting",
        reviewFollowUpReason: blocked, reviewFollowUpCheckedAt: Date.now(),
      });
      return false;
    }
    const now = Date.now();
    const due = b.reviewFollowUpDueAt ?? Math.max(now, b.returnedAt ?? 0,
      ...(b.lineItems.map(li => li.end))) + 86400000;
    const ready = claim && !!b.guestEmail && now >= due;
    await ctx.db.patch(bookingId, {
      reviewFollowUpStatus: ready ? "sending" : "waiting",
      reviewFollowUpReason: ready ? undefined : "post_refund_wait",
      reviewFollowUpCheckedAt: now, reviewRefundConfirmedAt: b.reviewRefundConfirmedAt ?? now,
      reviewFollowUpDueAt: due,
    });
    return ready;
  },
});
export const recordSent = internalMutation({
  args: { bookingId: v.id("bookings"), sent: v.boolean() },
  handler: async (ctx, { bookingId, sent }) => {
    const b = await ctx.db.get(bookingId);
    if (!b || b.reviewFollowUpStatus !== "sending") return;
    await ctx.db.patch(bookingId, {
      reviewFollowUpStatus: sent ? "sent" : "waiting",
      reviewFollowUpReason: sent ? undefined : "email_failed",
      remindedReview: sent, reviewFollowUpSentAt: sent ? Date.now() : undefined,
    });
  },
});
