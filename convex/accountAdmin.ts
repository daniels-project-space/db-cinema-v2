import { query, mutation } from "./_generated/server";
import { v } from "convex/values";
import { assertAdmin, checkAdminToken } from "./adminAuth";
import { membershipActiveNow, membershipTierFor } from "../shared/membership";

const level = v.union(v.literal("standard"), v.literal("plus"), v.literal("pro"), v.literal("studio"), v.literal("automatic"));
export const search = query({
  args: { token: v.string(), email: v.string() },
  handler: async (ctx, a) => {
    if (!checkAdminToken(a.token)) return { authorized: false, items: [], more: false };
    const prefix = a.email.trim().toLowerCase();
    if (prefix.length > 254) throw Error("Email search is too long.");
    const rows = prefix
      ? await ctx.db.query("accounts").withIndex("by_email", q => q.gte("email", prefix).lte("email", prefix + "\uffff")).take(51)
      : await ctx.db.query("accounts").order("desc").take(51);
    return { authorized: true, more: rows.length > 50, items: rows.slice(0, 50).map(a => ({
      id: a._id, email: a.email, name: a.name ?? "", createdAt: a.createdAt,
      tier: membershipActiveNow(a) ? membershipTierFor(a) ?? "standard" : "standard",
      override: a.adminMembershipTier ?? "automatic", blocked: a.blockedAt != null,
      blockedReason: a.blockedReason ?? "", hasSubscription: !!a.stripeSubscriptionId,
      subscriptionTier: a.membershipTier ?? null,
    })) };
  },
});
export const setLevel = mutation({
  args: { token: v.string(), accountId: v.id("accounts"), level, reason: v.string() },
  handler: async (ctx, a) => {
    await assertAdmin(ctx, a.token, "accountAdmin.setLevel");
    const account = await ctx.db.get(a.accountId);
    if (!account) throw Error("Account no longer exists.");
    const reason = a.reason.trim();
    if (!reason || reason.length > 500) throw Error("Add a reason of up to 500 characters.");
    if (account.adminMembershipTier === a.level || (!account.adminMembershipTier && a.level === "automatic")) return;
    await ctx.db.patch(account._id, { adminMembershipTier: a.level === "automatic" ? undefined : a.level });
    await ctx.db.insert("account_admin_changes", { accountId: account._id, at: Date.now(), kind: "level", before: account.adminMembershipTier ?? "automatic", after: a.level, reason });
  },
});
export const setBlocked = mutation({
  args: { token: v.string(), accountId: v.id("accounts"), blocked: v.boolean(), reason: v.string() },
  handler: async (ctx, a) => {
    await assertAdmin(ctx, a.token, "accountAdmin.setBlocked");
    const account = await ctx.db.get(a.accountId);
    if (!account) throw Error("Account no longer exists.");
    const reason = a.reason.trim();
    if (!reason || reason.length > 500) throw Error("Add a reason of up to 500 characters.");
    if ((account.blockedAt != null) === a.blocked) return;
    await ctx.db.patch(account._id, { blockedAt: a.blocked ? Date.now() : undefined, blockedReason: a.blocked ? reason : undefined });
    if (a.blocked) {
      for (const session of await ctx.db.query("sessions").withIndex("by_account", q => q.eq("accountId", account._id)).collect()) await ctx.db.delete(session._id);
      for (const link of await ctx.db.query("account_access_links").withIndex("by_account", q => q.eq("accountId", account._id)).collect()) await ctx.db.delete(link._id);
    }
    await ctx.db.insert("account_admin_changes", { accountId: account._id, at: Date.now(), kind: a.blocked ? "block" : "unblock", before: account.blockedAt != null ? "blocked" : "active", after: a.blocked ? "blocked" : "active", reason });
  },
});
export const history = query({
  args: { token: v.string(), accountId: v.id("accounts") },
  handler: async (ctx, a) => checkAdminToken(a.token)
    ? ctx.db.query("account_admin_changes").withIndex("by_account", q => q.eq("accountId", a.accountId)).order("desc").take(10)
    : [],
});
