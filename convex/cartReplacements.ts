import { query } from "./_generated/server";
import { v } from "convex/values";
import { rentalUnavailable, marketingRedirect } from "./lib/marketingInventory";
import { assertRentalInventory } from "./lib/rentalInventory";
import { quote } from "./lib/pricing";
import { listingImages } from "./lib/catalogImages";
import { deriveItemType } from "./lib/taxonomy";
import { bestCompat, parseMounts } from "./lib/mount";

/** A suggestion is one replacement, evaluated with every retained line that
 * consumes its physical units. Other unresolved lines do not hide suggestions.
 * Each switch is rechecked by the client, and final checkout checks the full kit.
 */
export const forCart = query({
  args: { items: v.array(v.object({ key: v.string(), listingId: v.id("listings"), start: v.number(), end: v.number() })) },
  handler: async (ctx, { items }) => {
    if (items.length > 100) throw Error("Basket is too large");
    const originals = await Promise.all(items.map(i => ctx.db.get(i.listingId)));
    const result: Record<string, { listingId: string; slug: string; title: string; heroImage: string | null; days: number; perDay: number; total: number; deposit: number }[]> = {};
    const categories = new Map<string, any[]>();
    for (let index = 0; index < items.length; index++) {
      const source = originals[index], line = items[index];
      if (!source || !Number.isSafeInteger(line.start) || !Number.isSafeInteger(line.end) || line.end < line.start) continue;
      const retained = originals.flatMap((l, j) => j !== index && l && !rentalUnavailable(l) ? [{ listing: l, line: items[j] }] : []);
      const sourceUnits = new Set(source.components.map(c => String(c.inventoryUnitId)));
      try {
        await assertRentalInventory(ctx, [ { ...line, qty: 1 }, ...retained.filter(r => r.listing.components.some(c => sourceUnits.has(String(c.inventoryUnitId)))).map(r => ({ ...r.line, qty: 1 })) ]);
        continue; // available source: no substitution needed
      } catch { /* unavailable source */ }
      const days = Math.round((line.end - line.start) / 86400000) + 1;
      if (!categories.has(source.category)) categories.set(source.category, await ctx.db.query("listings").withIndex("by_category", q => q.eq("category", source.category)).collect());
      const type = source.itemType ?? deriveItemType(source.title), redirect = marketingRedirect(source);
      const score = (l: any) => {
        let score = redirect?.alternative.test(l.title) ? 100 : 0;
        if (l.specs?.mount && l.specs.mount === source.specs?.mount) score += 20;
        if (l.specs?.lensFocal && l.specs.lensFocal === source.specs?.lensFocal) score += 20;
        if (l.specs?.lensClass && l.specs.lensClass === source.specs?.lensClass) score += 10;
        const bundle = (title: string) => /\b(kit|set|bundle|ready)\b/i.test(title);
        if (bundle(l.title) === bundle(source.title)) score += 15;
        score -= Math.abs(l.pricing.daily - source.pricing.daily) / Math.max(1, source.pricing.daily);
        return score;
      };
      const candidates = categories.get(source.category)!.filter(l => l._id !== source._id && !rentalUnavailable(l) && (l.itemType ?? deriveItemType(l.title)) === type && days >= (l.minimumRentalDays ?? 1)).sort((a,b) => score(b)-score(a) || String(a._id).localeCompare(String(b._id)));
      const seen = new Set<string>();
      result[line.key] = [];
      for (const candidate of candidates) {
        const signature = candidate.components.map((c: any) => `${c.inventoryUnitId}:${c.qty}`).sort().join("|");
        if (!signature || seen.has(signature) || retained.some(r => r.line.listingId === candidate._id && r.line.start === line.start && r.line.end === line.end)) continue;
        // Do not replace glass/body with a known incompatible mount for this kit.
        const incompatible = retained.some(r => {
          const otherType = r.listing.itemType ?? deriveItemType(r.listing.title);
          const lens = type === "lens" && otherType === "camera-body" ? candidate : otherType === "lens" && type === "camera-body" ? r.listing : null;
          const body = lens === candidate ? r.listing : candidate;
          return lens && bestCompat(parseMounts(lens.specs?.mount), parseMounts(body.specs?.mount)) === "incompatible";
        });
        if (incompatible) continue;
        const units = new Set(candidate.components.map((c: any) => String(c.inventoryUnitId)));
        try {
          await assertRentalInventory(ctx, [{ listingId: candidate._id, start: line.start, end: line.end, qty: 1 }, ...retained.filter(r => r.listing.components.some(c => units.has(String(c.inventoryUnitId)))).map(r => ({ ...r.line, qty: 1 }))]);
        } catch { continue; }
        const price = quote(candidate.pricing, days);
        const total = candidate.quietDeal ? Math.round(price.total * (1-candidate.quietDeal/100)) : price.total;
        result[line.key].push({ listingId: candidate._id, slug: candidate.slug, title: candidate.title, heroImage: listingImages(candidate)[0] ?? null, days, perDay: Math.round(total/days*100)/100, total, deposit: candidate.depositAmount });
        seen.add(signature);
        if (result[line.key].length === 2) break;
      }
    }
    return result;
  },
});
