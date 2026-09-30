"use node";

import { createHmac, timingSafeEqual } from "node:crypto";
import Stripe from "stripe";
import { action, internalAction } from "./_generated/server";
import { api, internal } from "./_generated/api";
import { v } from "convex/values";

const tokenPath = "/resources/accessTokens/sdk";

function config() {
  const appToken = process.env.SUMSUB_APP_TOKEN;
  const secret = process.env.SUMSUB_SECRET_KEY;
  const level = process.env.SUMSUB_LEVEL_NAME;
  if (!appToken || !secret || !level)
    throw new Error("Automatic verification is temporarily unavailable. Please contact us before paying.");
  const base = process.env.SUMSUB_API_URL ?? "https://api.sumsub.com";
  if (!/^https:\/\/api(?:\.[a-z]{2})?\.sumsub\.com$/.test(base))
    throw new Error("Invalid Sumsub API region");
  return { appToken, secret, level, base };
}

/** Issue a short-lived, booking-bound WebSDK token. The caller must own the booking
 * through an account session or the paid Stripe Checkout session. */
export const bookingToken = action({
  args: {
    bookingId: v.id("bookings"),
    accountToken: v.optional(v.string()),
    checkoutSessionId: v.optional(v.string()),
  },
  handler: async (ctx, a): Promise<{ token: string }> => {
    const cfg = config();
    const booking: any = await ctx.runQuery(internal.bookings.verificationAccess, { bookingId: a.bookingId });
    if (!booking || booking.verificationProvider !== "sumsub" || !["confirmed", "active"].includes(booking.status))
      throw new Error("This booking is not ready for verification.");
    let authorized = false;
    if (a.accountToken) {
      const acct: any = await ctx.runQuery(internal.accounts._byToken, { token: a.accountToken });
      authorized = !!acct && acct.email?.trim().toLowerCase() === booking.guestEmail?.trim().toLowerCase();
    }
    if (!authorized && a.checkoutSessionId) {
      const key = process.env.STRIPE_SECRET_KEY;
      if (!key) throw new Error("Payment service unavailable");
      const session = await new Stripe(key).checkout.sessions.retrieve(a.checkoutSessionId);
      authorized = session.payment_status === "paid" && session.metadata?.bookingId === a.bookingId;
    }
    if (!authorized) throw new Error("Please sign in to verify this booking.");

    const body = JSON.stringify({
      userId: `dbc-booking-${a.bookingId}`,
      levelName: cfg.level,
      ttlInSecs: 600,
      applicantIdentifiers: { email: booking.guestEmail },
    });
    const ts = Math.floor(Date.now() / 1000).toString();
    const sig = createHmac("sha256", cfg.secret).update(ts + "POST" + tokenPath + body).digest("hex");
    const res = await fetch(cfg.base + tokenPath, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "X-App-Token": cfg.appToken,
        "X-App-Access-Ts": ts,
        "X-App-Access-Sig": sig,
      },
      body,
    });
    if (!res.ok) throw new Error("Verification could not start. Please try again.");
    const json: { token?: string } = await res.json();
    if (!json.token) throw new Error("Verification provider did not return an access token.");
    return { token: json.token };
  },
});

/** Sumsub's SHA-256 digest covers the exact raw webhook bytes. Only a signed
 * applicant status event can alter the booking; browser SDK events are display-only. */
export const webhook = internalAction({
  args: { body: v.string(), digest: v.string(), algorithm: v.string() },
  handler: async (ctx, { body, digest, algorithm }): Promise<boolean> => {
    const secret = process.env.SUMSUB_WEBHOOK_SECRET;
    if (!secret || algorithm !== "HMAC_SHA256_HEX" || !/^[a-f0-9]{64}$/i.test(digest) || body.length > 1_000_000)
      return false;
    const expected = createHmac("sha256", secret).update(body).digest();
    const actual = Buffer.from(digest, "hex");
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return false;
    let event: any;
    try { event = JSON.parse(body); } catch { return false; }
    if (!["applicantReviewed", "applicantPending", "applicantOnHold"].includes(event.type)) return true;
    if (event.levelName !== process.env.SUMSUB_LEVEL_NAME) return false;
    const prefix = "dbc-booking-";
    if (typeof event.externalUserId !== "string" || !event.externalUserId.startsWith(prefix) || typeof event.applicantId !== "string")
      return false;
    const bookingId = event.externalUserId.slice(prefix.length);
    if (!bookingId) return false;
    const rawTime = event.createdAtMs ?? event.createdAt;
    if (typeof rawTime !== "string") return false;
    const eventAt = Date.parse(/[zZ]|[+-]\d{2}:?\d{2}$/.test(rawTime)
      ? rawTime : `${rawTime.replace(" ", "T")}Z`);
    if (!Number.isFinite(eventAt)) return false;
    const status = event.type === "applicantPending"
      ? "processing"
      : event.type === "applicantOnHold"
        ? "manual_review"
      : event.reviewResult?.reviewAnswer === "GREEN"
        ? "verified"
        : event.reviewResult?.reviewRejectType === "RETRY"
          ? "requires_input"
          : "rejected";
    // clientComment is private to the business and may contain sensitive details;
    // only moderationComment is intended for the applicant.
    const note = typeof event.reviewResult?.moderationComment === "string"
      ? event.reviewResult.moderationComment : undefined;
    try {
      return await ctx.runMutation(internal.bookings.setSumsubResult, {
        bookingId: bookingId as any,
        applicantId: event.applicantId,
        status,
        note,
        eventAt,
      });
    } catch { return false; }
  },
});
