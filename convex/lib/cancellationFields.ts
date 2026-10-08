import { v } from "convex/values";
export const cancellationReceipt = v.object({
  paymentIntentId: v.string(), amountPence: v.number(), attemptedAt: v.number(),
  stripeRefundId: v.optional(v.string()), approvalRequestId: v.optional(v.string()), approvalUrl: v.optional(v.string()),
  status: v.union(v.literal("unknown"), v.literal("awaiting_approval"), v.literal("pending"), v.literal("succeeded"), v.literal("failed")),
});
