import { effectiveLensSpecs } from "../shared/opticalFacts";
import { verifiedKitEvidence } from "./lib/compatibilityEvidence";
import { query, mutation, internalQuery } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";
import { v } from "convex/values";
import { paginationOptsValidator } from "convex/server";
import { quote } from "./lib/pricing";
import { weekendDays } from "../shared/membership";
import { listingImages } from "./lib/catalogImages";
import { isMarketingOnly, rentalUnavailable } from "./lib/marketingInventory";
import { alreadySupplied, automaticRecommendation } from "../shared/recommendationPolicy";
import { assertAdmin } from "./adminAuth";
import { createPublicListingCopy } from "./lib/publicListingCopy";
import { rentalPricingDays } from "../shared/rentalDuration";

/**
 * SERVER-AUTHORITATIVE line pricing for checkout (anti-tamper). Recomputes each line's
 * total + deposit from the REAL listing using the same quote() the storefront shows, so
 * a tampered cart (e.g. total:1) can't be billed. Legacy offerType markers are
 * accepted for saved baskets but no longer change prices. Returns null for a
 * missing/inactive listing.
 */
export const repriceLines = internalQuery({
  args: {
    undiscounted: v.optional(v.boolean()),
    items: v.array(
      v.object({
        listingId: v.id("listings"),
        start: v.number(),
        end: v.number(),
        pickupTime: v.optional(v.string()),
        returnTime: v.optional(v.string()),
        offerType: v.optional(v.string()),
      }),
    ),
  },
  handler: async (ctx, { items, undiscounted }) => {
    const listings = await Promise.all(items.map((it) => ctx.db.get(it.listingId)));

    const out: ({ title: string; total: number; deposit: number; dailyRate: number; ordinaryTotal:number; offerTotal:number;quietTotal:number; weekendSaving: number } | null)[] = [];
    items.forEach((it, idx) => {
      const l: any = listings[idx];
      if (!l || !l.active) { out.push(null); return; }
      const days = rentalPricingDays(it.start, it.end, it.pickupTime, it.returnTime);
      const q: any = quote(l.pricing, days);
      // automatic quiet-item discount (idle gear) — applied server-side so the charged price matches the badge
      const offerTotal=q.total,quietTotal=l.quietDeal?Math.round(q.total*(1-l.quietDeal/100)):q.total;
      const total=quietTotal;
      out.push({ title: l.title, total: undiscounted ? q.total : total, ordinaryTotal: total, offerTotal,quietTotal, deposit: l.depositAmount ?? 0, dailyRate: l.pricing.daily ?? 0, weekendSaving: weekendDays(it.start, it.end) ? Math.max(0, q.total - quote(l.pricing, days - 1).total) : 0 });
    });
    return out;
  },
});

/** Public catalog reads. heroImage/gallery prefer migrated R2 over source. */

const images = listingImages;

const card = (l: any) => ({
  _id: l._id,
  slug: l.slug,
  title: l.title,
  category: l.category,
  itemType: l.itemType ?? null,
  specs: effectiveLensSpecs(l),
  inventoryFacts: l.inventoryFacts ?? null,
  rentalContents: l.rentalContents ? { ...l.rentalContents } : null,
  verifiedComponentContents: l.verifiedComponentContents ?? [],
  components: l.components ?? [],
  tip: l.knowledge?.summary ?? null,
  heroImage: images(l)[0] ?? null,
  imageSources: images(l),
  pricing: l.pricing,
  depositAmount: l.depositAmount,
  minimumRentalDays: l.minimumRentalDays ?? 1,
  demandScore: l.demandScore ?? 0,
  marketingOnly: isMarketingOnly(l),
  quietDeal: l.quietDeal ?? null,
  displayOnly: !!l.suppressed && !isMarketingOnly(l),
});

