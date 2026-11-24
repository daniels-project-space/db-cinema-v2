import { internalMutation } from "./_generated/server";
import { v } from "convex/values";
import { verificationBookingOpen, verificationCanStart, verificationWindowClosed } from "../shared/verificationProgress";

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
    if (lock?.outcomeUnknown) throw new Error("A previous Didit decision may have been received. Refresh and reconcile the case before another decision.");
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
    if (booking?.diditReviewClaim?.requestId === args.requestId && booking.diditReviewClaim.sessionId === args.sessionId && !booking.diditReviewClaim.outcomeUnknown)
      await ctx.db.patch(args.bookingId, { diditReviewClaim: undefined });
  },
});

export const markUnknown = internalMutation({
  args: { bookingId: v.id("bookings"), requestId: v.string(), sessionId: v.string(), expectedAccountId: v.union(v.id("accounts"), v.null()), expectedEmail: v.string(), auditMarker: v.string() },
  handler: async (ctx, args) => {
    const booking: any = await ctx.db.get(args.bookingId);
    const lock = booking?.diditReviewClaim;
    if (!/^[a-f0-9]{32}$/.test(args.auditMarker) || !lock || lock.requestId !== args.requestId || lock.sessionId !== args.sessionId || lock.outcomeUnknown ||
        booking.diditSessionId !== args.sessionId || booking.verificationProvider !== "didit" || booking.idVerifyStatus !== "manual_review" ||
        !verificationBookingOpen(booking.status) || verificationWindowClosed(booking) || booking.cancellationDecision || booking.returnDecision ||
        (booking.accountId ?? null) !== args.expectedAccountId || booking.guestEmail !== args.expectedEmail)
      throw new Error("The review claim changed. Refresh the case before deciding.");
    await ctx.db.patch(args.bookingId, { diditReviewClaim: { ...lock, outcomeUnknown: true, auditMarker: args.auditMarker } });
  },
});

export const reconcileConfirmed = internalMutation({
  args: { bookingId: v.id("bookings"), sessionId: v.string(), providerStatus: v.string(), expectedMarker: v.string() },
  handler: async (ctx, args) => {
    const booking: any = await ctx.db.get(args.bookingId);
    const lock = booking?.diditReviewClaim;
    const expected = lock?.decision === "approve" ? ["Approved", "verified"] : lock?.decision === "decline" ? ["Declined", "rejected"] : lock?.decision === "resubmit" ? ["Resubmitted", "requires_input"] : null;
    if (!lock?.outcomeUnknown || !/^[a-f0-9]{32}$/.test(args.expectedMarker) || lock.auditMarker !== args.expectedMarker || lock.sessionId !== args.sessionId || booking.diditSessionId !== args.sessionId || !expected || args.providerStatus !== expected[0] || booking.idVerifyStatus !== expected[1]) return false;
    await ctx.db.patch(args.bookingId, { diditReviewClaim: undefined });
    return true;
  },
});

/** Share the reviewer lease so a renter retry cannot race an in-app review.
 * Bound attempts per booking even if the provider is unavailable. */
export const claimRenterRetry = internalMutation({
  args: { bookingId: v.id("bookings"), sessionId: v.string(), requestId: v.string(), expectedEventId: v.union(v.string(), v.null()), expectedEventAt: v.union(v.number(), v.null()), expectedAccountId:v.union(v.id("accounts"),v.null()), expectedEmail:v.string(), expectedIdVerifyStatus:v.union(v.literal("rejected"),v.literal("requires_input")) },
  handler: async (ctx, args) => {
    const booking = await ctx.db.get(args.bookingId);
    const now = Date.now();
    if (!booking || booking.verificationProvider !== "didit" || booking.diditSessionId !== args.sessionId ||
        !verificationCanStart(booking) || booking.idVerifyStatus !== args.expectedIdVerifyStatus ||
        (booking.accountId ?? null) !== args.expectedAccountId || booking.guestEmail !== args.expectedEmail ||
        (booking.diditEventId ?? null) !== args.expectedEventId || (booking.diditEventAt ?? null) !== args.expectedEventAt)
      throw new Error("Your verification changed. Refresh this page before trying again.");
    if (booking.accountId) { const account = await ctx.db.get(booking.accountId); if (!account || account.blockedAt != null) throw new Error("The rental account is unavailable."); }
    if (booking.diditReviewClaim && (booking.diditReviewClaim.outcomeUnknown || now - booking.diditReviewClaim.startedAt < 90_000))
      throw new Error("A verification update is already in progress. Please wait a moment.");
    const windowAt = booking.diditRetryWindowAt && now - booking.diditRetryWindowAt < 86400000 ? booking.diditRetryWindowAt : now;
    const attempts = windowAt === booking.diditRetryWindowAt ? (booking.diditRetryAttempts ?? 0) : 0;
    if (attempts >= 3) throw new Error("Please contact the team for help with your verification.");
    await ctx.db.patch(args.bookingId, { diditReviewClaim: { requestId: args.requestId, sessionId: args.sessionId, decision: "renter-resubmit", startedAt: now }, diditRetryWindowAt: windowAt, diditRetryAttempts: attempts + 1 });
  },
});
