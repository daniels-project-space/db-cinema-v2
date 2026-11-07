import { v } from "convex/values";
import { internalAction } from "./_generated/server";
import { swapAuthorityAvailable } from "./lib/rentalSwapAuthority";
import { sendSharedStockRequest } from "./lib/sharedStockTransport";

const request = v.union(
  v.object({ operation: v.literal("acquire"), args: v.object({ requestId: v.string(), items: v.array(v.object({ itemId: v.string(), start: v.number(), returnAt: v.number(), quantity: v.number() })) }) }),
  v.object({ operation: v.literal("acquireZero"), args: v.object({ requestId:v.string(),bookingId:v.string(),oldItems:v.array(v.object({itemId:v.string(),start:v.number(),returnAt:v.number(),quantity:v.number()})),newItems:v.array(v.object({itemId:v.string(),start:v.number(),returnAt:v.number(),quantity:v.number()})) }) }),
  v.object({ operation: v.literal("beginExecution"), args: v.object({ id: v.string(), fingerprint: v.string(), executionKey: v.string() }) }),
  v.object({ operation: v.literal("checkExecution"), args: v.object({ id: v.string(), fingerprint: v.string(), executionKey: v.string() }) }),
  v.object({ operation: v.literal("checkConversion"), args: v.object({ id: v.string(), fingerprint: v.string(), executionKey: v.string(), receipt: v.any() }) }),
  v.object({ operation: v.literal("releaseCompensated"), args: v.object({ id: v.string(), fingerprint: v.string(), executionKey: v.string(), evidence: v.object({ swapId:v.string(),bookingId:v.string(),bookingRevision:v.number(),paymentIntentId:v.string(),refundId:v.string(),refundStatus:v.literal("succeeded"),amountPence:v.number(),refundAttemptedAt:v.number(),windows:v.array(v.object({itemId:v.string(),start:v.number(),end:v.number(),quantity:v.number()})) }) }) }),
  v.object({ operation: v.literal("checkCompensatedRelease"), args: v.object({ id: v.string(), fingerprint: v.string(), executionKey: v.string(), evidence: v.object({ swapId:v.string(),bookingId:v.string(),bookingRevision:v.number(),paymentIntentId:v.string(),refundId:v.string(),refundStatus:v.literal("succeeded"),amountPence:v.number(),refundAttemptedAt:v.number(),windows:v.array(v.object({itemId:v.string(),start:v.number(),end:v.number(),quantity:v.number()})) }) }) }),
  v.object({ operation: v.literal("releasePrepared"), args: v.object({ id: v.string(), fingerprint: v.string(), reason: v.union(v.literal("withdrawn_before_execution"), v.literal("abandoned_before_execution")) }) }),
);

export const send = internalAction({
  args: { request },
  handler: async (_ctx, args) => sendSharedStockRequest(args.request, {
    enabled: swapAuthorityAvailable() && process.env.SHARED_STOCK_BRIDGE_EXPERIMENTAL === "true",
    managerUrl: process.env.RMV2_WEBHOOK_URL,
    secret: process.env.SHARED_STOCK_WEBSITE_SECRET,
  }),
});
