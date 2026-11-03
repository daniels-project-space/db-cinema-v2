import { encoreGate } from "./lib/loyalty";
import { accountForRental } from "./lib/rentalAccount";
import { query, internalQuery, internalMutation } from "./_generated/server";
import { v } from "convex/values";
import { accountForToken, ownedBooking, postRentalMessage } from "./lib/rentalChat";
import { reviewContext } from "./lib/reviewContext";
import { customerReviewGate, reviewSettlementFingerprint } from "./lib/reviewEligibility";
import { queueEncoreCheck } from "./lib/encoreCheckQueue";

export const eligibility = query({
  args: { token: v.string(), bookingId: v.id("bookings") },
  handler: async (ctx, { token, bookingId }) => {
    const account = await accountForToken(ctx, token);
    const b = await ownedBooking(ctx, account, bookingId);
    const reviewed = !!await ctx.db.query("reviews").withIndex("by_booking", q => q.eq("verifiedBookingId", bookingId)).first();
    const context = await reviewContext(ctx, b);
    const reason = customerReviewGate(b);
    return { reviewed, encoreEligible:!encoreGate(b), eligible: !reviewed && !reason && b.reviewEligibilityFingerprint === reviewSettlementFingerprint(context),
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
    const account = await accountForRental(ctx,b);
    await ctx.db.patch(bookingId, { reviewEligibilityFingerprint: allowed ? fingerprint : undefined, reviewEligibilityCheckedAt: Date.now() });
    if(process.env.ENCORE_EVIDENCE_READ_ENABLED==="true"&&allowed&&!encoreGate(b)){
      const evidence=await ctx.db.query("encore_eligibility_evidence").withIndex("by_booking",q=>q.eq("bookingId",bookingId)).unique();
      if(!evidence||evidence.fingerprint!==fingerprint)await queueEncoreCheck(ctx,bookingId,{quiet:true});
    }
    if (allowed && !b.reviewInvitationMessageId) {
      const reviewed = await ctx.db.query("reviews").withIndex("by_booking", q => q.eq("verifiedBookingId", bookingId)).first();
      if (account && !reviewed) {
        const messageId = await postRentalMessage(ctx, { accountId: account._id, bookingId, sender: "system",
          text: process.env.ENCORE_EVIDENCE_READ_ENABLED!=="true"&&!encoreGate(b)?"Your clean return and security settlement are complete. Leave an honest review to earn your next Encore rental saving. Every star rating counts equally.":"Your rental is returned and its refundable security has been settled. How was your rental? You can leave a rating and review here.",
          meta: { kind: "review_invitation" } });
        await ctx.db.patch(bookingId, { reviewInvitationMessageId: messageId });
      }
    }
    return allowed;
  },
});
