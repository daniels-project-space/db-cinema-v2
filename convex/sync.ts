import { action, internalMutation, mutation } from "./_generated/server";
import { internal, api } from "./_generated/api";
import { v, ConvexError } from "convex/values";
import { deriveItemType, deriveSpecs, DELIVERY_BY_TYPE, categoryFor, isGenuineBundle } from "./lib/taxonomy";
import { assertAdmin } from "./adminAuth";
import { automaticMarketingFields } from "./lib/marketingInventory";
import { inventoryCapacity } from "./lib/inventoryCapacity";

/**
 * Canonical camera-MODEL identity for inventory reconciliation against the rental
 * manager. Disambiguates look-alikes (fx3 ≠ fx30, a7iii ≠ a7iv, a7 ≠ a7r) so a
 * catalogue listing for a body the shop doesn't physically own (per RMv2 items)
 * can be flagged as a phantom. Returns null when no camera model is recognised.
 */
function camModel(s: string): string | null {
  let t = " " + String(s || "").toLowerCase().replace(/cannon/g, "canon") + " ";
  t = t.replace(/[^a-z0-9]+/g, " ");
  if (/\bvenice\b/.test(t)) return "venice";
  if (/\balexa\b|\bamira\b/.test(t)) return "alexa";
  if (/\bfx ?30\b/.test(t)) return "fx30";
  if (/\bfx ?3\b/.test(t)) return "fx3";
  if (/\bfx ?6\b/.test(t)) return "fx6";
  if (/\bfx ?9\b/.test(t)) return "fx9";
  if (/\ba7s ?(iii|3)\b/.test(t)) return "a7siii";
  if (/\ba7s ?(ii|2)\b/.test(t)) return "a7sii";
  if (/\ba7 ?r\b|\ba7r\b/.test(t)) return "a7r"; // any A7R (not owned)
  if (/\ba7 ?(iv|4)\b/.test(t) || /\ba7iv\b/.test(t)) return "a7iv";
  if (/\ba7 ?(iii|3)\b/.test(t)) return "a7iii";
  if (/\ba7 ?(v|5)\b/.test(t)) return "a7v";
  if (/\ba7 ?(ii|2)\b/.test(t)) return "a7ii";
  if (/\ba6\d00\b/.test(t)) return "a6x00";
  if (/\ba1\b/.test(t)) return "a1";
  if (/\ba9\b/.test(t)) return "a9";
  if (/\bc ?70\b/.test(t)) return "c70";
  if (/\bc ?(100|200|300|500)\b/.test(t)) return "c-cine";
  if (/\br5c\b/.test(t)) return "r5c";
  if (/\br ?5\b/.test(t)) return "r5";
  if (/\br ?6\b/.test(t)) return "r6";
  if (/komodo/.test(t)) return "komodo";
  if (/raptor|\bred ?(helium|gemini|monstro|raven|v ?raptor)/.test(t)) return "red-other";
  if (/bmpcc ?4k|pocket ?4k|bmpcc4k/.test(t)) return "bmpcc4k"; // 4K (shop owns the 6K, not 4K)
  if (/bmpcc|pocket cinema|6k ?pro|6k ?g2/.test(t)) return "bmpcc";
  if (/\bs5\b|s5 ?ii|s1h|\bgh ?[567]\b/.test(t)) return "s5";
  if (/x100|\bx-?t\d\b/.test(t)) return "x100";
  if (/osmo|gopro|hero|insta ?360|action/.test(t)) return "actioncam";
  if (/ronin 4d/.test(t)) return "ronin4d";
  if (/mavic ?4|air ?4/.test(t)) return "drone-new"; // newer drones not in the owned list
  if (/inspire|mavic|air ?3|mini ?4|avata|\bdrone\b|fpv|\bneo\b/.test(t)) return "drone";
  return null;
}

/** Rental Manager is the stock/catalogue source. Server credentials are sent
 * only to its configured Convex site endpoint, never to anonymous public queries.
 * Sync owns sourceImages; accepted R2 imagery remains untouched. */
const ACCOUNT = "dbcinema";

