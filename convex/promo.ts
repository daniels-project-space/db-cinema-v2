import { query, mutation } from "./_generated/server";
import { v } from "convex/values";
import { TIER_RANK } from "./lib/membership";

/**
 * Validate a promo code against the ELIGIBLE subtotal (non-offer rental lines
 * only — offer items like the tripod/gimbal deals are excluded so codes never
 * stack on those discounts).
 */
export const validate = query({
  args: {
    code: v.string(),
    eligibleSubtotal: v.number(),
    tier: v.optional(v.string()),
    membershipActive: v.optional(v.boolean()),
    email: v.optional(v.string()),
  },
  handler: async (ctx, { code, eligibleSubtotal, tier, membershipActive, email }) => {
    const norm = code.trim().toLowerCase();
    if (!norm) return { valid: false as const, reason: "empty" };
    const promo: any = await ctx.db
      .query("promo_codes")
      .withIndex("by_code", (q) => q.eq("code", norm))
      .first();
    if (!promo || !promo.active) return { valid: false as const, reason: "unknown code" };

    // tier gate: minTier ("pro" → Pro & Studio) or legacy memberOnly (any member)
    if (promo.minTier) {
      const ok = membershipActive && (TIER_RANK[tier ?? ""] ?? 0) >= (TIER_RANK[promo.minTier] ?? 0);
      if (!ok)
        return {
          valid: false as const,
          reason: promo.minTier === "pro" ? "Pro members only — upgrade to use this" : "members only",
        };
    } else if (promo.memberOnly && !membershipActive) {
      return { valid: false as const, reason: "members only — join to use this code" };
    }

    if (promo.expiry && promo.expiry < Date.now())
      return { valid: false as const, reason: "this offer has expired" };

    // per-account usage limits (one-time / once a month)
    if ((promo.onceOnly || promo.monthly) && email) {
      const e = email.trim().toLowerCase();
      const mine = (
        await ctx.db
          .query("promo_redemptions")
          .withIndex("by_email", (q) => q.eq("email", e))
          .collect()
      ).filter((r) => r.code === norm);
      if (promo.onceOnly && mine.length)
        return { valid: false as const, reason: "you've already used this one-time offer" };
      if (promo.monthly) {
        const mo = new Date(Date.now()).toISOString().slice(0, 7);
        if (mine.some((r) => new Date(r.at).toISOString().slice(0, 7) === mo))
          return { valid: false as const, reason: "once per month — already used this month" };
      }
    }

    if (promo.minSubtotal && eligibleSubtotal < promo.minSubtotal)
      return { valid: false as const, reason: `min spend £${promo.minSubtotal}` };
    const discount =
      promo.type === "percent"
        ? Math.round((eligibleSubtotal * promo.value) / 100)
        : Math.min(promo.value, eligibleSubtotal);
    return {
      valid: true as const,
      code: norm,
      type: promo.type,
      value: promo.value,
      discount,
    };
  },
});

export const seed = mutation({
  args: {},
  handler: async (ctx) => {
    const existing = await ctx.db
      .query("promo_codes")
      .withIndex("by_code", (q) => q.eq("code", "db15off"))
      .first();
    if (existing) return { seeded: false };
    await ctx.db.insert("promo_codes", {
      code: "db15off",
      type: "percent",
      value: 15,
      usedCount: 0,
      active: true,
    });
    return { seeded: true };
  },
});

function assertAdmin(token: string) {
  if (!process.env.ADMIN_TOKEN || token !== process.env.ADMIN_TOKEN)
    throw new Error("unauthorized");
}

export const adminList = query({
  args: { token: v.string() },
  handler: async (ctx, { token }) => {
    if (!process.env.ADMIN_TOKEN || token !== process.env.ADMIN_TOKEN)
      return { authorized: false as const, items: [] };
    const rows = await ctx.db.query("promo_codes").collect();
    return {
      authorized: true as const,
      items: rows.map((r) => ({
        _id: r._id,
        code: r.code,
        type: r.type,
        value: r.value,
        active: r.active,
        usedCount: r.usedCount,
        minSubtotal: r.minSubtotal ?? null,
      })),
    };
  },
});

