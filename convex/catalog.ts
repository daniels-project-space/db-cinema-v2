import { effectiveLensSpecs } from "../shared/opticalFacts";
import { selectHomeFeaturedListings } from "../shared/homeFeaturedListings";
import { verifiedKitEvidence } from "./lib/compatibilityEvidence";
import { query, mutation, internalQuery, internalMutation } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";
import { v } from "convex/values";
import { paginationOptsValidator } from "convex/server";
import { quote } from "./lib/pricing";
import { repriceRentalLines } from "./lib/catalogPricing";
import { listingImages } from "./lib/catalogImages";
import { isMarketingOnly, rentalUnavailable } from "./lib/marketingInventory";
import { isPubliclyBookable } from "./lib/bookability";
import { alreadySupplied, automaticRecommendation } from "../shared/recommendationPolicy";
import { assertAdmin, checkAdminToken } from "./adminAuth";
import { createPublicListingCopy } from "./lib/publicListingCopy";
import { bumpCatalogRevision, catalogRevision } from "./lib/catalogRevision";
import { normalizeEquipmentName } from "../shared/equipmentIdentity";

/**
 * SERVER-AUTHORITATIVE line pricing for checkout (anti-tamper). Recomputes each line's
 * total + deposit from the REAL listing using the same quote() the storefront shows, so
 * a tampered cart (e.g. total:1) can't be billed. Legacy offerType markers are
 * accepted for saved baskets but no longer change prices. Returns null for a
 * missing/inactive listing.
 */
export const repriceLines = internalQuery({
  args: {
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
  handler: (ctx, { items }) => repriceRentalLines(ctx, items),
});

/** Public catalog reads. heroImage/gallery prefer migrated R2 over source. */

const images = listingImages;
const publicVisible = (listing: { title: string; active?: boolean; suppressed?: boolean; itemType?: string | null; marketingOnly?: boolean; marketingOnlySource?: "auto" | "admin" | "rental_manager" }) =>
  !!listing.active && !listing.suppressed;
export const publicRevision = query({ args: {}, handler: async ctx => `v2:${await catalogRevision(ctx)}` });

const card = (l: any) => ({
  _id: l._id,
  slug: l.slug,
  title: l.title,
  category: l.category,
  itemType: l.itemType ?? null,
  isPackage: l.isPackage ?? l.category === "Packages",
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
  bookable: isPubliclyBookable(l),
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
    return ls.filter(publicVisible).map((l) => ({ _id: l._id, title: l.title }));
  },
});