async function rmv2Query(path: string, args: Record<string, unknown>) {
  const configured = process.env.RMV2_WEBHOOK_URL;
  const secret = process.env.RMV2_WEBHOOK_SECRET;
  if (!configured || !secret) throw Error("Rental Manager inventory connection is not configured");
  let base: URL;
  try { base = new URL(configured); } catch { throw Error("Invalid Rental Manager inventory connection"); }
  if (base.protocol !== "https:" || !/^[a-z0-9-]+\.convex\.site$/.test(base.hostname) ||
      base.username || base.password || base.port || base.search || base.hash || base.pathname !== "/dbcinema/booking-sync")
    throw Error("Invalid Rental Manager inventory connection");
  const res = await fetch(new URL("/dbcinema/storefront-read", base).href, {
    method: "POST", redirect: "error", signal: AbortSignal.timeout(20000),
    headers: { "content-type": "application/json", "x-dbcinema-sync-token": secret },
    body: JSON.stringify({ path, args }),
  });
  if (!res.ok) throw Error(`Rental Manager inventory read rejected (HTTP ${res.status})`);
  const json = await res.json();
  if (json.protocolVersion !== 1 || json.status !== "success" || json.path !== path || !Array.isArray(json.value))
    throw Error("Invalid Rental Manager inventory receipt");
  return json.value;
}

// Category is derived from the HERO item (deriveItemType → CATEGORY_OF) via
// taxonomy.categoryFor — the single source of truth. The old hand-rolled regex
// (which dumped every camera *kit* into "Packages") is gone: a camera kit now
// lives in Cameras, a lens set in Lenses, and only GENUINE cross-department
// bundles land in Packages (see taxonomy.isGenuineBundle).

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
  if (sp.coverage) c.coverage = sp.coverage;
  return c;
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
  stockMapping?: {version:number;complete:boolean;owned:boolean|null;components:{masterItemId:string;name:string;qty:number;quantityOwned:number;active:boolean;replacementCost:number}[]};
};

export const syncFromRmv2 = action({
  args: {},
  handler: async (ctx): Promise<{ listings: number; units: number }> => {
    const products: RawProduct[] = await rmv2Query("hygglo_products:catalogueForStorefront", {
      accountSlug: ACCOUNT,
    });
    // Keep priced offerings browsable, including marketing-only demand items.
    // Physical quantities come exclusively from valid, active owned master
    // records; listing titles and manual marketing exemptions create no stock.
    const live = products.filter(
      (p) => p.name && (p.prices ?? []).some((x) => (x.pricePerDay ?? x.price ?? 0) > 0),
    );

    const payload = live.map((p) => {
      const mapping = p.stockMapping;
      if (!mapping || mapping.version !== 1 || typeof mapping.complete !== "boolean" ||
          !(mapping.owned === null || typeof mapping.owned === "boolean") || !Array.isArray(mapping.components))
        throw Error("Rental Manager catalogue lacks verified component mapping");
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
        stockComponents: mapping.components,
        stockMappingStatus: mapping.complete && mapping.owned === true && mapping.components.length > 0 ? "complete" as const : mapping.owned === false ? "not_owned" as const : "incomplete" as const,
        slug: `${slugify(title)}-${p.productId}`,
        title,
        category: categoryFor(title),
        itemType,
        specs: cleanSpecs(title, itemType),
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
        minimumRentalDays: p.minimumRentalDays ?? 1,
        hyggloListingSlug: firstListing?.slug,
        publicUrl: firstListing?.publicUrl,
        unavailableDates: unavailable,
      };
    });

    const encoded = new TextEncoder().encode(JSON.stringify(payload));
    const digest = await crypto.subtle.digest("SHA-256", encoded);
    const fingerprint = Array.from(
      new Uint8Array(digest),
      (b) => b.toString(16).padStart(2, "0"),
    ).join("");
    return await ctx.runMutation(internal.sync.applyCatalog, { items: payload, fingerprint });
  },
});

