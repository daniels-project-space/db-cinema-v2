import { query, mutation, internalQuery } from "./_generated/server";
import { v } from "convex/values";
import { quote } from "./lib/pricing";
import { OFFER_PCT_BY_TYPE } from "./offers";

/**
 * SERVER-AUTHORITATIVE line pricing for checkout (anti-tamper). Recomputes each line's
 * total + deposit from the REAL listing using the same quote() the storefront shows, so
 * a tampered cart (e.g. total:1) can't be billed. Offer lines only get a LEGIT contextual
 * discount for their itemType. Returns null for a missing/inactive listing.
 */
export const repriceLines = internalQuery({
  args: {
    items: v.array(
      v.object({
        listingId: v.id("listings"),
        start: v.number(),
        end: v.number(),
        offerType: v.optional(v.string()),
      }),
    ),
  },
  handler: async (ctx, { items }) => {
    const out: ({ total: number; deposit: number } | null)[] = [];
    for (const it of items) {
      const l: any = await ctx.db.get(it.listingId);
      if (!l || !l.active) { out.push(null); continue; }
      const days = Math.max(1, Math.round((it.end - it.start) / 86400000) + 1);
      const q: any = quote(l.pricing, days);
      let total = q.total;
      if (it.offerType) {
        const pct = OFFER_PCT_BY_TYPE[l.itemType ?? ""] ?? 0; // only a real offer pct, never client-forged
        if (pct > 0) total = Math.round(q.total * (1 - pct / 100));
      }
      // automatic quiet-item discount (idle gear) — applied server-side so the charged price matches the badge
      if (l.quietDeal) total = Math.round(total * (1 - l.quietDeal / 100));
      out.push({ total, deposit: l.depositAmount ?? 0 });
    }
    return out;
  },
});

/** Public catalog reads. heroImage/gallery prefer migrated R2 over source. */

function images(l: any): string[] {
  const r2 = l.r2Images ?? [];
  if (r2.length) return r2;
  return l.sourceImages ?? (l.gallery ?? []);
}

const card = (l: any) => ({
  _id: l._id,
  slug: l.slug,
  title: l.title,
  category: l.category,
  itemType: l.itemType ?? null,
  specs: l.specs ?? null,
  tip: l.knowledge?.summary ?? null,
  heroImage: images(l)[0] ?? null,
  pricing: l.pricing,
  depositAmount: l.depositAmount,
  minimumRentalDays: l.minimumRentalDays ?? 1,
  demandScore: l.demandScore ?? 0,
  quietDeal: l.quietDeal ?? null,
  displayOnly: !!l.suppressed, // marketing-only / display item — not bookable, "register interest" only
});

export const allBasic = query({
  args: {},
  handler: async (ctx) => {
    const ls = await ctx.db
      .query("listings")
      .withIndex("by_active", (q) => q.eq("active", true))
      .collect();
    return ls.map((l) => ({ _id: l._id, title: l.title }));
  },
});

export const bestSellers = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, { limit }) => {
    const n = limit ?? 6;
    // real demand signal: bookings + add-to-cart events
    const bookings = await ctx.db.query("bookings").collect();
    const bk = new Map<string, number>();
    for (const b of bookings) for (const li of b.lineItems) bk.set(li.listingId, (bk.get(li.listingId) ?? 0) + 1);
    const events = await ctx.db
      .query("events")
      .withIndex("by_type", (q) => q.eq("type", "add_to_cart"))
      .collect();
    const cartBySlug = new Map<string, number>();
    for (const e of events) if (e.path) cartBySlug.set(e.path, (cartBySlug.get(e.path) ?? 0) + 1);

    const ls = await ctx.db
      .query("listings")
      .withIndex("by_active", (q) => q.eq("active", true))
      .collect();
    const scored = ls.map((l: any) => {
      const t = (l.title || "").toLowerCase();
      let base = 0;
      if (l.category === "Packages") base += 3;
      if (l.itemType === "camera-body") base += 2;
      if (/fx3|fx6|a7s|a7 ?iii|a7iv|sony|burano|komodo|ronin/.test(t)) base += 2;
      if (/\bset\b|\bkit\b|bundle|package/.test(t)) base += 1;
      // REAL rental demand (RMv2 history, ~1,983 reservations) is the dominant signal so this
      // section truly shows "the kits crews fight over" — the actual top-rented gear — not a
      // heuristic. Site bookings + add-to-cart refine; the base only breaks ties.
      const score = (l.demandScore ?? 0) * 10 + (bk.get(l._id) ?? 0) * 5 + (cartBySlug.get(l.slug) ?? 0) * 2 + base;
      return { l, score };
    });
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, n).map((x) => card(x.l));
  },
});

