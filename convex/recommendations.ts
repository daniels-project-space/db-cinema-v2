import { verifiedKitEvidence } from "./lib/compatibilityEvidence";
import { listingImages as images } from "./lib/catalogImages";
import { query } from "./_generated/server";
import { v } from "convex/values";
import { COMPLEMENTS, type ItemType } from "./lib/taxonomy";
import { bestCompat, parseMounts } from "./lib/mount";
import { rentalUnavailable } from "./lib/marketingInventory";
import { alreadySupplied, automaticRecommendation, type RecommendationItem } from "../shared/recommendationPolicy";


const card = (l: any) => ({
  _id: l._id,
  slug: l.slug,
  title: l.title,
  category: l.category,
  itemType: l.itemType ?? "accessory",
  heroImage: images(l)[0] ?? null,
  imageSources: images(l),
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
    const selected: RecommendationItem[] = [];
    const seedTypes: ItemType[] = [];
    const camMounts = new Set<string>(); // mounts of any camera in the seed/cart — for lens compat

    if (slug) {
      const l = await ctx.db
        .query("listings")
        .withIndex("by_slug", (q) => q.eq("slug", slug))
        .first();
      if (l) {
        if(!cartListingIds?.includes(l._id))selected.push(l);
        exclude.add(l._id);
        seedTypes.push((l.itemType ?? "accessory") as ItemType);
        if (l.itemType === "camera-body") for (const m of parseMounts(l.specs?.mount)) camMounts.add(m);
      }
    }
    for (const id of cartListingIds ?? []) {
      const l = await ctx.db.get(id);
      if (l) {
        selected.push(l);
        exclude.add(id);
        seedTypes.push((l.itemType ?? "accessory") as ItemType);
        if (l.itemType === "camera-body") for (const m of parseMounts(l.specs?.mount)) camMounts.add(m);
      }
    }
    const cams = [...camMounts];

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

    // Read only the complementary item types needed for this seed/cart.
    // Every active listing has a materialized itemType (catalog sync defaults
    // missing source types to "accessory"), so the composite index preserves
    // the old in-memory fallback semantics without scanning unrelated listings.
    const evidence = wanted.includes("gimbal") ? await verifiedKitEvidence(ctx) : [];
    const candidatesByType = await Promise.all(
      wanted.map((type) => ctx.db
        .query("listings")
        .withIndex("by_active_itemType", (q) =>
          q.eq("active", true).eq("itemType", type),
        )
        .collect()),
    );

    // bucket candidates by type
    const byType = new Map<string, any[]>();
    for (const l of candidatesByType.flat()) {
      if (rentalUnavailable(l)) continue;
      if (exclude.has(l._id) || alreadySupplied(l, selected)) continue;
      if (!automaticRecommendation(l, selected, evidence)) continue;
      if (images(l).length === 0) continue;
      const t = l.itemType ?? "accessory";
      if (!wanted.includes(t as ItemType)) continue;
      // never recommend a lens that can't mount on the seed/cart camera at all
      if (t === "lens" && cams.length && l.specs?.mount && bestCompat(parseMounts(l.specs.mount), cams) === "incompatible") continue;
      (byType.get(t) ?? byType.set(t, []).get(t)!).push(l);
    }
    // rank each bucket by REAL rental demand first (what people actually take together),
    // then native-over-adapter glass, then day-rate — so we suggest popular, compatible gear.
    const rankScore = (l: any) => {
      let s = (l.demandScore ?? 0) * 10;
      if (l.itemType === "lens" && cams.length && l.specs?.mount) {
        const c = bestCompat(parseMounts(l.specs.mount), cams);
        s += c === "native" ? 50 : c === "adapter" ? 10 : 0;
      }
      return s;
    };
    for (const arr of byType.values())
      arr.sort((a, b) => rankScore(b) - rankScore(a) || (b.pricing?.daily ?? 0) - (a.pricing?.daily ?? 0));

    // round-robin across wanted types for diversity
    const out: any[] = [];
    const lim = Math.min(24, Math.max(0, Math.floor(limit ?? 8)));
    const chosen: any[] = [];
    const rounds = Math.max(0, ...[...byType.values()].map(rows => rows.length));
    for (let round = 0; round < rounds && out.length < lim; round++) {
      for (const t of wanted) {
        const candidate = byType.get(t)?.[round];
        if (!candidate || !automaticRecommendation(candidate, [...selected, ...chosen], evidence)) continue;
        chosen.push(candidate);
        out.push(card(candidate));
        if (out.length >= lim) break;
      }
    }
    return out;
  },
});