export const applyCatalog = internalMutation({
  args: {
    fingerprint: v.optional(v.string()),
    items: v.array(
      v.object({
        hyggloProductId: v.number(),
        stockMappingStatus: v.union(v.literal("complete"),v.literal("incomplete"),v.literal("not_owned")),
        stockComponents: v.array(v.object({masterItemId:v.string(),name:v.string(),qty:v.number(),quantityOwned:v.number(),active:v.boolean(),replacementCost:v.number()})),
        slug: v.string(),
        title: v.string(),
        category: v.string(),
        itemType: v.string(),
        specs: v.optional(v.any()),
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
        minimumRentalDays: v.number(),
        hyggloListingSlug: v.optional(v.string()),
        publicUrl: v.optional(v.string()),
        unavailableDates: v.array(v.string()),
      }),
    ),
  },
  handler: async (ctx, { items, fingerprint }) => {
    const stateKey = "catalog-payload-v3-canonical-components";
    const state = fingerprint
      ? await ctx.db
          .query("rmv2_sync_state")
          .withIndex("by_key", (q) => q.eq("key", stateKey))
          .first()
      : null;
    if (fingerprint && state?.cursor === fingerprint) {
      return { listings: 0, units: 0, deactivated: 0, skipped: true };
    }
    // Validate the complete source batch before mutating any stock. Listing
    // contents describe demand, never evidence that we own that many units.
    for (const item of items) {
      if (!Array.isArray(item.stockComponents) || !["complete","incomplete","not_owned"].includes(item.stockMappingStatus))
        throw Error("Incomplete source stock mapping contract");
      const seen = new Set<string>();
      for (const component of item.stockComponents) {
        if (!component.masterItemId.trim() || !component.name.trim() || seen.has(component.masterItemId) ||
            !Number.isSafeInteger(component.qty) || component.qty < 1 ||
            !Number.isSafeInteger(component.quantityOwned) || component.quantityOwned < 0 ||
            !Number.isFinite(component.replacementCost) || component.replacementCost < 0)
          throw Error("Invalid source component mapping");
        seen.add(component.masterItemId);
      }
      if (item.stockMappingStatus === "complete" && !item.stockComponents.length)
        throw Error("A complete stock mapping requires physical components");
    }
    const physical = new Map<string,string>();
    for (const item of items) for (const component of item.stockComponents ?? []) {
      const value = JSON.stringify([component.name,component.quantityOwned,component.active,component.replacementCost]);
      if (physical.has(component.masterItemId) && physical.get(component.masterItemId) !== value)
        throw Error("Conflicting source physical pool records");
      physical.set(component.masterItemId,value);
    }
    let unitCount = 0;
    let listingCount = 0;
    const unitCache = new Map<string, string>();
    // Once shared stock is established it owns physical capacity. A slower
    // catalogue response may update descriptions/BOM, never restore old stock.
    const sharedStock = await ctx.db.query("rmv2_sync_state").withIndex("by_key",q=>q.eq("key","shared-stock-v1")).first();

    async function ensureUnit(
      key: string,
      sku: string,
      name: string,
      qty: number,
      replacementCost: number,
      rmv2ItemId: string | undefined,
      hyggloProductId: number,
      active = true,
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
          quantityOwned: sharedStock ? existing.quantityOwned : qty,
          replacementCost,
          rmv2ItemId,
          hyggloProductId,
          active: sharedStock ? existing.active : active,
        });
        id = existing._id;
      } else {
        id = await ctx.db.insert("inventory_units", {
          sku,
          name,
          quantityOwned: sharedStock ? 0 : qty,
          replacementCost,
          rmv2ItemId,
          hyggloProductId,
          active: sharedStock ? false : active,
        });
        unitCount++;
      }
      unitCache.set(key, id);
      return id;
    }

    for (const it of items) {
      const components: {inventoryUnitId:any;qty:number}[] = [];
      for (const component of it.stockComponents) {
        const unitId = await ensureUnit(component.masterItemId, `mi-${component.masterItemId}`,
          component.name, component.quantityOwned, component.replacementCost,
          component.masterItemId, it.hyggloProductId, component.active);
        components.push({inventoryUnitId:unitId,qty:component.qty});
      }

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
        components,
        stockMappingStatus: it.stockMappingStatus,
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
        // A locally-suppressed listing (marketing-only override) stays INACTIVE even though it's
        // in the live set — so the bot/assemble/storefront never show it.
        const patch: any = (existing as any).suppressed ? { ...synced, active: false } : synced;
        // A retitled/replaced configuration must not inherit the old package's packing list.
        const identity = (components: {inventoryUnitId:any;qty:number}[]) => JSON.stringify(components.map(c => [String(c.inventoryUnitId),c.qty]).sort((a,b) => String(a[0]).localeCompare(String(b[0]))));
        if (existing.title !== it.title || existing.hyggloProductId !== it.hyggloProductId ||
            identity(existing.components) !== identity(synced.components))
          patch.rentalContents = undefined;
        await ctx.db.patch(existing._id, { ...patch, ...automaticMarketingFields(synced, existing) });
      } else {
        await ctx.db.insert("listings", { ...synced, ...automaticMarketingFields(synced), specs: it.specs ?? {} });
        listingCount++;
      }
    }

    // PRUNE: deactivate sync-managed listings no longer priced/named or removed at source so the storefront mirrors the shop's real inventory. Reversible — if an
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

    if (fingerprint) {
      const next = {
        key: stateKey,
        lastSyncedAt: Date.now(),
        status: "ok",
        cursor: fingerprint,
        note: `${listingCount} listings / ${unitCount} units / ${deactivated} deactivated`,
      };
      if (state) await ctx.db.patch(state._id, next);
      else await ctx.db.insert("rmv2_sync_state", next);
    }
    return { listings: listingCount, units: unitCount, deactivated, skipped: false };
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
//  Shared stock mirror — all upstream accounts, repairs and owner blocks.
//  Website reservations stay local; their manager copies are excluded upstream.
// ──────────────────────────────────────────────────────────────────────────

