import { queueRentalEmail } from "./lib/rentalEmailQueue";
import { accountForRental } from "./lib/rentalAccount";
import { encoreGate } from "./lib/loyalty";
import { reviewContext } from "./lib/reviewContext";
import { internalMutation, internalQuery } from "./_generated/server";
import { v } from "convex/values";
import { reviewFingerprint, reviewFollowUpDueAt, reviewGate, reviewSuppressed } from "./lib/reviewEligibility";

export const candidates = internalQuery({
  args: {},
  handler: async (ctx) => {const rows=await ctx.db.query("bookings")
    .withIndex("by_review_check", q => q.eq("status", "returned"))
    .order("asc")
    .filter(q => q.and(q.neq(q.field("remindedReview"), true),
      q.neq(q.field("reviewFollowUpStatus"), "sent"),
      q.neq(q.field("reviewFollowUpStatus"), "sending"),q.neq(q.field("reviewFollowUpStatus"), "failed")))
    .take(50);return Promise.all(rows.map(async b => { const account=await accountForRental(ctx,b);return {...await reviewContext(ctx,b),hasAccount:!!account,customerEmail:account?.email??(b.accountId?undefined:b.guestEmail),prizeOffersAllowed:!!account?.marketingEmails&&!encoreGate(b),encoreOffersAllowed:!!account?.marketingEmails&&!encoreGate(b)}; }));},
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
    if (!b || reviewFingerprint(b) !== fingerprint || ["sending","sent","failed"].includes(b.reviewFollowUpStatus??"") || b.remindedReview) return false;
    const blocked = reviewGate(b) ?? reason;
    if (blocked) {
      if (blocked !== "already_sent") await ctx.db.patch(bookingId, {
        reviewFollowUpStatus: reviewSuppressed(blocked) ? "suppressed" : "waiting",
        reviewFollowUpReason: blocked, reviewFollowUpCheckedAt: Date.now(),
      });
      return false;
    }
    const now = Date.now();
    const due = reviewFollowUpDueAt(b, now);
    const account=await accountForRental(ctx,b);
    // Account holders receive the interactive invitation in their rental chat.
    // Email is reserved for guests who do not have a chat-capable account.
    if (account || b.reviewInvitationMessageId) return false;
    const recipient=b.accountId?null:b.guestEmail;
    const ready = claim && !!recipient && now >= due;
    await ctx.db.patch(bookingId, {
      reviewFollowUpStatus: ready ? "sending" : "waiting",
      reviewFollowUpReason: ready ? undefined : !recipient ? "recipient_unavailable" : "post_refund_wait",
      reviewFollowUpCheckedAt: now, reviewRefundConfirmedAt: b.reviewRefundConfirmedAt ?? now,
      reviewFollowUpDueAt: due,
    });
    if(ready)await queueRentalEmail(ctx,bookingId,"review");
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

/** Private current recipient and offer permissions for the durable mail renderer. */
export const emailContext=internalQuery({args:{bookingId:v.id("bookings")},handler:async(ctx,{bookingId})=>{
 const b=await ctx.db.get(bookingId);if(!b)return null;
 const account=await accountForRental(ctx,b);
 return {...b,customerEmail:account?.email??(b.accountId?undefined:b.guestEmail),
  encoreOffersAllowed:!!account?.marketingEmails&&!encoreGate(b),prizeOffersAllowed:!!account?.marketingEmails&&!encoreGate(b)};
}});
