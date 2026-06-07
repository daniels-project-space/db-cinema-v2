import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

/** Record a first-party event (views, funnel steps, zero-result searches). */
export const track = mutation({
  args: {
    type: v.string(),
    path: v.optional(v.string()),
    sessionId: v.optional(v.string()),
  },
  handler: async (ctx, { type, path, sessionId }) => {
    await ctx.db.insert("events", { type, path, sessionId, at: Date.now() });
  },
});

/** Owner dashboard summary. `now` passed in (queries can't read the clock). */
export const adminSummary = query({
  args: { token: v.string(), now: v.number() },
  handler: async (ctx, { token, now }) => {
    if (!process.env.ADMIN_TOKEN || token !== process.env.ADMIN_TOKEN)
      return { authorized: false as const };

    const DAY = 86400000;
    const events = await ctx.db.query("events").collect();
    const in24 = events.filter((e) => e.at >= now - DAY);
    const in7 = events.filter((e) => e.at >= now - 7 * DAY);

    const count = (arr: typeof events, t: string) => arr.filter((e) => e.type === t).length;
    const views24 = count(in24, "view");
    const carts24 = count(in24, "add_to_cart");
    const checkouts24 = count(in24, "checkout_start");
    const purchases24 = count(in24, "purchase");

    // live viewers: distinct sessions with a view in last 15 min
    const live = new Set(
      events
        .filter((e) => e.type === "view" && e.at >= now - 15 * 60000 && e.sessionId)
        .map((e) => e.sessionId),
    ).size;

    // top pages (24h) + zero-result searches (7d)
    const pageCounts = new Map<string, number>();
    for (const e of in24) if (e.type === "view" && e.path) pageCounts.set(e.path, (pageCounts.get(e.path) ?? 0) + 1);
    const topPages = [...pageCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6);
    const searchMisses = new Map<string, number>();
    for (const e of in7) if (e.type === "search_no_results" && e.path) searchMisses.set(e.path, (searchMisses.get(e.path) ?? 0) + 1);
    const topMisses = [...searchMisses.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);

    // ongoing rentals: confirmed/active bookings spanning now
    const confirmed = await ctx.db
      .query("bookings")
      .withIndex("by_status", (q) => q.eq("status", "confirmed"))
      .collect();
    const active = await ctx.db
      .query("bookings")
      .withIndex("by_status", (q) => q.eq("status", "active"))
      .collect();
    const ongoing = [...confirmed, ...active]
      .filter((b) => {
        const s = Math.min(...b.lineItems.map((li) => li.start));
        const e = Math.max(...b.lineItems.map((li) => li.end));
        return s <= now + DAY && e >= now - DAY; // around now (±1d window)
      })
      .map((b) => ({
        _id: b._id,
        guestEmail: b.guestEmail,
        status: b.status,
        start: Math.min(...b.lineItems.map((li) => li.start)),
        end: Math.max(...b.lineItems.map((li) => li.end)),
        total: b.total,
        items: b.lineItems.map((li) => li.title).join(", "),
        fulfilment: b.fulfilment,
      }))
      .sort((a, b) => a.start - b.start);

    return {
      authorized: true as const,
      live,
      views24,
      views7: count(in7, "view"),
      carts24,
      checkouts24,
      purchases24,
      conversion: views24 > 0 ? Math.round((purchases24 / views24) * 1000) / 10 : 0,
      topPages,
      topMisses,
      ongoing,
    };
  },
});
