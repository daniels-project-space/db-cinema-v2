import { query } from "./_generated/server";
import { v } from "convex/values";
import { rentalUnavailable, marketingRedirect } from "./lib/marketingInventory";
import { assertRentalInventory } from "./lib/rentalInventory";
import { quote } from "./lib/pricing";
import { listingImages } from "./lib/catalogImages";
import { deriveItemType } from "./lib/taxonomy";
import { bestCompat, parseMounts } from "./lib/mount";

/** Listing packs such as "3x Sony FX3" represent three requested bodies. */
const packSize = (title: string) => Math.min(100, Math.max(1, Number(title.match(/^\s*(\d+)\s*[x×]/i)?.[1] ?? 1)));

export const sets = query({
  args: { items: v.array(v.object({ key: v.string(), listingId: v.id("listings"), start: v.number(), end: v.number() })), sourceKey: v.string(), limit: v.optional(v.number()) },
  handler: async (ctx, { items, sourceKey, limit = 2 }) => {
    if (items.length > 100 || !Number.isSafeInteger(limit) || limit < 1 || limit > 20) throw Error("Invalid replacement request");
    const source = items.find(i => i.key === sourceKey);
    if (!source || !Number.isSafeInteger(source.start) || !Number.isSafeInteger(source.end) || source.end < source.start || source.end - source.start > 365 * 86400000) return null;
    const original = await ctx.db.get(source.listingId);
    if (!original) return null;
    const group = items.filter(i => i.listingId === source.listingId && i.start === source.start && i.end === source.end);
    const keys = group.map(i => i.key), requested = group.length * packSize(original.title);
    const cache = { records: new Map<string, any>(), reservations: new Map<string, any[]>() };
    const days = Math.round((source.end - source.start) / 86400000) + 1;
    try { await assertRentalInventory(ctx, items.map(i => ({ ...i, qty: 1 })), undefined, cache); return { keys, requested, options: [], singles: [], searchLimited: false }; } catch {}
    const retained = await Promise.all(items.filter(i => !keys.includes(i.key)).map(async line => ({ line, listing: await ctx.db.get(line.listingId) })));
    const type = original.itemType ?? deriveItemType(original.title);
    const redirect = marketingRedirect(original);
    const candidates = (await ctx.db.query("listings").withIndex("by_category", q => q.eq("category", original.category)).collect())
      .filter(l => !rentalUnavailable(l) && (l.itemType ?? deriveItemType(l.title)) === type && days >= (l.minimumRentalDays ?? 1) && packSize(l.title) <= requested)
      .filter(candidate => !retained.some(r => {
        if (!r.listing || rentalUnavailable(r.listing)) return false;
        const other = r.listing.itemType ?? deriveItemType(r.listing.title);
        const lens = type === "lens" && other === "camera-body" ? candidate : other === "lens" && type === "camera-body" ? r.listing : null;
        const body = lens === candidate ? r.listing : candidate;
        return lens && bestCompat(parseMounts(lens.specs?.mount), parseMounts(body.specs?.mount)) === "incompatible";
      })).sort((a, b) => {
        const score = (l: any) => (redirect?.alternative.test(l.title) ? 100 : 0) + (l.specs?.mount && l.specs.mount === original.specs?.mount ? 20 : 0) - Math.abs(l.pricing.daily - original.pricing.daily) / Math.max(1, original.pricing.daily);
        return score(b) - score(a) || String(a._id).localeCompare(String(b._id));
      });
    const options: { id: string; total: number; items: { listingId: string; slug: string; title: string; heroImage: string | null; days: number; perDay: number; total: number; deposit: number }[] }[] = [];
    const describe = (l: typeof original) => {
      const price = quote(l.pricing, days);
      const total = l.quietDeal ? Math.round(price.total * (1 - l.quietDeal / 100)) : price.total;
      return { listingId: String(l._id), slug: l.slug, title: l.title, heroImage: listingImages(l)[0] ?? null, days, perDay: Math.round(total / days * 100) / 100, total, deposit: l.depositAmount };
    };
    const availability = new Map<string, boolean>();
    async function available(trial: typeof candidates) {
          const signature = trial.map(l => String(l._id)).sort().join("|");
          if (availability.has(signature)) return availability.get(signature)!;
          const units = new Set(trial.flatMap(l => l.components.map(c => String(c.inventoryUnitId))));
          const keep = retained.filter(r => r.listing && !rentalUnavailable(r.listing) && r.listing.components.some(c => units.has(String(c.inventoryUnitId))));
          try { await assertRentalInventory(ctx, [...trial.map(l => ({ listingId: l._id, start: source!.start, end: source!.end, qty: 1 })), ...keep.map(r => ({ ...r.line, qty: 1 }))], undefined, cache); }
          catch { availability.set(signature, false); return false; }
          availability.set(signature, true); return true;
    }
    // Keep independently available cards even when no full set fits. Customers
    // may add these while the unavailable request stays visible for resolution.
    const singles = [];
    const viable: typeof candidates = [];
    for (const candidate of candidates) if (await available([candidate])) {
      viable.push(candidate);
      if (singles.length < limit) singles.push(describe(candidate));
    }
    let examined = 0, searchLimited = false;
    // Backtrack rather than greedily taking a pack that strands the remaining
    // quantity. Non-decreasing indices enumerate each combination only once.
    async function search(selected: typeof candidates, covered: number, first: number): Promise<void> {
      if (options.length >= limit || searchLimited) return;
      if (covered === requested) {
        const replacements = selected.map(describe);
        options.push({ id: selected.map(l => String(l._id)).sort().join("|"), total: replacements.reduce((sum, l) => sum + l.total, 0), items: replacements });
        return;
      }
      if (selected.length + retained.length >= 100) return;
      for (let index = first; index < viable.length && options.length < limit && !searchLimited; index++) {
        const candidate = viable[index], quantity = packSize(candidate.title);
        if (covered + quantity > requested) continue;
        if (++examined > 10000) { searchLimited = true; return; }
        const trial = [...selected, candidate];
        if (await available(trial)) await search(trial, covered + quantity, index);
      }
    }
    await search([], 0, 0);
    return { keys, requested, options, singles, searchLimited };
  },
});

/** A suggestion is one replacement, evaluated with every retained line that
 * consumes its physical units. Other unresolved lines do not hide suggestions.
 * Each switch is rechecked by the client, and final checkout checks the full kit.
 */
export const forCart = query({
  args: { items: v.array(v.object({ key: v.string(), listingId: v.id("listings"), start: v.number(), end: v.number() })), limit: v.optional(v.number()) },
  handler: async (ctx, { items, limit = 2 }) => {
    if (!Number.isFinite(limit)) throw Error("Invalid replacement limit");
    limit = Math.max(2, Math.min(100, Math.floor(limit)));
    if (items.length > 100) throw Error("Basket is too large");
    const originals = await Promise.all(items.map(i => ctx.db.get(i.listingId)));
    const result: Record<string, { listingId: string; slug: string; title: string; heroImage: string | null; days: number; perDay: number; total: number; deposit: number }[]> = {};
    const categories = new Map<string, any[]>();
    for (let index = 0; index < items.length; index++) {
      const source = originals[index], line = items[index];
      if (!source || !Number.isSafeInteger(line.start) || !Number.isSafeInteger(line.end) || line.end < line.start || line.end-line.start > 365*86400000) continue;
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
        if (result[line.key].length >= limit) break;
      }
    }
    return result;
  },
});
