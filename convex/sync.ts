import { action, internalMutation, mutation } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import { deriveItemType, deriveSpecs, DELIVERY_BY_TYPE } from "./lib/taxonomy";

/**
 * RMv2 availability/catalog bridge.
 *
 * RMv2 (hearty-oyster-600) is the source of truth and allows anonymous
 * /api/query, so the storefront pulls the dbcinema catalog directly — no RMv2
 * code change. `poll-hygglo` keeps `hygglo_products` (incl. unavailableDates)
 * fresh upstream; this job mirrors it into our own listings/inventory ledger.
 *
 * Images: sync only ever writes `sourceImages` (the imgix hotlinks). The R2
 * migration owns `r2Images` and is NEVER touched here, so the 30-min cron can't
 * undo a migration. Readers prefer r2Images and fall back to sourceImages.
 */
const RMV2_URL = "https://hearty-oyster-600.convex.cloud";
const ACCOUNT = "dbcinema";

async function rmv2Query(path: string, args: Record<string, unknown>) {
  const res = await fetch(`${RMV2_URL}/api/query`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ path, args, format: "json" }),
  });
  const json = await res.json();
  if (json.status !== "success") {
    throw new Error(`RMv2 ${path} failed: ${json.errorMessage ?? "unknown"}`);
  }
  return json.value;
}

const CATEGORY_RULES: [string, RegExp][] = [
  ["Cameras", /\b(camera|bmpcc|fx3|fx6|fx30|a7|a7s|a7iv|alexa|red\b|ursa|c70|c300|c200|pocket cinema|gh5|gh6|gh7|komodo|raptor|z\s?cam|s5|s1h|zv-?e)\b/i],
  ["Lenses", /\b(lens|lenses|sigma|samyang|tamron|rokinon|24-70|70-200|16-35|14-24|12-24|50mm|35mm|85mm|24mm|18-?35|prime|zoom lens|ef\b|rf\b|e-?mount|cine lens|dzo|vespid|blazar|atlas|sirui|great ?joy|laowa|gm\b|g ?master|gmaster|anamorphic)\b/i],
  ["Lighting", /\b(aputure|godox|nanlite|amaran|led panel|softbox|hmi|fresnel|600d|300d|120d|forza|light panel|key light|fill light)\b/i],
  ["Audio", /\b(mic|microphone|rode|røde|sennheiser|zoom h\d|recorder|wireless go|lav|lavalier|boom|deity|tascam|ntg|shotgun|speaker|partybox)\b/i],
  ["Drones", /\b(drone|mavic|mini\s?\d|air\s?\d|fpv|avata|dji (air|mini|neo))\b/i],
  ["Stabilizers", /\b(gimbal|ronin|crane|stabilizer|dji rs|rs\s?\d|rsc|moza|zhiyun)\b/i],
  ["Monitors", /\b(monitor|atomos|ninja|shinobi|smallhd|director|feelworld)\b/i],
  ["Power", /\b(battery|batteries|v-?mount|v-?lock|charger|np-?f|d-?tap)\b/i],
  ["Grip", /\b(tripod|slider|dolly|clamp|magic arm|c-?stand|sandbag|cage|rig|matte box|follow focus)\b/i],
];

function deriveCategory(name: string): string {
  // camera bundles / sets go in Packages
  if (CATEGORY_RULES[0][1].test(name) && /(\bset\b|\bkit\b|bundle|package|\+|operator|\d{2}-\d{2,3}\s?mm)/i.test(name)) return "Packages";
  for (const [cat, re] of CATEGORY_RULES) if (re.test(name)) return cat;
  return "Accessories";
}

