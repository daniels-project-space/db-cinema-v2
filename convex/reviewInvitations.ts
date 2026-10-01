import { query, internalQuery, internalMutation } from "./_generated/server";
import { v } from "convex/values";
import { accountForToken, ownedBooking, postRentalMessage } from "./lib/rentalChat";
import { reviewContext } from "./lib/reviewContext";
import { customerReviewGate, reviewSettlementFingerprint } from "./lib/reviewEligibility";

export const eligibility = query({
  args: { token: v.string(), bookingId: v.id("bookings") },
  handler: async (ctx, { token, bookingId }) => {
    const account = await accountForToken(ctx, token);
    const b = await ownedBooking(ctx, account, bookingId);
    const reviewed = !!await ctx.db.query("reviews").withIndex("by_booking", q => q.eq("verifiedBookingId", bookingId)).first();
    const context = await reviewContext(ctx, b);
    const reason = customerReviewGate(b);
    return { reviewed, eligible: !reviewed && !reason && b.reviewEligibilityFingerprint === reviewSettlementFingerprint(context),
      canCheck: !reviewed && !reason, suppressed: ["deposit_retained", "partial_refund"].includes(reason ?? "") };
  },
});
export const ownedContext = internalQuery({
  args: { token: v.string(), bookingId: v.id("bookings") },
  handler: async (ctx, { token, bookingId }) => reviewContext(ctx, await ownedBooking(ctx, await accountForToken(ctx, token), bookingId)),
});
export const recordEligibility = internalMutation({
  args: { bookingId: v.id("bookings"), fingerprint: v.string(), eligible: v.boolean() },
  handler: async (ctx, { bookingId, fingerprint, eligible }) => {
    const b = await ctx.db.get(bookingId);
    if (!b || fingerprint !== reviewSettlementFingerprint(await reviewContext(ctx, b))) return false;
    const allowed = eligible && !customerReviewGate(b);
    await ctx.db.patch(bookingId, { reviewEligibilityFingerprint: allowed ? fingerprint : undefined, reviewEligibilityCheckedAt: Date.now() });
    if (allowed && !b.reviewInvitationMessageId) {
      const reviewed = await ctx.db.query("reviews").withIndex("by_booking", q => q.eq("verifiedBookingId", bookingId)).first();
      const account = await ctx.db.query("accounts").withIndex("by_email", q => q.eq("email", (b.guestEmail ?? "").trim().toLowerCase())).first();
      if (account && !reviewed) {
        const messageId = await postRentalMessage(ctx, { accountId: account._id, bookingId, sender: "system",
          text: "Your rental is returned and its refundable security has been settled. How was your rental? You can leave a rating and review here.",
          meta: { kind: "review_invitation" } });
        await ctx.db.patch(bookingId, { reviewInvitationMessageId: messageId });
      }
    }
    return allowed;
  },
});