export const syncHyggloReservations = action({
  args: {},
  handler: async (ctx): Promise<{ mirrored: number; rows: number }> => {
    const value:any[] = await rmv2Query("items:sharedStockForStorefront", {});
    if(value.length!==1 || value[0]?.version!==1 || !Number.isSafeInteger(value[0].checkedAt) || !Array.isArray(value[0].units))
      throw Error("Invalid Rental Manager shared stock snapshot");
    return await ctx.runMutation(internal.sync.applySharedStock, {snapshot:value[0]});
  },
});

/** A cart visit reads current shared stock before offering checkout. The query
 * after the atomic import also includes website/subscription reservations. */
export const refreshCartStock = action({
  args:{items:v.array(v.object({listingId:v.id("listings"),start:v.number(),end:v.number()}))},
  handler:async(ctx,{items}):Promise<{checkedAt:number;availability:Record<string,{available:number;demanded:number;ok:boolean}>}>=>{
    if(!items.length||items.length>100||items.some(i=>!Number.isSafeInteger(i.start)||!Number.isSafeInteger(i.end)||i.end<i.start||i.end-i.start>365*86400000))throw Error("Invalid basket stock request");
    try {
      await ctx.runAction(api.sync.syncHyggloReservations,{});
      const availability=await ctx.runQuery(api.availability.forCart,{items});
      return {checkedAt:Date.now(),availability};
    } catch {
      throw new ConvexError({code:"STOCK_CHECK_UNAVAILABLE",message:"We couldn't check equipment availability. Please try again before checkout."});
    }
  },
});

/** Demand changes slowly; refresh it daily instead of during every 15-minute
 * availability mirror. This keeps recommendation quality while removing the
 * largest repeated cross-project history read. */
export const refreshDemandFromRmv2 = action({
  args: {},
  handler: async (ctx) => {
    const all: any[] = await rmv2Query("reservations:listForReconcile", {
      account_slug: ACCOUNT,
    });
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
    return { reservations: all.length, items: byName.size };
  },
});

/** Atomically replace shared occupancy and current capacity. Older parallel
 * responses cannot erase a newer source snapshot or release its held units. */