const cleanTitle = (name: string) => name.replace(/\s+/g, " ").trim();
// Title-derived specs as a clean object (drops nulls) — written on INSERT so new
// inventory gets mount/tier/lensClass automatically (was migration-only; D1 fix).
function cleanSpecs(title: string, itemType: string): any {
  const sp: any = deriveSpecs(title, itemType as any);
  const c: any = { includesLens: sp.includesLens };
  if (sp.mount) c.mount = sp.mount;
  if (sp.filterThreadMm) c.filterThreadMm = sp.filterThreadMm;
  if (sp.batteryType) c.batteryType = sp.batteryType;
  if (sp.lensFocal) c.lensFocal = sp.lensFocal;
  if (sp.tier) c.tier = sp.tier;
  if (sp.lensClass) c.lensClass = sp.lensClass;
  if (sp.hasAutofocus !== null && sp.hasAutofocus !== undefined) c.hasAutofocus = sp.hasAutofocus;
  return c;
}
// leading "2x" / "2×" / "3 x" => bundle consumes that many physical units
function parseQty(title: string): number {
  const m = title.match(/^\s*(\d+)\s*[x×]/i);
  const q = m ? parseInt(m[1], 10) : 1;
  return Math.min(Math.max(q, 1), 6);
}
const slugify = (s: string) =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);

type RawProduct = {
  productId: number;
  name?: string;
  isPublished?: boolean;
  isMarketingOnly?: boolean;
  valuation?: number;
  minimumRentalDays?: number;
  prices?: { days?: number; pricePerDay?: number; price?: number }[];
  images?: { fullSizeUrl?: string; thumbnailUrl?: string }[];
  unavailableDates?: unknown[];
  listings?: { slug?: string; publicUrl?: string }[];
  masterItemId?: string;
};

export const syncFromRmv2 = action({
  args: {},
  handler: async (ctx): Promise<{ listings: number; units: number }> => {
    const products: RawProduct[] = await rmv2Query("hygglo_products:list", {
      accountSlug: ACCOUNT,
    });
    const items: { _id: string; qty?: number }[] = await rmv2Query(
      "items:listForReconcile",
      {},
    );
    const qtyByItem = new Map(items.map((i) => [i._id, i.qty ?? 1]));

    // What the storefront shows = the shop's REAL rentable inventory: not retired/display-only
    // (isMarketingOnly), named, and priced. (isPublished is unreliable here — only ~3 of 405 carry
    // it — so it would empty the catalogue; isMarketingOnly is the maintained "retired" signal.)
    const live = products.filter(
      (p) =>
        !p.isMarketingOnly &&
        p.name &&
        (p.prices ?? []).some((x) => (x.pricePerDay ?? x.price ?? 0) > 0),
    );

    const payload = live.map((p) => {
      const prices = p.prices ?? [];
      const pick = (d: number) => {
        const row = prices.find((x) => x.days === d);
        return row?.pricePerDay ?? row?.price;
      };
      const daily = pick(1) ?? prices[0]?.pricePerDay ?? 0;
      const sourceImages = (p.images ?? [])
        .map((i) => i.fullSizeUrl ?? i.thumbnailUrl)
        .filter((u): u is string => !!u);
      const firstListing = (p.listings ?? [])[0];
      const title = cleanTitle(p.name!);
      const unavailable = (p.unavailableDates ?? []).map((d) =>
        typeof d === "string" ? d : JSON.stringify(d),
      );
      const itemType = deriveItemType(title);
      const spec = DELIVERY_BY_TYPE[itemType];
      return {
        hyggloProductId: p.productId,
        masterItemId: p.masterItemId,
        masterQty: p.masterItemId ? qtyByItem.get(p.masterItemId) ?? 1 : 1,
        slug: `${slugify(title)}-${p.productId}`,
        title,
        category: deriveCategory(title),
        itemType,
        specs: cleanSpecs(title, itemType),
        componentQty: parseQty(title),
        sizeScore: spec.sizeScore,
        weightKg: spec.weightKg,
        sourceImages,
        pricing: {
          daily,
          day3: pick(3),
          day7: pick(7),
          day30: pick(30),
        },
        depositAmount: p.valuation ?? 0,
        replacementCost: p.valuation ?? 0,
        minimumRentalDays: p.minimumRentalDays ?? 1,
        hyggloListingSlug: firstListing?.slug,
        publicUrl: firstListing?.publicUrl,
        unavailableDates: unavailable,
      };
    });

    return await ctx.runMutation(internal.sync.applyCatalog, { items: payload });
  },
});

