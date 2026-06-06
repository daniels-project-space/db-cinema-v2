"use node";

import Stripe from "stripe";
import { action } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";

function stripe() {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error("STRIPE_SECRET_KEY not set");
  return new Stripe(key);
}

/** Start a Stripe Identity (document + selfie) verification for a booking. */
export const createSession = action({
  args: { bookingId: v.id("bookings"), origin: v.string() },
  handler: async (ctx, { bookingId, origin }): Promise<{ url: string }> => {
    let vs;
    try {
      vs = await stripe().identity.verificationSessions.create({
        type: "document",
        metadata: { bookingId },
        return_url: `${origin}/verify/return?booking=${bookingId}`,
        options: { document: { require_matching_selfie: true } },
      });
    } catch (e: any) {
      throw new Error(
        e?.message?.includes("Identity")
          ? "Identity verification isn't enabled on the Stripe account yet."
          : (e?.message ?? "Could not start verification"),
      );
    }
    await ctx.runMutation(internal.bookings.setIdentity, {
      bookingId,
      sessionId: vs.id,
      status: "processing",
    });
    if (!vs.url) throw new Error("Stripe did not return a verification URL");
    return { url: vs.url };
  },
});

/** Re-check the verification status from Stripe and persist it. */
export const refresh = action({
  args: { bookingId: v.id("bookings") },
  handler: async (ctx, { bookingId }): Promise<{ status: string }> => {
    const id: any = await ctx.runQuery(internal.bookings.getIdentity, { bookingId });
    if (!id?.sessionId) return { status: id?.status ?? "required" };
    const vs = await stripe().identity.verificationSessions.retrieve(id.sessionId);
    await ctx.runMutation(internal.bookings.setIdentity, {
      bookingId,
      status: vs.status,
    });
    return { status: vs.status };
  },
});
