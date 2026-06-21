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

/** Start an ACCOUNT-level Stripe Identity check (crew / collective members) — the
 * same document+selfie flow renters use, with no manual review. */
export const createAccountSession = action({
  args: { token: v.string(), origin: v.string() },
  handler: async (ctx, { token, origin }): Promise<{ url: string }> => {
    const acct: any = await ctx.runQuery(internal.accounts._byToken, { token });
    if (!acct) throw new Error("Please sign in.");
    let vs;
    try {
      vs = await stripe().identity.verificationSessions.create({
        type: "document",
        metadata: { accountId: acct._id },
        return_url: `${origin}/verify/return?account=1`,
        options: { document: { require_matching_selfie: true } },
      });
    } catch (e: any) {
      throw new Error(
        e?.message?.includes("Identity")
          ? "Identity verification isn't enabled on the Stripe account yet."
          : (e?.message ?? "Could not start verification"),
      );
    }
    await ctx.runMutation(internal.accounts._setIdSession, { accountId: acct._id, sessionId: vs.id });
    if (!vs.url) throw new Error("Stripe did not return a verification URL");
    return { url: vs.url };
  },
});

/** Re-check an account's Stripe Identity status and mark it verified when cleared. */
export const refreshAccount = action({
  args: { token: v.string() },
  handler: async (ctx, { token }): Promise<{ status: string }> => {
    const acct: any = await ctx.runQuery(internal.accounts._byToken, { token });
    if (!acct) return { status: "required" };
    if (acct.idVerified) return { status: "verified" };
    if (!acct.idSessionId) return { status: "required" };
    const vs = await stripe().identity.verificationSessions.retrieve(acct.idSessionId);
    if (vs.status === "verified") await ctx.runMutation(internal.accounts._markIdVerified, { accountId: acct._id });
    return { status: vs.status };
  },
});