export const applyCatalog = internalMutation({
  args: {
    items: v.array(
      v.object({
        hyggloProductId: v.number(),
        masterItemId: v.optional(v.string()),
        masterQty: v.number(),
        slug: v.string(),
        title: v.string(),
        category: v.string(),
        itemType: v.string(),
        specs: v.optional(v.any()),
        componentQty: v.number(),
        sizeScore: v.number(),
        weightKg: v.number(),
        sourceImages: v.array(v.string()),
        pricing: v.object({
          daily: v.number(),
          day3: v.optional(v.number()),
          day7: v.optional(v.number()),
          day30: v.optional(v.number()),
        }),
        depositAmount: v.number(),
        replacementCost: v.number(),
        minimumRentalDays: v.number(),
        hyggloListingSlug: v.optional(v.string()),
        publicUrl: v.optional(v.string()),
        unavailableDates: v.array(v.string()),
      }),
    ),
  },
  handler: async (ctx, { items }) => {
    let unitCount = 0;
    let listingCount = 0;
    const unitCache = new Map<string, string>();

    async function ensureUnit(
      key: string,
      sku: string,
      name: string,
      qty: number,
      replacementCost: number,
      rmv2ItemId: string | undefined,
      hyggloProductId: number,
    ): Promise<string> {
      if (unitCache.has(key)) return unitCache.get(key)!;
      const existing = await ctx.db
        .query("inventory_units")
        .withIndex("by_sku", (q) => q.eq("sku", sku))
        .first();
      let id: string;
      if (existing) {
        await ctx.db.patch(existing._id, {
          name,
          quantityOwned: Math.max((existing as any).quantityOwned ?? 0, qty),
          replacementCost,
          rmv2ItemId,
          hyggloProductId,
          active: true,
        });
        id = existing._id;
      } else {
        id = await ctx.db.insert("inventory_units", {
          sku,
          name,
          quantityOwned: qty,
          replacementCost,
          rmv2ItemId,
          hyggloProductId,
          active: true,
        });
        unitCount++;
      }
      unitCache.set(key, id);
      return id;
    }

    for (const it of items) {
      const unitKey = it.masterItemId ?? `prod-${it.hyggloProductId}`;
      const sku = it.masterItemId ? `mi-${it.masterItemId}` : `prod-${it.hyggloProductId}`;
      const unitId = await ensureUnit(
        unitKey,
        sku,
        it.title,
        Math.max(it.masterQty, it.componentQty ?? 1),
        it.replacementCost,
        it.masterItemId,
        it.hyggloProductId,
      );

      const existing = await ctx.db
        .query("listings")
        .withIndex("by_slug", (q) => q.eq("slug", it.slug))
        .first();

      // shared fields synced from RMv2 every run
      const synced = {
        slug: it.slug,
        title: it.title,
        category: it.category,
        itemType: it.itemType,
        sizeScore: it.sizeScore,
        weightKg: it.weightKg,
        sourceImages: it.sourceImages,
        pricing: it.pricing,
        depositAmount: it.depositAmount,
        components: [{ inventoryUnitId: unitId as any, qty: it.componentQty }],
        hyggloListingSlug: it.hyggloListingSlug,
        hyggloProductId: it.hyggloProductId,
        unavailableDates: it.unavailableDates,
        publicUrl: it.publicUrl,
        minimumRentalDays: it.minimumRentalDays,
        active: true,
      };

      if (existing) {
        // never overwrite r2Images OR specs here — the migration/manual fixes own specs
        // (the 12 MANUAL mounts must survive every sync); only NEW listings get derived specs.
        await ctx.db.patch(existing._id, synced);
      } else {
        await ctx.db.insert("listings", { ...synced, specs: it.specs ?? {} });
        listingCount++;
      }
    }

    // PRUNE: deactivate sync-managed listings no longer in the live set (now marketing-only or
    // removed at source) so the storefront mirrors the shop's real inventory. Reversible — if an
    // item is un-retired upstream it re-enters `live` and is re-activated next sync.
    const liveSlugs = new Set(items.map((i) => i.slug));
    const activeRows = await ctx.db
      .query("listings")
      .withIndex("by_active", (q) => q.eq("active", true))
      .collect();
    let deactivated = 0;
    for (const l of activeRows) {
      if ((l as any).hyggloProductId != null && !liveSlugs.has(l.slug)) {
        await ctx.db.patch(l._id, { active: false });
        deactivated++;
      }
    }

    return { listings: listingCount, units: unitCount, deactivated };
  },
});

