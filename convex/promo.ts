import { query, mutation } from "./_generated/server";
import { v } from "convex/values";

/**
 * Validate a promo code against the ELIGIBLE subtotal (non-offer rental lines
 * only — offer items like the tripod/gimbal deals are excluded so codes never
 * stack on those discounts).
 */
export const validate = query({
  args: { code: v.string(), eligibleSubtotal: v.number() },
  handler: async (ctx, { code, eligibleSubtotal }) => {
    const norm = code.trim().toLowerCase();
    if (!norm) return { valid: false as const, reason: "empty" };
    const promo = await ctx.db
      .query("promo_codes")
      .withIndex("by_code", (q) => q.eq("code", norm))
      .first();
    if (!promo || !promo.active) return { valid: false as const, reason: "unknown code" };
    if (promo.expiry && promo.expiry < Date.now())
      return { valid: false as const, reason: "expired" };
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