export const adminCreate = mutation({
  args: {
    token: v.string(),
    code: v.string(),
    type: v.union(v.literal("percent"), v.literal("fixed")),
    value: v.number(),
    minSubtotal: v.optional(v.number()),
  },
  handler: async (ctx, { token, code, type, value, minSubtotal }) => {
    assertAdmin(token);
    const norm = code.trim().toLowerCase();
    if (!norm) throw new Error("code required");
    const existing = await ctx.db
      .query("promo_codes")
      .withIndex("by_code", (q) => q.eq("code", norm))
      .first();
    if (existing) throw new Error("code already exists");
    await ctx.db.insert("promo_codes", {
      code: norm,
      type,
      value,
      minSubtotal,
      usedCount: 0,
      active: true,
    });
    return { ok: true };
  },
});

export const adminToggle = mutation({
  args: { token: v.string(), id: v.id("promo_codes") },
  handler: async (ctx, { token, id }) => {
    assertAdmin(token);
    const p = await ctx.db.get(id);
    if (p) await ctx.db.patch(id, { active: !p.active });
  },
});

// ── Member-only offers (curated deals shown in gold frames) ──────────
export const memberOffers = query({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db.query("member_offers").collect();
    return rows
      .filter((r) => r.active)
      .map((r) => ({ _id: r._id, title: r.title, blurb: r.blurb, badge: r.badge, code: r.code }));
  },
});

export const adminListMemberOffers = query({
  args: { token: v.string() },
  handler: async (ctx, { token }) => {
    if (!process.env.ADMIN_TOKEN || token !== process.env.ADMIN_TOKEN)
      return { authorized: false as const, items: [] };
    const rows = await ctx.db.query("member_offers").collect();
    return {
      authorized: true as const,
      items: rows.map((r) => ({
        _id: r._id,
        title: r.title,
        blurb: r.blurb,
        badge: r.badge,
        code: r.code,
        active: r.active,
      })),
    };
  },
});

export const adminCreateMemberOffer = mutation({
  args: {
    token: v.string(),
    title: v.string(),
    blurb: v.string(),
    badge: v.string(),
    code: v.string(),
    type: v.union(v.literal("percent"), v.literal("fixed")),
    value: v.number(),
    minSubtotal: v.optional(v.number()),
    limit: v.optional(v.union(v.literal("monthly"), v.literal("once"))),
    expiryDays: v.optional(v.number()),
  },
  handler: async (ctx, { token, title, blurb, badge, code, type, value, minSubtotal, limit, expiryDays }) => {
    assertAdmin(token);
    const norm = code.trim().toLowerCase();
    if (!norm || !title.trim()) throw new Error("title and code required");
    // Pro+ exclusive, non-stacking, with a usage limit (default: once a month)
    const flags: any = {
      minTier: "pro",
      monthly: limit !== "once",
      onceOnly: limit === "once",
      expiry: expiryDays ? Date.now() + expiryDays * 86400000 : undefined,
    };
    const existing = await ctx.db
      .query("promo_codes")
      .withIndex("by_code", (q) => q.eq("code", norm))
      .first();
    if (!existing) {
      await ctx.db.insert("promo_codes", {
        code: norm,
        type,
        value,
        minSubtotal,
        usedCount: 0,
        active: true,
        ...flags,
      } as any);
    } else {
      await ctx.db.patch(existing._id, { active: true, ...flags } as any);
    }
    const offerDoc = {
      title: title.trim(),
      blurb: blurb.trim(),
      badge: badge.trim(),
      code: norm,
      active: true,
    };
    const existingOffer = (await ctx.db.query("member_offers").collect()).find(
      (o) => o.code === norm,
    );
    if (existingOffer) await ctx.db.patch(existingOffer._id, offerDoc);
    else await ctx.db.insert("member_offers", offerDoc);
    return { ok: true };
  },
});

export const adminToggleMemberOffer = mutation({
  args: { token: v.string(), id: v.id("member_offers") },
  handler: async (ctx, { token, id }) => {
    assertAdmin(token);
    const o = await ctx.db.get(id);
    if (o) await ctx.db.patch(id, { active: !o.active });
  },
});