export const applySharedStock = internalMutation({
  args:{snapshot:v.object({version:v.number(),checkedAt:v.number(),units:v.array(v.object({masterItemId:v.string(),active:v.boolean(),quantityOwned:v.number(),windows:v.array(v.object({start:v.number(),end:v.number(),qty:v.number()}))}))})},
  handler:async(ctx,{snapshot})=>{
    const key="shared-stock-v1", seen=new Set<string>();
    if(snapshot.version!==1 || !Number.isSafeInteger(snapshot.checkedAt) || snapshot.checkedAt<1 || snapshot.checkedAt>Date.now()+60000)
      throw Error("Invalid shared stock snapshot time");
    for(const unit of snapshot.units) {
      if(!unit.masterItemId.trim() || seen.has(unit.masterItemId) || !Number.isSafeInteger(unit.quantityOwned) || unit.quantityOwned<0 || (!unit.active&&unit.quantityOwned!==0))
        throw Error("Invalid shared physical pool");
      seen.add(unit.masterItemId);let priorEnd=-Infinity;
      for(const window of unit.windows) {
        if(!Number.isSafeInteger(window.start)||!Number.isSafeInteger(window.end)||window.end<=window.start||window.start<priorEnd||!Number.isSafeInteger(window.qty)||window.qty<1)
          throw Error("Invalid shared occupancy windows");
        priorEnd=window.end;
      }
    }
    const fingerprint=JSON.stringify(snapshot.units), state=await ctx.db.query("rmv2_sync_state").withIndex("by_key",q=>q.eq("key",key)).first();
    const prior=state?.cursor?JSON.parse(state.cursor):null;
    if(prior && snapshot.checkedAt<prior.checkedAt)throw Error("Stale shared stock snapshot");
    if(prior && snapshot.checkedAt===prior.checkedAt) {
      if(prior.fingerprint!==fingerprint)throw Error("Conflicting shared stock snapshot");
    }
    const resolved=[];
    for(const source of snapshot.units) {
      const unit=await ctx.db.query("inventory_units").withIndex("by_rmv2ItemId",q=>q.eq("rmv2ItemId",source.masterItemId)).unique();
      if(unit)resolved.push({source,unit});
    }
    const removed=(await ctx.db.query("inventory_units").collect()).filter(unit=>unit.rmv2ItemId&&!seen.has(unit.rmv2ItemId));
    const old=await ctx.db.query("reservations").withIndex("by_source",q=>q.eq("source","hygglo")).collect();
    const signature=(rows:any[])=>JSON.stringify(rows.map(r=>[String(r.inventoryUnitId),r.start,r.end,r.qty,r.endExclusive===true,r.status]).sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b))));
    const expected=resolved.flatMap(({source,unit})=>source.windows.map(window=>({inventoryUnitId:unit._id,...window,endExclusive:true,status:"confirmed"})));
    const intact=signature(old)===signature(expected)&&resolved.every(({source,unit})=>unit.quantityOwned===source.quantityOwned&&unit.active===source.active)&&removed.every(unit=>unit.quantityOwned===0&&unit.active===false);
    if(prior&&prior.fingerprint===fingerprint&&intact){
      // A fresh identical provider receipt must not churn hundreds of physical
      // reservations. Advance freshness only after verifying every stored pool
      // and window; a newly mapped pool or corrupt ledger still repairs below.
      if(snapshot.checkedAt!==prior.checkedAt)await ctx.db.patch(state!._id,{lastSyncedAt:Date.now(),status:"ok",cursor:JSON.stringify({checkedAt:snapshot.checkedAt,fingerprint})});
      return {mirrored:0,rows:snapshot.units.length,alreadyApplied:true};
    }
    for(const row of old)await ctx.db.delete(row._id);
    for(const unit of removed)await ctx.db.patch(unit._id,{quantityOwned:0,active:false});
    let mirrored=0;
    for(const {source,unit} of resolved) {
      await ctx.db.patch(unit._id,{quantityOwned:source.quantityOwned,active:source.active});
      for(const [index,window] of source.windows.entries()) {
        await ctx.db.insert("reservations",{inventoryUnitId:unit._id,...window,endExclusive:true,source:"hygglo",status:"confirmed",externalRef:`shared:${source.masterItemId}:${index}`});mirrored++;
      }
    }
    const record={key,lastSyncedAt:Date.now(),status:"ok",cursor:JSON.stringify({checkedAt:snapshot.checkedAt,fingerprint})};
    if(state)await ctx.db.patch(state._id,record);else await ctx.db.insert("rmv2_sync_state",record);
    return {mirrored,rows:snapshot.units.length};
  },
});

