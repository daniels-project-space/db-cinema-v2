import { creditDebit,usableCredit } from "./lib/creditLedger";
import { internalMutation, internalQuery } from "./_generated/server";
import { v } from "convex/values";

import { CANCELLATION_CREDIT_DAYS } from "../src/lib/cancellationPolicy";

const DAY = 86400000;

/** Issue store credit to an account (one-year expiry). Returns the new credit id (or null). */
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
      expiresAt: now + CANCELLATION_CREDIT_DAYS * DAY,
      status: "active",
    });
  },
});

/** Daily cron: flip credits past their one-year window to expired. */
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
        const account = await ctx.db.get(c.accountId);
        if (account) {
          const pending = await ctx.db.query("bookings")
            .withIndex("by_guestEmail", (q) => q.eq("guestEmail", account.email))
            .collect();
          // A checkout can reserve a credit just before expiry. Keep it
          // redeemable until Stripe's paid/expired outcome is reconciled.
          if (pending.some((b) => b.status === "pending_payment" && (b.creditApplied ?? 0) > 0 &&
            b._creationTime < c.expiresAt)) continue;
        }
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
      .reduce((n, c) => n + usableCredit(c), 0);
  },
});

/** Decrement `amount` of store credit from an account (soonest-expiry first). Returns how much
 *  was actually redeemed. Called on booking confirm for credit applied at checkout. */
export const redeem = internalMutation({
  args: { accountId: v.id("accounts"), amount: v.number() },
  handler: async (ctx, { accountId, amount }) => {
    if (amount <= 0) return { redeemed: 0 };
    const now = Date.now();
    const rows = (
      await ctx.db.query("credits").withIndex("by_account", (q) => q.eq("accountId", accountId)).collect()
    )
      .filter((c) => c.status === "active" && c.expiresAt > now && c.remaining > 0)
      .sort((a, b) => a.expiresAt - b.expiresAt);
    let need = amount;
    let used = 0;
    for (const c of rows) {
      if (need <= 0) break;
      const take = Math.min(usableCredit(c), need);
      const debit = creditDebit(c,take);
      await ctx.db.patch(c._id, debit.patch);
      need -= take;
      used += take;
    }
    return { redeemed: used };
  },
});
