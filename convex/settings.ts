import { query, mutation, internalMutation } from "./_generated/server";
import { v } from "convex/values";
import { assertAdmin, checkAdminToken } from "./adminAuth";

const DEFAULTS = {
  deliveryMarginPct: 10,
  deliveryMaxKm: 30,
  openingHours: "09:00–22:00, daily",
  acceptingOrders: true,
  googleReviewUrl: "",
  businessAddress: "",
  businessPhone: "",
};

function configFrom(d: any) {
  return {
    deliveryMarginPct: d?.deliveryMarginPct ?? DEFAULTS.deliveryMarginPct,
    deliveryMaxKm: d?.deliveryMaxKm ?? DEFAULTS.deliveryMaxKm,
    openingHours: d?.openingHours ?? DEFAULTS.openingHours,
    acceptingOrders: d?.acceptingOrders ?? DEFAULTS.acceptingOrders,
    googleReviewUrl: d?.googleReviewUrl ?? DEFAULTS.googleReviewUrl,
    businessAddress: d?.businessAddress ?? DEFAULTS.businessAddress,
    businessPhone: d?.businessPhone ?? DEFAULTS.businessPhone,
  };
}

/** Public config read (used by delivery, checkout, UI). Falls back to defaults. */
export const get = query({
  args: {},
  handler: async (ctx) => {
    const d = await ctx.db.query("settings").first();
    return configFrom(d);
  },
});

export const adminGet = query({
  args: { token: v.string() },
  handler: async (ctx, { token }) => {
    if (!checkAdminToken(token))
      return { authorized: false as const };
    const d = await ctx.db.query("settings").first();
    return { authorized: true as const, config: configFrom(d) };
  },
});

/**
 * Ops-only override write, for the CLI (`convex run settings:opsPatch '{...}'`).
 *
 * The stored row SHADOWS the DEFAULTS above — configFrom prefers it — so
 * changing a default in code does nothing while a stale value sits in the
 * database. The only other write path is adminUpdate, which needs ADMIN_TOKEN
 * and a browser. Internal, so it is unreachable from any client.
 */
export const opsPatch = internalMutation({
  args: {
    openingHours: v.optional(v.string()),
    acceptingOrders: v.optional(v.boolean()),
    businessAddress: v.optional(v.string()),
    businessPhone: v.optional(v.string()),
  },
  handler: async (ctx, patch) => {
    const existing = await ctx.db.query("settings").first();
    if (existing) await ctx.db.patch(existing._id, patch);
    else await ctx.db.insert("settings", { ...DEFAULTS, ...patch });
    return configFrom(await ctx.db.query("settings").first());
  },
});

export const adminUpdate = mutation({
  args: {
    token: v.string(),
    deliveryMarginPct: v.optional(v.number()),
    deliveryMaxKm: v.optional(v.number()),
    openingHours: v.optional(v.string()),
    acceptingOrders: v.optional(v.boolean()),
    googleReviewUrl: v.optional(v.string()),
    businessAddress: v.optional(v.string()),
    businessPhone: v.optional(v.string()),
  },
  handler: async (ctx, { token, ...patch }) => {
    await assertAdmin(ctx, token, "settings.adminUpdate");
    const existing = await ctx.db.query("settings").first();
    if (existing) await ctx.db.patch(existing._id, patch);
    else await ctx.db.insert("settings", { ...DEFAULTS, ...patch });
    return { ok: true };
  },
});