/** Mark listings as marketing-only (locally suppressed) by title regex or exact slug — they
 * are deactivated now and STAY inactive through every sync. Pass suppressed:false to restore. */
export const setSuppressed = internalMutation({
  // onlyNeverRented: SAFETY — when suppressing, skip any item that has real rental
  // demand (demandScore > 0) so a broad brand pattern can never hide proven inventory.
  args: { match: v.string(), suppressed: v.boolean(), onlyNeverRented: v.optional(v.boolean()) },
  handler: async (ctx, { match, suppressed, onlyNeverRented }) => {
    const all = await ctx.db.query("listings").collect();
    let re: RegExp | null = null;
    try { re = new RegExp(match, "i"); } catch {}
    let updated = 0;
    const skipped: string[] = [];
    for (const l of all) {
      if (l.slug === match || (re && re.test(l.title))) {
        if (suppressed && onlyNeverRented && ((l as any).demandScore ?? 0) > 0) { skipped.push(l.title); continue; }
        await ctx.db.patch(l._id, suppressed ? { suppressed: true, active: false } : { suppressed: false });
        updated++;
      }
    }
    return { updated, skipped };
  },
});

export const suppressByIds = internalMutation({
  args: { ids: v.array(v.id("listings")), suppressed: v.boolean() },
  handler: async (ctx, { ids, suppressed }) => {
    for (const id of ids) await ctx.db.patch(id, suppressed ? { suppressed: true, active: false } : { suppressed: false });
    return { updated: ids.length };
  },
});

/**
 * Reconcile the storefront camera catalogue against the rental manager's REAL items
 * (RMv2 items:listForReconcile = the gear the shop physically owns). Any camera-body
 * listing whose model isn't owned (e.g. FX30, A7 IV, A7R — the shop has A7 II/III/V/SIII
 * but not those) is a phantom → suppressed. `apply:false` (default) is a dry run.
 * This is the durable, data-driven "what exists vs what doesn't" check.
 */
export const reconcileCameras = action({
  args: { apply: v.optional(v.boolean()) },
  handler: async (ctx, { apply }): Promise<any> => {
    const items: any[] = await rmv2Query("items:listForReconcile", {});
    const owned = new Set<string>();
    for (const i of items) { const m = camModel(i.name); if (m) owned.add(m); }
    const cams: any[] = await ctx.runQuery(api.catalog.byItemType, { types: ["camera-body"] });
    const phantom = cams.filter((x) => { const m = camModel(x.title); return m != null && !owned.has(m); });
    const ids = phantom.map((p) => p._id);
    if (apply && ids.length) await ctx.runMutation(internal.sync.suppressByIds, { ids, suppressed: true });
    return {
      owned: [...owned].sort(),
      phantomCount: phantom.length,
      phantom: phantom.map((p) => `${camModel(p.title)} | ${String(p.title).slice(0, 48)}`),
      applied: !!apply,
    };
  },
});

