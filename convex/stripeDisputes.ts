import { internalMutation } from "./_generated/server";
import { v } from "convex/values";
import { queueOwnerNotification } from "./lib/adminPush";

export const record = internalMutation({
  args: {
    eventId: v.string(),
    eventType: v.union(v.literal("charge.dispute.created"), v.literal("charge.dispute.updated"), v.literal("charge.dispute.closed")),
    paymentIntentId: v.optional(v.string()),
  },
  handler: async (ctx, { eventId, eventType, paymentIntentId }) => {
    if (!/^evt_[A-Za-z0-9_]+$/.test(eventId) || eventId.length > 200) throw Error("Invalid dispute event.");
    const intent = paymentIntentId && /^pi_[A-Za-z0-9_]+$/.test(paymentIntentId) && paymentIntentId.length <= 200 ? paymentIntentId : undefined;
    const matches = intent ? await ctx.db.query("bookings").withIndex("by_stripePaymentIntentId", query => query.eq("stripePaymentIntentId", intent)).take(2) : [];
    const booking = matches.length === 1 ? matches[0] : undefined;
    const title = eventType === "charge.dispute.created" ? "Stripe dispute opened" : eventType === "charge.dispute.closed" ? "Stripe dispute closed" : "Stripe dispute updated";
    const body = booking ? "Check Stripe for the dispute details and any deadline. The website made no charge or refund." : "Check Stripe for the dispute details and affected payment. The website made no charge or refund.";
    await queueOwnerNotification(ctx, { eventKey: `stripe-dispute:${eventId}`, kind: "stripe_dispute", ...(booking ? { bookingId: booking._id, ...(booking.accountId ? { accountId: booking.accountId } : {}) } : {}), title, body });
  },
});
