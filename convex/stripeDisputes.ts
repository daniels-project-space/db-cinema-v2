import { internalMutation } from "./_generated/server";
import { v } from "convex/values";
import { queueOwnerNotification } from "./lib/adminPush";

export const record = internalMutation({
  args: {
    eventId: v.string(),
    eventType: v.union(v.literal("charge.dispute.created"), v.literal("charge.dispute.updated"), v.literal("charge.dispute.closed")),
    paymentIntentId: v.optional(v.string()),
    disputeId: v.optional(v.string()),
    status: v.optional(v.string()),
    reason: v.optional(v.string()),
    eventCreatedAt: v.optional(v.number()),
  },
  handler: async (ctx, { eventId, eventType, paymentIntentId, disputeId, status, reason, eventCreatedAt }) => {
    if (!/^evt_[A-Za-z0-9_]+$/.test(eventId) || eventId.length > 200) throw Error("Invalid dispute event.");
    const intent = paymentIntentId && /^pi_[A-Za-z0-9_]+$/.test(paymentIntentId) && paymentIntentId.length <= 200 ? paymentIntentId : undefined;
    const safeDisputeId = disputeId && /^dp_[A-Za-z0-9_]+$/.test(disputeId) && disputeId.length <= 200 ? disputeId : undefined;
    const safeStatus = typeof status === "string" && /^[a-z_]{1,64}$/.test(status) ? status : undefined;
    const safeReason = typeof reason === "string" && /^[a-z_]{1,80}$/.test(reason) ? reason : undefined;
    const eventAt = Number.isSafeInteger(eventCreatedAt) && eventCreatedAt! > 0 ? eventCreatedAt! * 1000 : Date.now();
    const [bookingMatches, chargeMatches] = intent ? await Promise.all([
      ctx.db.query("bookings").withIndex("by_stripePaymentIntentId", query => query.eq("stripePaymentIntentId", intent)).take(2),
      ctx.db.query("rental_security_charges").withIndex("by_intent", query => query.eq("intentId", intent)).take(2),
    ]) : [[], []];
    // Stripe payment intents are unique, but do not guess if our local records are ambiguous
    // or the same provider reference appears in both payment ledgers.
    const ambiguous = bookingMatches.length > 1 || chargeMatches.length > 1 || bookingMatches.length > 0 && chargeMatches.length > 0;
    const charge = !ambiguous && chargeMatches.length === 1 ? chargeMatches[0] : undefined;
    const booking = !ambiguous
      ? bookingMatches.length === 1 ? bookingMatches[0] : charge ? await ctx.db.get(charge.bookingId) : undefined
      : undefined;
    if (!ambiguous && charge) {
      const existingAt = charge.stripeDisputeUpdatedAt ?? 0;
      if (eventAt >= existingAt) {
        await ctx.db.patch(charge._id, {
          ...(safeDisputeId ? { stripeDisputeId: safeDisputeId } : {}),
          ...(safeStatus ? { stripeDisputeStatus: safeStatus } : {}),
          ...(safeReason ? { stripeDisputeReason: safeReason } : {}),
          stripeDisputeEventId: eventId,
          stripeDisputeUpdatedAt: eventAt,
          disputedAt: charge.disputedAt ?? eventAt,
          updatedAt: Math.max(charge.updatedAt ?? 0, eventAt),
        });
      }
    }
    if (!ambiguous && booking) {
      const existingAt = booking.stripeDisputeUpdatedAt ?? 0;
      if (eventAt >= existingAt) {
        await ctx.db.patch(booking._id, {
          stripeDisputedAt: booking.stripeDisputedAt ?? eventAt,
          ...(safeDisputeId ? { stripeDisputeId: safeDisputeId } : {}),
          ...(safeStatus ? { stripeDisputeStatus: safeStatus } : {}),
          ...(safeReason ? { stripeDisputeReason: safeReason } : {}),
          stripeDisputeEventId: eventId,
          stripeDisputeUpdatedAt: eventAt,
        });
      }
    }
    const title = eventType === "charge.dispute.created" ? "Stripe dispute opened" : eventType === "charge.dispute.closed" ? "Stripe dispute closed" : "Stripe dispute updated";
    const detail = [safeStatus && `Status: ${safeStatus.replaceAll("_", " ")}`, safeReason && `Reason: ${safeReason.replaceAll("_", " ")}`].filter(Boolean).join(" · ");
    const body = `${detail ? `${detail}. ` : ""}${booking ? "Check Stripe for the dispute details and any deadline. The website made no charge or refund." : "Check Stripe for the dispute details and affected payment. The website made no charge or refund."}`;
    await queueOwnerNotification(ctx, { eventKey: `stripe-dispute:${eventId}`, kind: "stripe_dispute", ...(booking ? { bookingId: booking._id, ...(booking.accountId ? { accountId: booking.accountId } : {}) } : {}), title, body });
  },
});