// ──────────────────────────────────────────────────────────────────────────
//  Demand intelligence — map the rental HISTORY (canonical items rented N times,
//  e.g. "sony gm 24-70mm f2.8" 234x) onto each listing's title, so the bot can
//  recommend what's genuinely in demand. Title-matched because demand is per
//  canonical item while listings are product bundles (no shared id).
// ──────────────────────────────────────────────────────────────────────────
const DEMAND_STOP = new Set(["sony", "canon", "nikon", "set", "lens", "lenses", "mic", "mics", "camera", "body", "kit", "pro", "full", "frame", "padded", "case", "pouch", "panels", "panel", "light", "lights", "mount", "zoom", "with", "and", "the", "f2", "f1", "f4", "ii", "iii"]);
const THIRD_PARTY = ["sigma", "tamron", "samyang", "rokinon", "viltrox", "7artisans"];
/** A demand item's matchable signature: focal ranges (despaced, contiguous), whether it's
 * GM/native glass, a third-party brand if any, and distinctive brand/model words. */
function demandSig(name: string) {
  const lower = name.toLowerCase().replace(/—[^|]*$/, "").replace(/\[[^\]]*\]/g, "").trim();
  const ranges = (lower.match(/\d{2,3}\s*-\s*\d{2,3}/g) || []).map((r) => r.replace(/[^0-9]/g, ""));
  const requireGm = /\bgm\b|g.?master/.test(lower);
  const third = THIRD_PARTY.find((b) => lower.includes(b)) ?? null;
  const words = (lower.match(/[a-z0-9]+/g) || []).filter((t) => t.length >= 4 && !DEMAND_STOP.has(t) && !/^\d/.test(t));
  return { ranges, requireGm, third, words };
}
/** Total rental demand attributable to a listing title (sum of matched item counts). */
function titleDemand(title: string, demand: { name: string; count: number }[]): number {
  const lower = String(title || "").toLowerCase();
  const tj = lower.replace(/[^a-z0-9]/g, "");
  const toks = new Set(lower.match(/[a-z0-9]+/g) || []);
  const titleHasGm = /\bgm\b|g.?master|gmaster/.test(lower);
  const titleThird = THIRD_PARTY.find((b) => lower.includes(b)) ?? null;
  let score = 0;
  for (const { name, count } of demand) {
    const s = demandSig(name);
    if (s.ranges.length && !s.ranges.every((r) => tj.includes(r))) continue;          // focal must match (24-70 ≠ 16-35)
    if (s.requireGm && !titleHasGm) continue;                                          // native GM glass
    if (titleThird && titleThird !== s.third) continue;                                // a Sigma title ≠ a Sony-GM demand item
    const wordHits = s.words.filter((w) => toks.has(w) || tj.includes(w)).length;
    if (s.words.length && wordHits / s.words.length < 0.5) continue;                   // distinctive words mostly present
    if (!s.ranges.length && !wordHits) continue;                                       // skip items with no specific signal matched
    score += count;
  }
  return score;
}

/** Recompute per-listing demandScore from the rental-history name→count map. */
export const applyDemand = internalMutation({
  args: { demand: v.array(v.object({ name: v.string(), count: v.number() })) },
  handler: async (ctx, { demand }) => {
    const listings = await ctx.db.query("listings").collect();
    let updated = 0, withDemand = 0;
    for (const l of listings) {
      const score = titleDemand(l.title, demand);
      if (score > 0) withDemand++;
      if (((l as any).demandScore ?? 0) !== score) {
        await ctx.db.patch(l._id, { demandScore: score } as any);
        updated++;
      }
    }
    return { updated, withDemand, listings: listings.length };
  },
});

