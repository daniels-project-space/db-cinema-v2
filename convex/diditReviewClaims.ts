import { internalMutation } from "./_generated/server";
import { v } from "convex/values";
import { verificationBookingOpen } from "../shared/verificationProgress";

/** Keep provider I/O in the Node action module and reservation state in a
 * regular Convex mutation module. Mutations are not supported from a `use node`
 * file. */
export const claim = internalMutation({
  args: {
    bookingId: v.id("bookings"), sessionId: v.string(), requestId: v.string(),
    decision: v.union(v.literal("approve"), v.literal("resubmit"), v.literal("decline")),
  },
  handler: async (ctx, args) => {
    const booking: any = await ctx.db.get(args.bookingId);
    if (!booking || booking.verificationProvider !== "didit" || booking.diditSessionId !== args.sessionId ||
        !verificationBookingOpen(booking.status) || booking.idVerifyStatus !== "manual_review")
      throw new Error("This rental is no longer waiting for a Didit review.");
    const lock = booking.diditReviewClaim;
    if (lock && Date.now() - lock.startedAt < 90_000 && lock.requestId !== args.requestId)
      throw new Error("A review is already being sent for this case.");
    if (lock && lock.requestId === args.requestId &&
        (lock.sessionId !== args.sessionId || lock.decision !== args.decision))
      throw new Error("This review request has already been used for another decision.");
    const startedAt = lock?.requestId === args.requestId ? lock.startedAt : Date.now();
    await ctx.db.patch(args.bookingId, { diditReviewClaim: { requestId: args.requestId, sessionId: args.sessionId, decision: args.decision, startedAt } });
    return {
      sessionId: booking.diditSessionId,
      diditEventId: booking.diditEventId ?? null,
      diditEventAt: booking.diditEventAt ?? null,
      diditManualDecisionAt: booking.diditManualDecisionAt ?? null,
      startedAt,
    };
  },
});

export const release = internalMutation({
  args: { bookingId: v.id("bookings"), requestId: v.string(), sessionId: v.string() },
  handler: async (ctx, args) => {
    const booking: any = await ctx.db.get(args.bookingId);
    if (booking?.diditReviewClaim?.requestId === args.requestId && booking.diditReviewClaim.sessionId === args.sessionId)
      await ctx.db.patch(args.bookingId, { diditReviewClaim: undefined });
  },
});
