"use node";
import Stripe from "stripe";
import { action } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import { providerReviewGate } from "./reviewFollowUp";
import { customerReviewGate, reviewSettlementFingerprint } from "./lib/reviewEligibility";

/** Provider reads only; authorizes the native form, never sends mail or moves funds. */
export const checkEligibility = action({
  args: { token: v.string(), bookingId: v.id("bookings") },
  handler: async (ctx, args): Promise<{ eligible: boolean }> => {
    const b = await ctx.runQuery(internal.reviewInvitations.ownedContext, args);
    let reason = customerReviewGate(b);
    if (!reason) {
      if (!process.env.STRIPE_SECRET_KEY) throw Error("Security settlement checks are temporarily unavailable.");
      reason = await providerReviewGate(b, new Stripe(process.env.STRIPE_SECRET_KEY));
    }
    const eligible = await ctx.runMutation(internal.reviewInvitations.recordEligibility, {
      bookingId: args.bookingId, fingerprint: reviewSettlementFingerprint(b), eligible: !reason,
    });
    return { eligible };
  },
});