export const byItemType = query({
  args: { types: v.array(v.string()) },
  handler: async (ctx, { types }) => {
    const set = new Set(types);
    const ls = await ctx.db
      .query("listings")
      .withIndex("by_active", (q) => q.eq("active", true))
      .collect();
    return ls.filter((l) => set.has((l as any).itemType ?? "")).map(card);
  },
});

export const listListings = query({
  args: {
    category: v.optional(v.string()),
    search: v.optional(v.string()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, { category, search, limit }) => {
    let rows;
    if (category && category !== "All") {
      rows = await ctx.db
        .query("listings")
        .withIndex("by_category", (q) => q.eq("category", category))
        .collect();
    } else {
      rows = await ctx.db.query("listings").collect();
    }
    // bookable items + display-only (marketing) items that have an image; hide truly-dead rows
    rows = rows.filter((r) => r.active || (r.suppressed && images(r).length > 0));
    if (search) {
      const s = search.toLowerCase();
      rows = rows.filter((r) => r.title.toLowerCase().includes(s));
    }
    rows.sort(
      (a, b) =>
        (a.suppressed ? 1 : 0) - (b.suppressed ? 1 : 0) || // display-only items sink to the bottom
        (b.quietDeal ? 1 : 0) - (a.quietDeal ? 1 : 0) || // idle "quiet deals" surface first
        ((b as any).demandScore ?? 0) - ((a as any).demandScore ?? 0) || // then by REAL rental demand (was alphabetical, which buried popular gear)
        a.title.localeCompare(b.title),
    );
    return rows.slice(0, limit ?? 500).map(card);
  },
});

// ── Set-aware idle detection → light "quiet deal" discount ────────────
// An item that's rented mostly inside SETS looks idle on its own demandScore but
// is actually busy. So we judge by the demand of its gear ANYWHERE (its model
// tokens appearing in any popular listing/bundle), not just its own bookings.
// Only the genuinely-idle few (capped) get a light discount + promotion.
// We compare items by their DISTINCTIVE gear tokens (model/focal — fx3, komodo,
// 24-70, x-t5), dropping brands, generic and spec words. That way a brand like
// "sony" (which appears in lots of busy listings) can't make a niche item look
// busy — only its actual model deciding whether the gear is rented elsewhere.
const QUIET_STOP = new Set([
  // generic
  "camera", "cameras", "lens", "lenses", "set", "sets", "kit", "kits", "bundle", "package", "with", "for", "the", "and", "pro", "full", "frame", "cinema", "mirrorless", "digital", "video", "professional", "new", "mark", "ii", "iii", "plus", "zoom", "prime", "wide", "mount", "rigged", "rig", "photography", "film", "content", "creator", "advanced", "basic", "portable", "powered", "capacity", "spare", "extra", "mini", "max", "ultra",
  // item-type words
  "monitor", "light", "lights", "tripod", "gimbal", "drone", "speaker", "speakers", "mic", "microphone", "recorder", "filter", "filters", "stand", "cage", "battery", "batteries", "charger", "card", "cards", "case", "bag", "pole",
  // brands
  "sony", "canon", "dji", "blackmagic", "bmpcc", "fujifilm", "fuji", "panasonic", "lumix", "nikon", "aputure", "godox", "nanlite", "amaran", "forza", "rode", "sennheiser", "deity", "atomos", "smallhd", "feelworld", "hollyland", "sigma", "tamron", "samyang", "rokinon", "zeiss", "tilta", "zhiyun", "moza", "pioneer", "jbl", "insta", "gopro", "osmo", "manfrotto", "sachtler", "dzo", "dzofilm", "blazar", "sirui", "laowa",
  // spec noise
  "4k", "6k", "8k", "2k", "1080p", "1080", "720", "fps", "60fps", "120fps", "2x", "3x", "4x", "5x", "6x", "8x", "gb", "tb", "ssd", "wah", "watt", "f2", "f4", "f28", "f18", "f14", "t1", "t2",
]);
function quietTokens(title: string): string[] {
  return [...new Set(
    String(title || "").toLowerCase().replace(/\bcannon\b/g, "canon").replace(/[^a-z0-9- ]/g, " ").split(/\s+/)
      .filter((w) => w.length >= 2 && !QUIET_STOP.has(w) && !/^\d{1,4}(gb|tb)?$/.test(w)),
  )];
}
export const refreshQuietDeals = mutation({
  args: {},
  handler: async (ctx) => {
    const QUIET_PCT = 10, MAX_QUIET = 10, POPULAR = 4, LOW_OWN = 1;
    const ls = await ctx.db.query("listings").withIndex("by_active", (q) => q.eq("active", true)).collect();
    // peak demand of each gear token across ALL listings (so set rentals count)
    const pop = new Map<string, number>();
    for (const l of ls) {
      const d = (l as any).demandScore ?? 0;
      for (const t of quietTokens(l.title)) pop.set(t, Math.max(pop.get(t) ?? 0, d));
    }
    // candidates: genuinely idle, not packages, not suppressed
    const cands = ls
      .filter((l) => !(l as any).suppressed && ((l as any).demandScore ?? 0) <= LOW_OWN && l.category !== "Packages")
      .map((l) => ({ l, peak: quietTokens(l.title).reduce((m, t) => Math.max(m, pop.get(t) ?? 0), 0) }))
      .filter((x) => x.peak < POPULAR); // gear not popular in ANY set → genuinely idle

    // keep ONLY items we genuinely have in inventory: every component must map to an active
    // unit the shop owns enough of — so phantom / marketing / display-only items, or kits we
    // can't fully assemble, never get a quiet discount.
    const ownedCands: typeof cands = [];
    for (const x of cands) {
      const comps = (((x.l as any).components ?? []) as Array<{ inventoryUnitId: any; qty: number }>);
      if (comps.length === 0) continue; // no inventory mapping → not really stocked
      let owned = true;
      for (const c of comps) {
        const u: any = await ctx.db.get(c.inventoryUnitId);
        if (!u || u.active === false || (u.quantityOwned ?? 0) < (c.qty || 1)) { owned = false; break; }
      }
      if (owned) ownedCands.push(x);
    }
    const idle = ownedCands
      .sort((a, b) => a.peak - b.peak || ((a.l as any).demandScore ?? 0) - ((b.l as any).demandScore ?? 0))
      .slice(0, MAX_QUIET);
    const chosen = new Set(idle.map((x) => x.l._id));

    // clear stale discounts EVERYWHERE (incl. inactive / suppressed / no-longer-owned) + set on chosen
    let set = 0, cleared = 0;
    const all = await ctx.db.query("listings").collect();
    for (const l of all) {
      const want = chosen.has(l._id) ? QUIET_PCT : undefined;
      if (((l as any).quietDeal ?? undefined) !== want) {
        await ctx.db.patch(l._id, { quietDeal: want } as any);
        want ? set++ : cleared++;
      }
    }
    return { discounted: set, cleared, scanned: ls.length, picks: idle.map((x) => x.l.title.slice(0, 50)) };
  },
});

export const allSlugs = query({
  args: {},
  handler: async (ctx) => {
    const ls = await ctx.db
      .query("listings")
      .withIndex("by_active", (q) => q.eq("active", true))
      .collect();
    return ls.map((l) => ({ slug: l.slug }));
  },
});

export const itemTypes = query({
  args: { ids: v.array(v.id("listings")) },
  handler: async (ctx, { ids }) => {
    const out: Record<string, string> = {};
    for (const id of ids) {
      const l = await ctx.db.get(id);
      if (l) out[id] = (l as any).itemType ?? "";
    }
    return out;
  },
});

export const listingsByIds = query({
  args: { ids: v.array(v.id("listings")) },
  handler: async (ctx, { ids }) => {
    const out: any[] = [];
    for (const id of ids) {
      const l = await ctx.db.get(id);
      if (l && l.active) out.push(card(l));
    }
    return out;
  },
});

export const getListingBySlug = query({
  args: { slug: v.string() },
  handler: async (ctx, { slug }) => {
    const l = await ctx.db
      .query("listings")
      .withIndex("by_slug", (q) => q.eq("slug", slug))
      .first();
    // bookable items + display-only (marketing) items; truly-dead rows 404
    if (!l || (!l.active && !l.suppressed)) return null;
    return {
      _id: l._id,
      slug: l.slug,
      title: l.title,
      category: l.category,
      itemType: l.itemType ?? null,
      specs: l.specs ?? null,
      knowledge: l.knowledge ?? null,
      heroImage: images(l)[0] ?? null,
      gallery: images(l),
      pricing: l.pricing,
      depositAmount: l.depositAmount,
      minimumRentalDays: l.minimumRentalDays ?? 1,
      unavailableDates: l.unavailableDates ?? [],
      displayOnly: !!l.suppressed,
      demandScore: l.demandScore ?? 0,
    };
  },
});

export const categories = query({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db
      .query("listings")
      .withIndex("by_active", (q) => q.eq("active", true))
      .collect();
    const counts = new Map<string, number>();
    for (const r of rows) counts.set(r.category, (counts.get(r.category) ?? 0) + 1);
    return Array.from(counts.entries())
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count);
  },
});

