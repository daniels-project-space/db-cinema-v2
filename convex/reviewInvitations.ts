import { encoreGate } from "./lib/loyalty";
import { accountForRental } from "./lib/rentalAccount";
import { query, mutation, internalQuery, internalMutation } from "./_generated/server";
import { v } from "convex/values";
import { accountForToken, ownedBooking, postRentalMessage } from "./lib/rentalChat";
import { reviewContext } from "./lib/reviewContext";
import { customerReviewGate, reviewSettlementFingerprint } from "./lib/reviewEligibility";
import { assertAdmin, checkAdminToken } from "./adminAuth";

async function invitationState(ctx: any, booking: any) {
  if (!booking) return { state: "not_found" as const };
  const reviewed = await ctx.db.query("reviews").withIndex("by_booking", (q: any) => q.eq("verifiedBookingId", booking._id)).first();
  if (reviewed) return { state: "reviewed" as const };
  const previous = booking.reviewInvitationMessageId ? await ctx.db.get(booking.reviewInvitationMessageId) : null;
  if (booking.reviewInvitationMessageId && (!previous || typeof previous.at !== "number" || Date.now() - previous.at < 24 * 60 * 60 * 1000)) return { state: "sent" as const };
  if (customerReviewGate(booking)) return { state: "not_settled" as const };
  if (booking.reviewEligibilityFingerprint !== reviewSettlementFingerprint(await reviewContext(ctx, booking))) return { state: "check_required" as const };
  const account = await accountForRental(ctx, booking);
  return account ? { state: previous ? "resend_ready" as const : "ready" as const, account } : { state: "no_account" as const };
}

async function postInvitation(ctx: any, booking: any, account: any) {
  const reviewUrl = `https://dbcinemarentals.com/account?rental=${encodeURIComponent(booking._id)}&review=1#rental-review-${booking._id}`;
  const messageId = await postRentalMessage(ctx, { accountId: account._id, bookingId: booking._id, sender: "system",
    text: `${!encoreGate(booking) ? "Your clean return and security settlement are complete. Leave an honest review to earn your next Encore rental saving. Every star rating counts equally." : "Your rental is returned and its refundable security has been settled. How was your rental? You can leave a rating and review here."} [Leave your rental review](${reviewUrl})`,
    meta: { kind: "review_invitation" } });
  await ctx.db.patch(booking._id, { reviewInvitationMessageId: messageId });
}

export const adminStatus = query({
  args: { token: v.string(), bookingId: v.id("bookings") },
  handler: async (ctx, { token, bookingId }) => {
    if (!checkAdminToken(token)) return null;
    return { state: (await invitationState(ctx, await ctx.db.get(bookingId))).state };
  },
});

export const sendByAdmin = mutation({
  args: { token: v.string(), bookingId: v.id("bookings") },
  handler: async (ctx, { token, bookingId }) => {
    await assertAdmin(ctx, token, "reviewInvitations.sendByAdmin");
    const booking = await ctx.db.get(bookingId);
    const result = await invitationState(ctx, booking);
    if (result.state === "sent" || result.state === "reviewed") return { state: result.state };
    if ((result.state !== "ready" && result.state !== "resend_ready") || !booking) throw Error("The review request cannot be sent until the rental and its security settlement have been checked and are eligible.");
    await postInvitation(ctx, booking, result.account);
    return { state: "sent" as const };
  },
});

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
    await ctx.db.patch(bookingId, { reviewEligibilityFingerprint: allowed ? fingerprint : undefined, reviewEligibilityCheckedAt: Date.now() });
    if (allowed && !b.reviewInvitationMessageId) {
      const reviewed = await ctx.db.query("reviews").withIndex("by_booking", q => q.eq("verifiedBookingId", bookingId)).first();
      const account = await accountForRental(ctx,b);
      if (account && !reviewed) {
        await postInvitation(ctx, b, account);
      }
    }
    return allowed;
  },
});