// apply vision-validated itemType corrections (one-off, from scripts/vision-cat.mjs)
export const setItemTypes = mutation({
  args: { updates: v.array(v.object({ id: v.id("listings"), itemType: v.string() })) },
  handler: async (ctx, { updates }) => {
    for (const u of updates) await ctx.db.patch(u.id, { itemType: u.itemType });
    return { updated: updates.length };
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


// Re-derive storefront category + isPackage for every listing from the hero item
// (taxonomy.categoryFor / isGenuineBundle). One-time purge of the old mis-categories;
// the 30-min sync keeps them correct afterwards via applyCatalog.
export const recategorize = mutation({
  args: {},
  handler: async (ctx) => {
    const ls = await ctx.db.query("listings").collect();
    let n = 0;
    for (const l of ls) {
      const cat = categoryFor(l.title);
      const pkg = isGenuineBundle(l.title);
      if (l.category !== cat || (l as any).isPackage !== pkg) {
        await ctx.db.patch(l._id, { category: cat, isPackage: pkg });
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
      if (sp.coverage) clean.coverage = sp.coverage;
      await ctx.db.patch(l._id, { specs: clean });
      n++;
    }
    return { respecced: n };
  },
});


export const applyClassification = mutation({
  args: { token: v.string(), items: v.array(v.object({ id: v.id("listings"), itemType: v.string(), category: v.string(), isPackage: v.boolean(), specs: v.any() })) },
  handler: async (ctx, { token, items }) => {
    await assertAdmin(ctx, token, "sync.applyClassification");
    let n = 0;
    for (const it of items) { await ctx.db.patch(it.id, { itemType: it.itemType, category: it.category, isPackage: it.isPackage, specs: it.specs }); n++; }
    return { updated: n };
  },
});


/** Legacy maintenance name retained for callers, but listing demand cannot
 * manufacture physical stock. Report shortages for owner reconciliation. */
export const fixUnitQty = mutation({
  args: { token: v.string() },
  handler: async (ctx, { token }) => {
    await assertAdmin(ctx, token, "sync.fixUnitQty");
    const listings = await ctx.db.query("listings").collect();
    const shortages: { listingId: string; inventoryUnitId: string; required: number; owned: number | null }[] = [];
    for (const listing of listings) for (const component of listing.components) {
      const unit = await ctx.db.get(component.inventoryUnitId);
      const owned = inventoryCapacity(unit);
      if (owned === null || !Number.isSafeInteger(component.qty) || component.qty < 1 || owned < component.qty)
        shortages.push({ listingId: String(listing._id), inventoryUnitId: String(component.inventoryUnitId), required: component.qty, owned });
    }
    return { bumped: 0, shortages };
  },
});


export const applyKnowledge = mutation({
  args: { token: v.string(), items: v.array(v.object({ id: v.id("listings"), knowledge: v.any() })) },
  handler: async (ctx, { token, items }) => {
    await assertAdmin(ctx, token, "sync.applyKnowledge");
    let n = 0;
    for (const it of items) { await ctx.db.patch(it.id, { knowledge: it.knowledge }); n++; }
    return { updated: n };
  },
});

/** One upstream refresh for a calendar scope, never one refresh per day. */
export const refreshCalendarStock = action({
  args:{listingId:v.id("listings"),monthStart:v.number(),rangeStart:v.optional(v.number()),items:v.array(v.object({listingId:v.id("listings"),start:v.number(),end:v.number()}))},
  handler:async(ctx,args):Promise<{checkedAt:number;days:Record<string,{ok:boolean;available:number}>}>=>{
    const first=new Date(args.monthStart);
    if(!Number.isSafeInteger(args.monthStart)||first.getUTCDate()!==1||first.getUTCHours()!==0||first.getUTCMinutes()!==0||first.getUTCSeconds()!==0||first.getUTCMilliseconds()!==0||args.items.length>100||args.items.some(i=>!Number.isSafeInteger(i.start)||!Number.isSafeInteger(i.end)||i.end<i.start||i.end-i.start>365*86400000||i.start%86400000!==0||i.end%86400000!==0)||(args.rangeStart!==undefined&&(!Number.isSafeInteger(args.rangeStart)||args.rangeStart%86400000!==0||Math.abs(args.monthStart-args.rangeStart)>365*86400000)))throw Error("Invalid calendar stock request");
    try{
      await ctx.runAction(api.sync.syncHyggloReservations,{});
      const days=await ctx.runQuery(api.availability.forCalendar,args);
      return {checkedAt:Date.now(),days};
    }catch{throw new ConvexError({code:"STOCK_CHECK_UNAVAILABLE",message:"We couldn't check these dates. Please retry."});}
  },
});
