import { query } from "./_generated/server";
import { v } from "convex/values";
import { COMPLEMENTS, type ItemType } from "./lib/taxonomy";

function images(l: any): string[] {
  const r2 = l.r2Images ?? [];
  if (r2.length) return r2;
  return l.sourceImages ?? l.gallery ?? [];
}
const card = (l: any) => ({
  _id: l._id,
  slug: l.slug,
  title: l.title,
  category: l.category,
  itemType: l.itemType ?? "accessory",
  heroImage: images(l)[0] ?? null,
  pricing: l.pricing,
  depositAmount: l.depositAmount,
  minimumRentalDays: l.minimumRentalDays ?? 1,
});

/**
 * "Frequently rented together" — uses the complement net keyed by itemType,
 * seeded from the listing being viewed AND everything already in the cart.
 */
export const forContext = query({
  args: {
    slug: v.optional(v.string()),
    cartListingIds: v.optional(v.array(v.id("listings"))),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, { slug, cartListingIds, limit }) => {
    const exclude = new Set<string>();
    const seedTypes: ItemType[] = [];

    if (slug) {
      const l = await ctx.db
        .query("listings")
        .withIndex("by_slug", (q) => q.eq("slug", slug))
        .first();
      if (l) {
        exclude.add(l._id);
        seedTypes.push((l.itemType ?? "accessory") as ItemType);
      }
    }
    for (const id of cartListingIds ?? []) {
      const l = await ctx.db.get(id);
      if (l) {
        exclude.add(id);
        seedTypes.push((l.itemType ?? "accessory") as ItemType);
      }
    }

    // wanted types in priority order (dedup, keep order)
    const wanted: ItemType[] = [];
    const seen = new Set<ItemType>();
    const seeds = seedTypes.length ? seedTypes : (["camera-body"] as ItemType[]);
    for (const s of seeds) {
      for (const c of COMPLEMENTS[s] ?? []) {
        if (!seen.has(c)) {
          seen.add(c);
          wanted.push(c);
        }
      }
    }
    if (wanted.length === 0) wanted.push("lens", "camera-body", "light");

    const all = await ctx.db
      .query("listings")
      .withIndex("by_active", (q) => q.eq("active", true))
      .collect();

    // bucket candidates by type
    const byType = new Map<string, any[]>();
    for (const l of all) {
      if (exclude.has(l._id)) continue;
      if (images(l).length === 0) continue;
      const t = l.itemType ?? "accessory";
      if (!wanted.includes(t as ItemType)) continue;
      (byType.get(t) ?? byType.set(t, []).get(t)!).push(l);
    }
    for (const arr of byType.values())
      arr.sort((a, b) => (b.pricing?.daily ?? 0) - (a.pricing?.daily ?? 0));

    // round-robin across wanted types for diversity
    const out: any[] = [];
    const lim = limit ?? 8;
    let added = true;
    let round = 0;
    while (out.length < lim && added) {
      added = false;
      for (const t of wanted) {
        const arr = byType.get(t);
        if (arr && arr[round]) {
          out.push(card(arr[round]));
          added = true;
          if (out.length >= lim) break;
        }
      }
      round++;
    }
    return out;
  },
});