// ── Smart "complete your kit" recommendations ─────────────────
const COMPLEMENTS: Record<string, string[]> = {
  Cameras: ["Lenses", "Audio", "Monitors", "Power", "Stabilizers"],
  Lenses: ["Cameras", "Stabilizers", "Power"],
  Lighting: ["Grip", "Power", "Stabilizers"],
  Audio: ["Cameras", "Accessories"],
  Drones: ["Power", "Monitors", "Accessories"],
  Stabilizers: ["Cameras", "Lenses", "Power"],
  Monitors: ["Cameras", "Power", "Accessories"],
  Power: ["Cameras", "Lighting", "Monitors"],
  Grip: ["Lighting", "Cameras", "Stabilizers"],
  Accessories: ["Cameras", "Lenses", "Audio"],
};

export const recommendations = query({
  args: { slug: v.string(), limit: v.optional(v.number()) },
  handler: async (ctx, { slug, limit }) => {
    const base = await ctx.db
      .query("listings")
      .withIndex("by_slug", (q) => q.eq("slug", slug))
      .first();
    if (!base) return [];
    const wanted = COMPLEMENTS[base.category] ?? ["Cameras", "Lenses"];
    const out: any[] = [];
    const perCat = Math.max(2, Math.ceil((limit ?? 6) / wanted.length));
    for (const cat of wanted) {
      const rows = await ctx.db
        .query("listings")
        .withIndex("by_category", (q) => q.eq("category", cat))
        .collect();
      const picks = rows
        .filter((r) => r.active && r.slug !== slug && images(r).length > 0)
        .sort((a, b) => (b.pricing?.daily ?? 0) - (a.pricing?.daily ?? 0))
        .slice(0, perCat);
      out.push(...picks);
    }
    return out.slice(0, limit ?? 6).map(card);
  },
});

