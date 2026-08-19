import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { checkAdminToken } from "./adminAuth";

/** Record a first-party event (views, funnel steps, zero-result searches). */
export const track = mutation({
  args: {
    type: v.string(),
    path: v.optional(v.string()),
    sessionId: v.optional(v.string()),
    listingId: v.optional(v.string()),
    title: v.optional(v.string()),
    qty: v.optional(v.number()),
  },
  handler: async (ctx, { type, path, sessionId, listingId, title, qty }) => {
    // lightweight hardening on this open endpoint: bound the payload so it can't be used
    // to inject huge/arbitrary rows that pollute analytics. Legit event names are short
    // slugs. (Full per-session/IP rate-limiting is a separate task.)
    if (typeof type !== "string" || type.length === 0 || type.length > 40 || !/^[a-z0-9_.:-]+$/i.test(type)) return;
    const p = typeof path === "string" ? path.slice(0, 200) : undefined;
    const s = typeof sessionId === "string" ? sessionId.slice(0, 80) : undefined;
    const li = typeof listingId === "string" ? listingId.slice(0, 60) : undefined;
    const t = typeof title === "string" ? title.slice(0, 120) : undefined;
    const q = typeof qty === "number" && qty > 0 ? Math.min(Math.round(qty), 99) : undefined;
    await ctx.db.insert("events", { type, path: p, sessionId: s, listingId: li, title: t, qty: q, at: Date.now() });
  },
});

const DAYMS = 86400000;

/** Add-to-cart demand: a daily time-series + the most-added items (incl. marketing-only,
 * since the cart logs every add). Powers the admin demand graph. */
export const cartDemand = query({
  args: { token: v.string(), days: v.optional(v.number()), now: v.number() },
  handler: async (ctx, { token, days, now }) => {
    if (!checkAdminToken(token)) {
      return { authorized: false as const, days: 0, total: 0, series: [], top: [] };
    }
    const D = Math.min(Math.max(days ?? 30, 7), 120);
    const since = now - D * DAYMS;
    // demand = add-to-cart (bookable items) + register-interest (display-only items)
    const ev = [
      ...await ctx.db.query("events").withIndex("by_type", (q) => q.eq("type", "add_to_cart")).collect(),
      ...await ctx.db.query("events").withIndex("by_type", (q) => q.eq("type", "register_interest")).collect(),
    ];
    const adds = ev.filter((e) => e.at >= since);

    // daily buckets, oldest → newest
    const series = Array.from({ length: D }, (_, i) => {
      const date = new Date(now - (D - 1 - i) * DAYMS).toISOString().slice(0, 10);
      return { date, count: 0, units: 0 };
    });
    const idx = new Map(series.map((s, i) => [s.date, i]));

    // per-item rollup (group by listingId, fall back to slug/title for legacy rows)
    const byItem = new Map<string, { listingId: string | null; title: string; adds: number; units: number; displayOnly: boolean }>();
    for (const e of adds) {
      const day = new Date(e.at).toISOString().slice(0, 10);
      const si = idx.get(day);
      const u = (e as any).qty ?? 1;
      if (si != null) { series[si].count += 1; series[si].units += u; }
      const id = (e as any).listingId || e.path || (e as any).title || "unknown";
      const cur = byItem.get(id) ?? { listingId: (e as any).listingId ?? null, title: (e as any).title || e.path || "(unknown item)", adds: 0, units: 0, displayOnly: false };
      cur.adds += 1; cur.units += u;
      if (e.type === "register_interest") cur.displayOnly = true;
      if ((e as any).title && (cur.title === "(unknown item)" || cur.title === e.path)) cur.title = (e as any).title;
      byItem.set(id, cur);
    }
    const top = [...byItem.values()].sort((a, b) => b.adds - a.adds).slice(0, 25);
    return { authorized: true as const, days: D, total: adds.length, series, top };
  },
});

/** Owner dashboard summary. `now` passed in (queries can't read the clock). */
export const adminSummary = query({
  args: { token: v.string(), now: v.number() },
  handler: async (ctx, { token, now }) => {
    if (!checkAdminToken(token))
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
