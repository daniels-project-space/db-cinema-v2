import { creditDebit,usableCredit } from "./lib/creditLedger";
import { internalMutation, internalQuery } from "./_generated/server";
import { v } from "convex/values";
import {internal} from "./_generated/api";

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
    const state=await ctx.db.query("credit_expiry_state").withIndex("by_key",q=>q.eq("key","active-expiry")).unique();
    // Native cursors belong to one exact index range. Hold its cutoff across
    // continuations; a moving Date.now() bound would invalidate later pages.
    const continuing=state?.cursor!=null&&state.cutoffAt!==undefined;
    const cutoffAt=continuing?state.cutoffAt!:now;
    const page=await ctx.db.query("credits").withIndex("by_status_expiry",q=>q.eq("status","active").lte("expiresAt",cutoffAt)).paginate({numItems:100,cursor:continuing?state.cursor:null});
    let n=0;
    for(const c of page.page){
      const account=await ctx.db.get(c.accountId);
      const [linked,legacy]=account?await Promise.all([
        ctx.db.query("bookings").withIndex("by_account_status",q=>q.eq("accountId",c.accountId).eq("status","pending_payment")).take(101),
        ctx.db.query("bookings").withIndex("by_guestEmail_status",q=>q.eq("guestEmail",account.email).eq("status","pending_payment")).take(101),
      ]):[[],[]];
      if(linked.length>100||legacy.length>100)continue;
      const pending=[...linked,...legacy.filter(b=>b.accountId==null)];
      const reserved=pending.some(b=>b._creationTime<c.expiresAt&&(b.creditAllocations?b.creditAllocations.some(a=>a.creditId===c._id&&a.amount>0):((b.creditApplied??0)-(b.membershipCreditApplied??0))>0));
      if(reserved)continue;
      await ctx.db.patch(c._id,{status:"expired"});n++;
    }
    const progress={key:"active-expiry",cursor:page.isDone?null:page.continueCursor,cutoffAt:page.isDone?undefined:cutoffAt,updatedAt:now};
    if(state)await ctx.db.patch(state._id,progress);else await ctx.db.insert("credit_expiry_state",progress);
    if(!page.isDone)await ctx.scheduler.runAfter(0,internal.credits.expire,{});

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