// ── R2 image migration helpers ────────────────────────────────
export const listForMigration = query({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db.query("listings").collect();
    return rows
      .filter(
        (l) =>
          (l.sourceImages?.length ?? 0) > 0 && (l.r2Images?.length ?? 0) === 0,
      )
      .map((l) => ({
        slug: l.slug,
        hyggloProductId: l.hyggloProductId ?? 0,
        sourceImages: l.sourceImages ?? [],
      }));
  },
});

export const applyR2Images = mutation({
  args: {
    items: v.array(
      v.object({ slug: v.string(), r2Images: v.array(v.string()) }),
    ),
  },
  handler: async (ctx, { items }) => {
    let n = 0;
    for (const it of items) {
      const l = await ctx.db
        .query("listings")
        .withIndex("by_slug", (q) => q.eq("slug", it.slug))
        .first();
      if (l) {
        await ctx.db.patch(l._id, { r2Images: it.r2Images });
        n++;
      }
    }
    return { updated: n };
  },
});

export const featured = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, { limit }) => {
    const rows = await ctx.db
      .query("listings")
      .withIndex("by_active", (q) => q.eq("active", true))
      .take(300);
    const withImg = rows.filter((r) => images(r).length > 0);
    withImg.sort((a, b) => (b.pricing?.daily ?? 0) - (a.pricing?.daily ?? 0));
    return withImg.slice(0, limit ?? 12).map(card);
  },
});
