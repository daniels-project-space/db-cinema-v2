import { internalMutation, internalQuery } from "./_generated/server";
import { v } from "convex/values";

const DAY = 86400000;

/** Issue store credit to an account (90-day expiry). Returns the new credit id (or null). */
export const _issue = internalMutation({
  args: {
    accountId: v.id("accounts"),
    amount: v.number(),
    currency: v.string(),
    reason: v.string(),
    bookingId: v.optional(v.id("bookings")),
  },
  handler: async (ctx, a) => {
    if (a.amount <= 0) return null;
    const now = Date.now();
    return await ctx.db.insert("credits", {
      accountId: a.accountId,
      amount: a.amount,
      remaining: a.amount,
      currency: a.currency,
      reason: a.reason,
      bookingId: a.bookingId,
      createdAt: now,
      expiresAt: now + 90 * DAY,
      status: "active",
    });
  },
});

/** Daily cron: flip credits past their 90-day window to expired. */
export const expire = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const rows = await ctx.db
      .query("credits")
      .withIndex("by_status", (q) => q.eq("status", "active"))
      .collect();
    let n = 0;
    for (const c of rows) {
      if (c.expiresAt <= now) {
        await ctx.db.patch(c._id, { status: "expired" });
        n++;
      }
    }
    return { expired: n };
  },
});

/** Sum of active, non-expired credit remaining for an account (used at checkout redemption). */
export const _balance = internalQuery({
  args: { accountId: v.id("accounts") },
  handler: async (ctx, { accountId }) => {
    const now = Date.now();
    const rows = await ctx.db
      .query("credits")
      .withIndex("by_account", (q) => q.eq("accountId", accountId))
      .collect();
    return rows
      .filter((c) => c.status === "active" && c.expiresAt > now)
      .reduce((n, c) => n + c.remaining, 0);
  },
});