const toPublicCards = async (ctx: any, rows: any[]) => {
  const decorate = createPublicListingCopy(ctx);
  return (await decorate(rows)).map(card);
};

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
    // 2026-07-07: ranking is driven by demandScore (authoritative RMv2 rental
    // history, refreshed by the applyDemand mutation) which DOMINATES the sort
    // (×10). The live site bookings + add-to-cart tie-breakers were removed — on
    // the homepage they forced a whole-`bookings` table scan + a full `events`
    // add_to_cart scan AND made this query re-run on every booking/cart write
    // (huge DB bandwidth for a ×5/×2 refinement). demandScore + base is stable.
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
      const score = (l.demandScore ?? 0) * 10 + base;
      return { l, score };
    });
    scored.sort((a, b) => b.score - a.score);
    return await toPublicCards(ctx, scored.slice(0, n).map((x) => x.l));
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
    return await toPublicCards(ctx, ls.filter((l) => set.has((l as any).itemType ?? "")));
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
    return await toPublicCards(ctx, rows.slice(0, limit ?? 500));
  },
});

/**
 * Bounded home-page search. Search uses a dedicated title index; when a brand
 * or model has no exact hit, category pages fall back to the most-requested
 * active listings in that category using a compound index.
 */
export const searchHomeGear = query({
  args: {
    search: v.string(),
    category: v.optional(v.string()),
  },
  handler: async (ctx, { search, category }) => {
    const normalized = search.trim().replace(/\s+/g, " ").slice(0, 96);
    if (!normalized) return { mode: "empty" as const, category: category ?? null, listings: [] };

    const words = normalized.toLowerCase().match(/[a-z0-9]+/g)?.slice(0, 12) ?? [];
    const categoryName = category?.trim() || undefined;
    const categoryKey = categoryName?.toLowerCase() ?? "";
    const ignoredCategoryWords = new Set(categoryKey.match(/[a-z0-9]+/g) ?? []);
    if (/camera|cinema|video/.test(categoryKey)) {
      ["camera", "cameras", "cam", "camcorder", "body", "bodies", "cinema", "video"].forEach((word) => ignoredCategoryWords.add(word));
    } else if (/lens|optic/.test(categoryKey)) {
      ["lens", "lenses", "prime", "zoom", "optics", "glass"].forEach((word) => ignoredCategoryWords.add(word));
    } else if (/light/.test(categoryKey)) {
      ["light", "lights", "lighting", "led", "tube"].forEach((word) => ignoredCategoryWords.add(word));
    } else if (/audio|sound/.test(categoryKey)) {
      ["audio", "sound", "mic", "mics", "microphone", "microphones"].forEach((word) => ignoredCategoryWords.add(word));
    } else if (/drone/.test(categoryKey)) {
      ["drone", "drones", "uav"].forEach((word) => ignoredCategoryWords.add(word));
    }

    const specificWords = words.filter((word) => !ignoredCategoryWords.has(word));
    const searchText = (specificWords.length ? specificWords : words).join(" ");
    let matching: Doc<"listings">[] = [];

    // A department-only request should browse its best gear, rather than
    // require the literal word "Audio" or "Cameras" in every product title.
    if (searchText && (!categoryName || specificWords.length > 0)) {
      let candidates = await ctx.db
        .query("listings")
        .withSearchIndex("search_title", (q) => {
          const searchFilter = q.search("title", searchText).eq("active", true);
          return categoryName ? searchFilter.eq("category", categoryName) : searchFilter;
        })
        .take(24);

      if (specificWords.length) {
        candidates = candidates.filter((listing) =>
          specificWords.some((word) => listing.title.toLowerCase().includes(word)),
        );
      }

      candidates.sort((a, b) => {
        const hits = (title: string) => words.filter((word) => title.toLowerCase().includes(word)).length;
        const titleRank = hits(b.title) - hits(a.title);
        return titleRank ||
          ((b as any).demandScore ?? 0) - ((a as any).demandScore ?? 0) ||
          a.title.localeCompare(b.title);
      });
      matching = candidates.slice(0, 4);
    }

    if (matching.length) {
      return {
        mode: "matches" as const,
        category: categoryName ?? matching[0].category,
        listings: await toPublicCards(ctx, matching),
      };
    }

    if (categoryName) {
      const alternatives = await ctx.db
        .query("listings")
        .withIndex("by_category_active_demand", (q) =>
          q.eq("category", categoryName).eq("active", true),
        )
        .order("desc")
        .take(4);
      return {
        mode: alternatives.length ? "category" as const : "empty" as const,
        category: categoryName,
        listings: await toPublicCards(ctx, alternatives),
      };
    }

    return { mode: "empty" as const, category: null, listings: [] };
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
    for (const id of new Set(ids)) {
      const l = await ctx.db.get(id);
      if (l && l.active) out.push(l);
    }
    return await toPublicCards(ctx, out);
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
    const [publicListing] = await createPublicListingCopy(ctx)([l]);
    return {
      _id: publicListing._id,
      slug: publicListing.slug,
      title: publicListing.title,
      category: publicListing.category,
      itemType: publicListing.itemType ?? null,
      specs: effectiveLensSpecs(publicListing),
      knowledge: publicListing.knowledge ?? null,
      description: publicListing.description ?? null,
      rentalContents: publicListing.rentalContents ?? null,
      verifiedComponentContents: publicListing.verifiedComponentContents ?? [],
      inventoryFacts: publicListing.inventoryFacts ?? null,
      components: publicListing.components ?? [],
      heroImage: images(publicListing)[0] ?? null,
      gallery: images(publicListing),
      pricing: publicListing.pricing,
      depositAmount: publicListing.depositAmount,
      minimumRentalDays: publicListing.minimumRentalDays ?? 1,
      unavailableDates: publicListing.unavailableDates ?? [],
      marketingOnly: isMarketingOnly(publicListing),
      displayOnly: !!publicListing.suppressed && !isMarketingOnly(publicListing),
      bookable: !rentalUnavailable(publicListing),
      demandScore: publicListing.demandScore ?? 0,
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
    const evidence = base.itemType === "camera-body" ? await verifiedKitEvidence(ctx) : [];
    const wanted = COMPLEMENTS[base.category] ?? ["Cameras", "Lenses"];
    const out: any[] = [];
    const perCat = Math.max(2, Math.ceil((limit ?? 6) / wanted.length));
    for (const cat of wanted) {
      const rows = await ctx.db
        .query("listings")
        .withIndex("by_category", (q) => q.eq("category", cat))
        .collect();
      const picks = rows
        .filter((r) => !rentalUnavailable(r) && r.slug !== slug && images(r).length > 0 && !alreadySupplied(r, [base]))
        .filter((r) => automaticRecommendation(r, [base], evidence))
        .sort((a, b) => (b.pricing?.daily ?? 0) - (a.pricing?.daily ?? 0))
        .slice(0, perCat);
      out.push(...picks);
    }
    return await toPublicCards(ctx, out.slice(0, limit ?? 6));
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
    token: v.string(),
    items: v.array(
      v.object({ slug: v.string(), r2Images: v.array(v.string()), replaceGallery:v.optional(v.boolean()) }),
    ),
  },
  handler: async (ctx, { token, items }) => {
    await assertAdmin(ctx, token, "catalog.applyR2Images");
    if (items.length > 100) throw Error("Image update batch limit is 100");
    let n = 0;
    for (const it of items) {
      const l = await ctx.db
        .query("listings")
        .withIndex("by_slug", (q) => q.eq("slug", it.slug))
        .first();
      if (l) {
        await ctx.db.patch(l._id, { r2Images: it.r2Images, ...(it.replaceGallery!==undefined?{reviewedImageUrls:it.replaceGallery?it.r2Images:undefined}:{}) });
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
    return await toPublicCards(ctx, withImg.slice(0, limit ?? 12));
  },
});

/** Public discovery projection: indexed, bounded pages, no customer or inventory data. */
export const discovery = query({
  args: { paginationOpts: paginationOptsValidator },
  handler: async (ctx, { paginationOpts }) => {
    if(paginationOpts.numItems>200)throw Error("Discovery page limit is 200");
    const page=await ctx.db.query("listings").withIndex("by_active",q=>q.eq("active",true)).paginate(paginationOpts);
    return {...page,page:page.page.filter(l=>!l.suppressed&&!rentalUnavailable(l)).map(l=>({
      slug:l.slug,title:l.title,category:l.category,image:images(l)[0]??null,
      lastModified:l.copyReview?.reviewedAt??l._creationTime,
    }))};
  },
});

/** Public physical pairing evidence; no customer or private inventory fields. */
export const compatibilityKits = query({ args: {}, handler: verifiedKitEvidence });
