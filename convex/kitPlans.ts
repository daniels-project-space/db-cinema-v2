import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import {
  requireAccount,
  linesValid,
  dates,
  kitDetails,
  previewKit,
} from "./lib/kitPlanning";
import { ownedBooking } from "./lib/rentalChat";
const line = v.object({ listingId: v.id("listings"), qty: v.number() });
async function own(ctx: any, token: string, id: any) {
  const a = await requireAccount(ctx, token),
    p = await ctx.db.get(id);
  if (!p || p.accountId !== a._id) throw new Error("Shoot list not found.");
  return p;
}
export const list = query({
  args: { token: v.string() },
  handler: async (ctx, { token }) => {
    const a = await requireAccount(ctx, token);
    const plans = await ctx.db
      .query("kit_plans")
      .withIndex("by_account", (q) => q.eq("accountId", a._id))
      .order("desc")
      .take(100);
    return Promise.all(
      plans.map(async (p) => ({ ...p, items: await kitDetails(ctx, p.lines) })),
    );
  },
});
export const source = query({
  args: {
    token: v.optional(v.string()),
    planId: v.optional(v.id("kit_plans")),
    bookingId: v.optional(v.id("bookings")),
    shareKey: v.optional(v.string()),
  },
  handler: async (ctx, a) => {
    let p: any;
    if (a.shareKey) {
      p = await ctx.db
        .query("kit_plans")
        .withIndex("by_share", (q) => q.eq("shareKey", a.shareKey))
        .unique();
      if (!p) return null;
    } else if (a.planId && a.token) p = await own(ctx, a.token, a.planId);
    else if (a.bookingId && a.token) {
      const b = await ownedBooking(
        ctx,
        await requireAccount(ctx, a.token),
        a.bookingId,
      );
      p = {
        title: "Rent this kit again",
        lines: b.lineItems.map((l: any) => ({
          listingId: l.listingId,
          qty: l.qty,
        })),
      };
    } else return null;
    return {
      title: p.title,
      lines: p.lines,
      start: p.start ?? null,
      end: p.end ?? null,
      items: await kitDetails(ctx, p.lines),
    };
  },
});
export const preview = query({
  args: { lines: v.array(line), start: v.number(), end: v.number() },
  handler: async (ctx, a) => {
    try {
      return await previewKit(ctx, a.lines, a.start, a.end);
    } catch (e) {
      return {
        lines: [],
        available: false,
        issue: (e as Error).message,
        subtotal: 0,
      };
    }
  },
});
export const save = mutation({
  args: {
    token: v.string(),
    planId: v.optional(v.id("kit_plans")),
    title: v.string(),
    lines: v.array(line),
    start: v.optional(v.number()),
    end: v.optional(v.number()),
  },
  handler: async (ctx, a) => {
    const account = await requireAccount(ctx, a.token);
    linesValid(a.lines);
    const title = a.title.trim().slice(0, 80);
    if (!title) throw new Error("Name your shoot list.");
    if (a.start !== undefined || a.end !== undefined) dates(a.start!, a.end!);
    for (const l of a.lines)
      if (!(await ctx.db.get(l.listingId))) throw new Error("Item not found.");
    const data = {
      title,
      lines: a.lines,
      start: a.start,
      end: a.end,
      updatedAt: Date.now(),
    };
    if (a.planId) {
      await own(ctx, a.token, a.planId);
      await ctx.db.patch(a.planId, data);
      return a.planId;
    }
    const existing = await ctx.db
      .query("kit_plans")
      .withIndex("by_account", (q) => q.eq("accountId", account._id))
      .take(100);
    if (existing.length >= 100)
      throw new Error("You can save up to 100 shoot lists.");
    return ctx.db.insert("kit_plans", { ...data, accountId: account._id });
  },
});
export const share = mutation({
  args: { token: v.string(), planId: v.id("kit_plans"), enabled: v.boolean() },
  handler: async (ctx, a) => {
    await own(ctx, a.token, a.planId);
    const key = a.enabled
      ? Array.from(crypto.getRandomValues(new Uint8Array(24)), (b) =>
          b.toString(16).padStart(2, "0"),
        ).join("")
      : undefined;
    await ctx.db.patch(a.planId, { shareKey: key });
    return key ?? null;
  },
});
export const remove = mutation({
  args: { token: v.string(), planId: v.id("kit_plans") },
  handler: async (ctx, a) => {
    await own(ctx, a.token, a.planId);
    await ctx.db.delete(a.planId);
  },
});
