import { internalMutation, internalQuery } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import { rounds } from "./filmFund";

const openNow = (round: any, now: number) => round?.state === "open" && round.opensAt <= now && round.deadline >= now;

// A single durable invitation per consenting signup and round, including reopen/retry.
export const enqueue = internalMutation({
  args: { roundSlug: v.string(), cursor: v.union(v.string(), v.null()) },
  handler: async (ctx, args) => {
    const now = Date.now(), round = (await rounds(ctx)).find(r => r.slug === args.roundSlug);
    if (!openNow(round, now)) return;
    const page = await ctx.db.query("film_fund_signups").paginate({numItems: 100, cursor: args.cursor});
    for (const signup of page.page) {
      if (!signup.active) continue;
      const existing = await ctx.db.query("film_fund_announcements").withIndex("by_round_signup", q => q.eq("roundSlug", args.roundSlug).eq("signupId", signup._id)).unique();
      if (!existing) await ctx.db.insert("film_fund_announcements", {roundSlug: args.roundSlug, signupId: signup._id, state: "pending", dueAt: now, attempts: 0, createdAt: now});
      else if (existing.state === "stopped" && existing.attempts < 3) await ctx.db.patch(existing._id, {state: "pending", dueAt: now});
    }
    if (!page.isDone) await ctx.scheduler.runAfter(0, internal.filmFundAnnouncements.enqueue, {...args, cursor: page.continueCursor});
    await ctx.scheduler.runAfter(0, internal.filmFundNotifications.processOpeningAnnouncements, {});
  },
});

export const due = internalQuery({args: {}, handler: async ctx => {
  const now = Date.now();
  const pending = await ctx.db.query("film_fund_announcements").withIndex("by_state_due", q => q.eq("state", "pending").lte("dueAt", now)).take(20);
  const expired = await ctx.db.query("film_fund_announcements").withIndex("by_state_due", q => q.eq("state", "sending").lte("dueAt", now)).take(20);
  return [...pending, ...expired].map(row => row._id);
}});

export const claim = internalMutation({args: {id: v.id("film_fund_announcements")}, handler: async (ctx, {id}) => {
  const row = await ctx.db.get(id), now = Date.now();
  if (!row || !["pending", "sending"].includes(row.state) || row.dueAt > now || (row.leaseUntil ?? 0) > now) return null;
  const signup = await ctx.db.get(row.signupId), round = (await rounds(ctx)).find(r => r.slug === row.roundSlug);
  if (!signup?.active || !openNow(round, now) || row.attempts >= 3) {
    await ctx.db.patch(id, {state: "stopped", leaseUntil: undefined}); return null;
  }
  const leaseUntil = now + 60_000;
  await ctx.db.patch(id, {state: "sending", attempts: row.attempts + 1, leaseUntil, dueAt: leaseUntil});
  return {id, leaseUntil, email: signup.email, round: round!};
}});

export const finish = internalMutation({args: {id: v.id("film_fund_announcements"), leaseUntil: v.number(), sent: v.boolean()}, handler: async (ctx, args) => {
  const row = await ctx.db.get(args.id);
  if (!row || row.state !== "sending" || row.leaseUntil !== args.leaseUntil) return;
  await ctx.db.patch(row._id, {
    state: args.sent ? "sent" : row.attempts >= 3 ? "stopped" : "pending",
    ...(args.sent ? {sentAt: Date.now()} : {dueAt: Date.now() + 5 * 60_000 * 2 ** row.attempts}),
    leaseUntil: undefined,
  });
}});