// ──────────────────────────────────────────────────────────────────────────
//  Hygglo reservation mirror — cross-check active + upcoming Hygglo rentals so
//  storefront availability reflects what's already booked on Hygglo (by unit +
//  dates + qty). Source of truth: RMv2 reservations:listForReconcile(dbcinema).
// ──────────────────────────────────────────────────────────────────────────
const DAY_MS = 86400000;
const dms = (iso?: string) => (iso ? Date.parse(iso + "T00:00:00Z") : NaN);

export const syncHyggloReservations = action({
  args: {},
  handler: async (ctx): Promise<{ mirrored: number; rows: number }> => {
    const all: any[] = await rmv2Query("reservations:listForReconcile", {
      account_slug: ACCOUNT,
    });
    const today = new Date().toISOString().slice(0, 10);
    const live = all.filter(
      (r) =>
        !r.is_obsolete &&
        !["cancelled", "canceled", "declined"].includes(String(r.status)) &&
        r.order_step !== "CANCELED" &&
        (r.end_date || r.return_date || r.start_date || "") >= today,
    );
    const rows = live.map((r) => {
      const start = dms(r.start_date || r.pickup_date);
      const end = dms(r.end_date || r.return_date || r.start_date);
      const resolved = Array.isArray(r.resolved_items) ? r.resolved_items : [];
      const items = resolved.length
        ? resolved.map((i: any) => ({ itemId: i.item_id, qty: Math.round(i.qty || 1) }))
        : (Array.isArray(r.items) ? r.items : []).map((i: any) => ({
            productId: typeof i.product_id === "number" ? i.product_id : undefined,
            qty: Math.round(i.qty || 1),
          }));
      return { ref: String(r.hygglo_order_id ?? r._id), start, end, items };
    }).filter((r) => !isNaN(r.start) && !isNaN(r.end));

    // DEMAND: tally how often each canonical item was rented across the WHOLE history
    // (not just upcoming) → per-listing demandScore for the bot's recommendations.
    const byName = new Map<string, number>();
    for (const r of all) {
      if (r.is_obsolete || ["cancelled", "canceled", "declined"].includes(String(r.status)) || r.order_step === "CANCELED") continue;
      const its = Array.isArray(r.resolved_items) && r.resolved_items.length ? r.resolved_items : (Array.isArray(r.items) ? r.items : []);
      for (const i of its) {
        const n = String(i.item_name_canonical || i.item_name || "").replace(/\s*\[[^\]]*\]\s*/g, "").trim().toLowerCase();
        if (n) byName.set(n, (byName.get(n) ?? 0) + Math.round(i.qty || 1));
      }
    }
    await ctx.runMutation(internal.sync.applyDemand, {
      demand: [...byName.entries()].map(([name, count]) => ({ name, count })),
    });

    return await ctx.runMutation(internal.sync.applyHygglo, { rows });
  },
});

export const applyHygglo = internalMutation({
  args: {
    rows: v.array(
      v.object({
        ref: v.string(),
        start: v.number(),
        end: v.number(),
        items: v.array(
          v.object({
            itemId: v.optional(v.string()),
            productId: v.optional(v.number()),
            qty: v.number(),
          }),
        ),
      }),
    ),
  },
  handler: async (ctx, { rows }) => {
    // unit lookup maps
    const units = await ctx.db.query("inventory_units").collect();
    const byRmv2 = new Map<string, any>();
    const byProduct = new Map<number, any>();
    for (const u of units) {
      if (u.rmv2ItemId) byRmv2.set(u.rmv2ItemId, u._id);
      if (u.hyggloProductId) byProduct.set(u.hyggloProductId, u._id);
    }
    // also map productId via listings -> first component unit
    const listings = await ctx.db.query("listings").collect();
    for (const l of listings) {
      if (l.hyggloProductId && l.components[0] && !byProduct.has(l.hyggloProductId))
        byProduct.set(l.hyggloProductId, l.components[0].inventoryUnitId);
    }

    // clear previous hygglo mirror
    const existing = await ctx.db
      .query("reservations")
      .withIndex("by_source", (q) => q.eq("source", "hygglo"))
      .collect();
    for (const r of existing) await ctx.db.delete(r._id);

    let mirrored = 0;
    for (const row of rows) {
      for (const it of row.items) {
        const unitId =
          (it.itemId && byRmv2.get(it.itemId)) ||
          (it.productId && byProduct.get(it.productId));
        if (!unitId) continue;
        await ctx.db.insert("reservations", {
          inventoryUnitId: unitId,
          start: row.start,
          end: row.end,
          qty: it.qty,
          source: "hygglo",
          status: "confirmed",
          externalRef: row.ref,
        });
        mirrored++;
      }
    }
    return { mirrored, rows: rows.length };
  },
});

