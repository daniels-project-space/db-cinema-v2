import { action, internalMutation } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";

/**
 * RMv2 availability/catalog bridge.
 *
 * RMv2 (hearty-oyster-600) is the source of truth. Its Convex allows anonymous
 * /api/query, so the storefront pulls the dbcinema catalog directly — no RMv2
 * code change. `poll-hygglo` keeps `hygglo_products` (incl. unavailableDates)
 * fresh upstream; this job mirrors it into our own listings/inventory ledger.
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
  ["Lenses", /\b(lens|lenses|sigma|samyang|24-70|70-200|16-35|50mm|35mm|85mm|24mm|18-?35|prime|zoom lens|ef\b|rf\b|e-?mount|cine lens|dzo|laowa)\b/i],
  ["Lighting", /\b(light|lighting|aputure|godox|nanlite|amaran|led panel|softbox|hmi|fresnel|600d|300d|120d|forza|lantern|tube)\b/i],
  ["Audio", /\b(mic|microphone|rode|røde|sennheiser|zoom h\d|recorder|wireless go|lav|lavalier|boom|deity|tascam|ntg|shotgun)\b/i],
  ["Drones", /\b(drone|mavic|mini\s?\d|air\s?\d|fpv|avata|dji (air|mini|neo))\b/i],
  ["Stabilizers", /\b(gimbal|ronin|crane|stabilizer|dji rs|rs\s?\d|rsc|moza|zhiyun)\b/i],
  ["Monitors", /\b(monitor|atomos|ninja|shinobi|smallhd|director|feelworld)\b/i],
  ["Power", /\b(battery|batteries|v-?mount|v-?lock|power|charger|np-?f|d-?tap)\b/i],
  ["Grip", /\b(tripod|slider|dolly|clamp|magic arm|c-?stand|sandbag|mount|cage|rig|matte box|follow focus)\b/i],
];

function deriveCategory(name: string): string {
  for (const [cat, re] of CATEGORY_RULES) if (re.test(name)) return cat;
  return "Accessories";
}

function cleanTitle(name: string): string {
  return name.replace(/\s+/g, " ").trim();
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

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

/** Pull dbcinema catalog from RMv2 and upsert listings + inventory units. */
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

    const live = products.filter(
      (p) => p.isPublished && !p.isMarketingOnly && p.name,
    );

    const payload = live.map((p) => {
      const prices = p.prices ?? [];
      const pick = (d: number) =>
        prices.find((x) => x.days === d)?.pricePerDay ??
        prices.find((x) => x.days === d)?.price;
      const daily = pick(1) ?? prices[0]?.pricePerDay ?? 0;
      const images = (p.images ?? [])
        .map((i) => i.fullSizeUrl ?? i.thumbnailUrl)
        .filter((u): u is string => !!u);
      const firstListing = (p.listings ?? [])[0];
      const title = cleanTitle(p.name!);
      // unavailableDates: keep ISO strings; Hygglo sends strings or {from,to}
      const unavailable = (p.unavailableDates ?? []).map((d) =>
        typeof d === "string" ? d : JSON.stringify(d),
      );
      return {
        hyggloProductId: p.productId,
        masterItemId: p.masterItemId,
        masterQty: p.masterItemId ? qtyByItem.get(p.masterItemId) ?? 1 : 1,
        slug: `${slugify(title)}-${p.productId}`,
        title,
        category: deriveCategory(title),
        heroImageUrl: images[0],
        gallery: images,
        pricing: {
          daily,
          day3: pick(3),
          day7: pick(7),
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
        heroImageUrl: v.optional(v.string()),
        gallery: v.array(v.string()),
        pricing: v.object({
          daily: v.number(),
          day3: v.optional(v.number()),
          day7: v.optional(v.number()),
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

    // unit key = masterItemId when present, else the product itself
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
          quantityOwned: qty,
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
      const sku = it.masterItemId
        ? `mi-${it.masterItemId}`
        : `prod-${it.hyggloProductId}`;
      const unitId = await ensureUnit(
        unitKey,
        sku,
        it.title,
        it.masterQty,
        it.replacementCost,
        it.masterItemId,
        it.hyggloProductId,
      );

      const existing = await ctx.db
        .query("listings")
        .withIndex("by_slug", (q) => q.eq("slug", it.slug))
        .first();
      const doc = {
        slug: it.slug,
        title: it.title,
        category: it.category,
        heroImageR2Key: it.heroImageUrl, // hotlink for now; R2 migration later
        gallery: it.gallery,
        pricing: it.pricing,
        depositAmount: it.depositAmount,
        components: [{ inventoryUnitId: unitId as any, qty: 1 }],
        hyggloListingSlug: it.hyggloListingSlug,
        hyggloProductId: it.hyggloProductId,
        unavailableDates: it.unavailableDates,
        publicUrl: it.publicUrl,
        minimumRentalDays: it.minimumRentalDays,
        active: true,
      };
      if (existing) {
        await ctx.db.patch(existing._id, doc);
      } else {
        await ctx.db.insert("listings", doc);
        listingCount++;
      }
    }

    return { listings: listingCount, units: unitCount };
  },
});
