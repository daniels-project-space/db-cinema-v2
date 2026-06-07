import { query, mutation } from "./_generated/server";
import { v } from "convex/values";

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
  heroImage: images(l)[0] ?? null,
  pricing: l.pricing,
  depositAmount: l.depositAmount,
  minimumRentalDays: l.minimumRentalDays ?? 1,
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
      rows = rows.filter((r) => r.active);
    } else {
      rows = await ctx.db
        .query("listings")
        .withIndex("by_active", (q) => q.eq("active", true))
        .collect();
    }
    if (search) {
      const s = search.toLowerCase();
      rows = rows.filter((r) => r.title.toLowerCase().includes(s));
    }
    rows.sort((a, b) => a.title.localeCompare(b.title));
    return rows.slice(0, limit ?? 120).map(card);
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
    if (!l || !l.active) return null;
    return {
      _id: l._id,
      slug: l.slug,
      title: l.title,
      category: l.category,
      heroImage: images(l)[0] ?? null,
      gallery: images(l),
      pricing: l.pricing,
      depositAmount: l.depositAmount,
      minimumRentalDays: l.minimumRentalDays ?? 1,
      unavailableDates: l.unavailableDates ?? [],
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