export const bestSellers = query({
  args: { limit: v.optional(v.number()), homeShowcase: v.optional(v.boolean()) },
  handler: async (ctx, { limit, homeShowcase }) => {
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
    const scored = ls.filter(publicVisible).map((l: any) => {
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
    const rankedListings = scored.map((x) => x.l);
    const selected = homeShowcase ? selectHomeFeaturedListings(rankedListings, n) : rankedListings.slice(0, n);
    return await toPublicCards(ctx, selected);
  },
});

const MAX_GAFFER_CANDIDATES_PER_TYPE = 500;

export const adminListListings = query({
  args: { token: v.string(), search: v.optional(v.string()), paginationOpts: paginationOptsValidator },
  handler: async (ctx, { token, search, paginationOpts }) => {
    if (!checkAdminToken(token)) throw Error("Unauthorized");
    if (!Number.isSafeInteger(paginationOpts.numItems) || paginationOpts.numItems < 1 || paginationOpts.numItems > 100) throw Error("Invalid page size");
    const term = search?.trim().slice(0, 96).split(/\s+/).slice(0, 16).join(" ");
    const page = term
      ? await ctx.db.query("listings").withSearchIndex("search_title", q => q.search("title", term)).paginate(paginationOpts)
      : await ctx.db.query("listings").withIndex("by_active", q => q).order("desc").paginate(paginationOpts);
    const rows = page.page.filter(row => row.active || (row.suppressed && images(row).length > 0));
    return { ...page, page: await toPublicCards(ctx, rows) };
  },
});

async function listingsForTypes(ctx: any, types: string[]) {
    const unique = [...new Set(types)];
    if (unique.length > 50) throw new Error("Too many equipment types requested");
    const groups = await Promise.all(unique.map(type => ctx.db.query("listings")
      .withIndex("by_active_itemType", (q: any) => q.eq("active", true).eq("itemType", type as any))
      .take(MAX_GAFFER_CANDIDATES_PER_TYPE + 1)));
    if (groups.some((rows: any[]) => rows.length > MAX_GAFFER_CANDIDATES_PER_TYPE)) {
      throw new Error("The live catalogue exceeds the safe quote-candidate limit for an equipment type");
    }
    return groups.flat().sort((a: any,b: any) => a._creationTime - b._creationTime);
}

export const byItemType = query({
  args: { types: v.array(v.string()) },
  handler: async (ctx, { types }) => toPublicCards(ctx, (await listingsForTypes(ctx, types)).filter(publicVisible)),
});

export const byItemTypeInternal = internalQuery({
  args: { types: v.array(v.string()) },
  handler: async (ctx, { types }) => toPublicCards(ctx, await listingsForTypes(ctx, types)),
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
    rows = rows.filter(publicVisible);
    if (search) {
      const s = search.toLowerCase();
      rows = rows.filter((r) => r.title.toLowerCase().includes(s));
    }
    rows.sort(
      (a, b) =>
        (a.suppressed ? 1 : 0) - (b.suppressed ? 1 : 0) || // display-only items sink to the bottom
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
      const candidates: Doc<"listings">[] = [];
      const requiredTitleWords = normalizeEquipmentName(specificWords.join(" ")).match(/[a-z0-9]+/g) ?? [];
      let scanned = 0, searchLimited = false;
      const search = ctx.db
        .query("listings")
        .withSearchIndex("search_title", (q) => {
          const searchFilter = q.search("title", searchText).eq("active", true);
          return categoryName ? searchFilter.eq("category", categoryName) : searchFilter;
        });
      for await (const listing of search) {
        if (++scanned > 100) { searchLimited = true; break; }
        const titleWords = normalizeEquipmentName(listing.title).match(/[a-z0-9]+/g) ?? [];
        const hasEveryRequestedWord = requiredTitleWords.every(word => titleWords.some(titleWord =>
          titleWord === word || (/^\d+$/.test(word) && titleWord.startsWith(word)),
        ));
        if (publicVisible(listing) && hasEveryRequestedWord) candidates.push(listing);
        if (candidates.length >= 24) break;
      }

      candidates.sort((a, b) => {
        const hits = (title: string) => words.filter((word) => title.toLowerCase().includes(word)).length;
        const titleRank = hits(b.title) - hits(a.title);
        return titleRank ||
          ((b as any).demandScore ?? 0) - ((a as any).demandScore ?? 0) ||
          a.title.localeCompare(b.title);
      });
      matching = candidates.slice(0, 8);
      if (!matching.length && searchLimited) throw Error("Too many search matches. Refine your search.");
    }

    if (matching.length) {
      return {
        mode: "matches" as const,
        category: categoryName ?? matching[0].category,
        listings: await toPublicCards(ctx, matching),
      };
    }

    if (categoryName && specificWords.length === 0) {
      const candidates = ctx.db
        .query("listings")
        .withIndex("by_category_active_demand", (q) =>
          q.eq("category", categoryName).eq("active", true),
        )
        .order("desc");
      const alternatives: Doc<"listings">[] = [];
      let scanned = 0, searchLimited = false;
      for await (const candidate of candidates) {
        if (++scanned > 100) { searchLimited = true; break; }
        if (publicVisible(candidate)) alternatives.push(candidate);
        if (alternatives.length >= 4) break;
      }
      if (!alternatives.length && searchLimited) throw Error("Too many category results. Refine your search.");
      return {
        mode: alternatives.length ? "category" as const : "empty" as const,
        category: categoryName,
        listings: await toPublicCards(ctx, alternatives),
      };
    }

    return { mode: "empty" as const, category: null, listings: [] };
  },
});

export const allSlugs = query({
  args: {},
  handler: async (ctx) => {
    const ls = await ctx.db
      .query("listings")
      .withIndex("by_active", (q) => q.eq("active", true))
      .collect();
    return ls.filter(publicVisible).map((l) => ({ slug: l.slug }));
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
      if (l && publicVisible(l)) out.push(l);
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
    if (!l || !publicVisible(l)) return null;
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
      bookable: isPubliclyBookable(publicListing),
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
    for (const r of rows.filter(publicVisible)) counts.set(r.category, (counts.get(r.category) ?? 0) + 1);
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
  args: { token: v.optional(v.string()) },
  handler: async (ctx, { token }) => {
    const includeHidden = !!token && checkAdminToken(token);
    const rows = await ctx.db.query("listings").collect();
    return rows
      .filter(
        (l) =>
          (includeHidden || publicVisible(l)) &&
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
    if (n) await bumpCatalogRevision(ctx);
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
    const withImg = rows.filter((r) => publicVisible(r) && images(r).length > 0);
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
    return {...page,page:page.page.filter(isPubliclyBookable).map(l=>({
      slug:l.slug,title:l.title,category:l.category,image:images(l)[0]??null,
      lastModified:l.copyReview?.reviewedAt??l._creationTime,
    }))};
  },
});

export const discoveryOffers = query({
  args: { slugs: v.array(v.string()) },
  handler: async (ctx, { slugs }) => {
    if (slugs.length > 24 || new Set(slugs).size !== slugs.length) throw Error("Invalid discovery offer selection");
    const rows = (await Promise.all(slugs.map(slug => ctx.db.query("listings").withIndex("by_slug", q => q.eq("slug", slug)).first())))
      .filter((row): row is NonNullable<typeof row> => !!row && !rentalUnavailable(row));
    const publicRows = await createPublicListingCopy(ctx)(rows);
    return publicRows.map(row => ({
      slug: row.slug, title: row.title, category: row.category, image: images(row)[0] ?? null,
      daily: Number.isFinite(row.pricing?.daily) && row.pricing.daily > 0
        ? Math.round(row.pricing.daily * 100) / 100 : null,
      minimumRentalDays: row.minimumRentalDays ?? 1,
    }));
  },
});

export const discoveryCameraPage = query({
  args: { after: v.optional(v.string()) },
  handler: async (ctx, { after }) => {
    if (after !== undefined && !/^[a-z0-9-]{1,200}$/.test(after)) throw Error("Invalid camera directory position");
    const rows = await ctx.db.query("listings").withIndex("by_category_slug", q =>
      after ? q.eq("category", "Cameras").gt("slug", after) : q.eq("category", "Cameras")).take(49);
    const page = rows.slice(0, 48);
    const visible = await createPublicListingCopy(ctx)(page.filter(row => !rentalUnavailable(row)));
    return {
      page: visible.map(row => ({ slug: row.slug, title: row.title, category: row.category })),
      nextAfter: rows.length > 48 ? page[page.length - 1].slug : null,
    };
  },
});

/** Public physical pairing evidence; no customer or private inventory fields. */
export const compatibilityKits = query({ args: {}, handler: verifiedKitEvidence });
