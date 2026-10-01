import { referralEligibility } from "./lib/referrals";
import { accountForToken } from "./lib/rentalChat";
import { query, mutation } from "./_generated/server";
import { v } from "convex/values";
import { TIER_RANK } from "./lib/membership";
import { assertAdmin, checkAdminToken } from "./adminAuth";
import { GAFFER_PRICE_CODE, gafferDiscount } from "./lib/gafferDiscount";

/**
 * Validate a promo code against the ELIGIBLE subtotal (non-offer rental lines
 * only — offer items like the tripod/gimbal deals are excluded so codes never
 * stack on those discounts).
 */
export const validate = query({
  args: {
    code: v.string(),
    token:v.optional(v.string()),
    eligibleSubtotal: v.number(),
    rentalSubtotal: v.optional(v.number()),
    tier: v.optional(v.string()),
    membershipActive: v.optional(v.boolean()),
    email: v.optional(v.string()),
  },
  handler: async (ctx, { code, token, eligibleSubtotal, rentalSubtotal, tier, membershipActive, email }) => {
    const norm = code.trim().toLowerCase();
    if (!norm) return { valid: false as const, reason: "empty" };
    if(norm.toUpperCase().startsWith("DBC-")){
      const account=token?await accountForToken(ctx,token):null,offer=await referralEligibility(ctx,account,norm);
      if(!offer.valid)return {valid:false as const,reason:offer.reason};
      return {valid:true as const,code:offer.code!,type:"fixed",value:10,discount:Math.min(10,rentalSubtotal??eligibleSubtotal),referral:true};
    }
    // Explicitly requested via Gaffer (or entered as a code), never automatic.
    // Checkout supplies its server-repriced totals; preview totals cannot authorise a charge.
    if (norm === GAFFER_PRICE_CODE) {
      const discount = gafferDiscount(rentalSubtotal ?? 0, eligibleSubtotal);
      if (!discount) return { valid: false as const, reason: "Rental subtotal must be above £400 with eligible items" };
      return { valid: true as const, code: norm, type: "percent", value: 10, discount };
    }
    const promo: any = await ctx.db
      .query("promo_codes")
      .withIndex("by_code", (q) => q.eq("code", norm))
      .first();
    if (!promo || !promo.active) return { valid: false as const, reason: "unknown code" };

    if (promo.minTier || promo.memberOnly) return {valid:false as const,reason:"Member coupons have been replaced by weekend deals and delivery benefits."};

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

export const adminList = query({
  args: { token: v.string() },
  handler: async (ctx, { token }) => {
    if (!checkAdminToken(token))
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
    await assertAdmin(ctx, token, "promo.adminCreate");
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
    await assertAdmin(ctx, token, "promo.adminToggle");
    const p = await ctx.db.get(id);
    if (p) await ctx.db.patch(id, { active: !p.active });
  },
});

// ── Member-only offers (curated deals shown in gold frames) ──────────
export const memberOffers = query({args:{},handler:async()=>[]});

export const adminListMemberOffers = query({
  args: { token: v.string() },
  handler: async (ctx, { token }) => {
    if (!checkAdminToken(token))
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
  handler: async (ctx, { token, title, blurb, badge, code, type, value, minSubtotal, limit, expiryDays }) => { await assertAdmin(ctx, token, "promo.adminCreateMemberOffer"); throw new Error("Member coupons have been replaced by automatic weekend and delivery benefits."); },
});

export const adminToggleMemberOffer = mutation({
  args: { token: v.string(), id: v.id("member_offers") },
  handler: async (ctx, { token, id }) => {
    await assertAdmin(ctx, token, "promo.adminToggleMemberOffer");
    const o = await ctx.db.get(id);
    if (o) await ctx.db.patch(id, { active: !o.active });
  },
});
