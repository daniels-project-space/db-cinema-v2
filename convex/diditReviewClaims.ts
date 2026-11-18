import { internalMutation } from "./_generated/server";
import { v } from "convex/values";
import { verificationCanStart } from "../shared/verificationProgress";

/** Serialize renter attempts for this booking and recheck its binding. */
export const claimRenterRetry = internalMutation({
  args: { bookingId: v.id("bookings"), sessionId: v.string(), requestId: v.string(), expectedEventId: v.union(v.string(), v.null()), expectedEventAt: v.union(v.number(), v.null()), expectedAccountId:v.union(v.id("accounts"),v.null()), expectedEmail:v.string() },
  handler: async (ctx, args) => {
    const booking = await ctx.db.get(args.bookingId);
    const now = Date.now();
    if (!booking || booking.verificationProvider !== "didit" || booking.diditSessionId !== args.sessionId ||
        !Number.isSafeInteger(booking.checkoutPaidAt) || (booking.checkoutPaidAt ?? 0) <= 0 ||
        !verificationCanStart(booking) || booking.idVerifyStatus !== "rejected" ||
        (booking.accountId ?? null) !== args.expectedAccountId || booking.guestEmail !== args.expectedEmail ||
        (booking.diditEventId ?? null) !== args.expectedEventId || (booking.diditEventAt ?? null) !== args.expectedEventAt)
      throw new Error("Your verification changed. Refresh this page before trying again.");
    const account = booking.accountId ? await ctx.db.get(booking.accountId) : await ctx.db.query("accounts").withIndex("by_email", q=>q.eq("email",(booking.guestEmail ?? "").trim().toLowerCase())).first();
    if (booking.accountId && !account || account?.blockedAt != null) throw new Error("The rental account is unavailable.");
    if (booking.diditReviewClaim && now - booking.diditReviewClaim.startedAt < 90_000)
      throw new Error("A verification update is already in progress. Please wait a moment.");
    const windowAt = booking.diditRetryWindowAt && now - booking.diditRetryWindowAt < 15 * 60_000 ? booking.diditRetryWindowAt : now;
    const attempts = windowAt === booking.diditRetryWindowAt ? (booking.diditRetryAttempts ?? 0) : 0;
    if (attempts >= 10) throw new Error("Please wait a few minutes or contact the team for help with your verification.");
    await ctx.db.patch(args.bookingId, { diditReviewClaim: { requestId: args.requestId, sessionId: args.sessionId, decision: "renter-resubmit", startedAt: now }, diditRetryNotice: {requestId:args.requestId,sessionId:args.sessionId,startedAt:now}, diditRetryWindowAt: windowAt, diditRetryAttempts: attempts + 1 });
  },
});

export const release = internalMutation({
  args: { bookingId: v.id("bookings"), requestId: v.string(), sessionId: v.string() },
  handler: async (ctx, args) => {
    const booking = await ctx.db.get(args.bookingId);
    if (booking?.diditReviewClaim?.requestId === args.requestId && booking.diditReviewClaim.sessionId === args.sessionId)
      await ctx.db.patch(args.bookingId, { diditReviewClaim: undefined });
  },
});