export const reclassify = mutation({
  args: {},
  handler: async (ctx) => {
    const ls = await ctx.db.query("listings").collect();
    let n = 0;
    for (const l of ls) {
      const t = deriveItemType(l.title);
      if ((l as any).itemType !== t) {
        await ctx.db.patch(l._id, { itemType: t });
        n++;
      }
    }
    return { updated: n, total: ls.length };
  },
});


export const respec = mutation({
  args: {},
  handler: async (ctx) => {
    const ls = await ctx.db.query("listings").collect();
    let n = 0;
    for (const l of ls) {
      const it = ((l as any).itemType || deriveItemType(l.title)) as any;
      const sp = deriveSpecs(l.title, it);
      const clean: any = { includesLens: sp.includesLens };
      if (sp.mount) clean.mount = sp.mount;
      if (sp.filterThreadMm) clean.filterThreadMm = sp.filterThreadMm;
      if (sp.batteryType) clean.batteryType = sp.batteryType;
      if (sp.lensFocal) clean.lensFocal = sp.lensFocal;
      if (sp.tier) clean.tier = sp.tier;
      if (sp.lensClass) clean.lensClass = sp.lensClass;
      if (sp.hasAutofocus !== null && sp.hasAutofocus !== undefined) clean.hasAutofocus = sp.hasAutofocus;
      await ctx.db.patch(l._id, { specs: clean });
      n++;
    }
    return { respecced: n };
  },
});


export const applyClassification = mutation({
  args: { token: v.string(), items: v.array(v.object({ id: v.id("listings"), itemType: v.string(), category: v.string(), isPackage: v.boolean(), specs: v.any() })) },
  handler: async (ctx, { token, items }) => {
    if (!process.env.ADMIN_TOKEN || token !== process.env.ADMIN_TOKEN) throw new Error("unauthorized");
    let n = 0;
    for (const it of items) { await ctx.db.patch(it.id, { itemType: it.itemType, category: it.category, isPackage: it.isPackage, specs: it.specs }); n++; }
    return { updated: n };
  },
});


export const fixUnitQty = mutation({
  args: {},
  handler: async (ctx) => {
    const ls = await ctx.db.query("listings").collect();
    const need = new Map();
    for (const l of ls) for (const c of (l.components || [])) { const q = c.qty || 1; need.set(c.inventoryUnitId, Math.max(need.get(c.inventoryUnitId) || 0, q)); }
    let n = 0;
    for (const [uid, q] of need) { const u: any = await ctx.db.get(uid as any); if (u && (u.quantityOwned ?? 1) < q) { await ctx.db.patch(uid as any, { quantityOwned: q }); n++; } }
    return { bumped: n };
  },
});


export const applyKnowledge = mutation({
  args: { token: v.string(), items: v.array(v.object({ id: v.id("listings"), knowledge: v.any() })) },
  handler: async (ctx, { token, items }) => {
    if (!process.env.ADMIN_TOKEN || token !== process.env.ADMIN_TOKEN) throw new Error("unauthorized");
    let n = 0;
    for (const it of items) { await ctx.db.patch(it.id, { knowledge: it.knowledge }); n++; }
    return { updated: n };
  },
});
