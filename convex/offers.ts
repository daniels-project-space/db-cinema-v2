import { query } from "./_generated/server";
import { v } from "convex/values";
import { quote } from "./lib/pricing";

function images(l: any): string[] {
  const r2 = l.r2Images ?? [];
  if (r2.length) return r2;
  return l.sourceImages ?? l.gallery ?? [];
}
const days = (start: number, end: number) =>
  Math.max(1, Math.round((end - start) / 86400000) + 1);

/**
 * Contextual add-on offers — each only appears when the cart contains gear it
 * actually complements, and you don't already have that type. Priority order;
 * capped so the cart isn't spammed. (No "spend £300" tripod-for-anyone deal.)
 */
const RULES: { want: string; pct: number; needs: string[]; reason: string }[] = [
  { want: "nd-filter", pct: 50, needs: ["lens", "camera-body"], reason: "Control exposure on your lens" },
  { want: "tripod", pct: 50, needs: ["camera-body", "light", "monitor", "slider"], reason: "Lock off steady shots" },
  { want: "gimbal", pct: 30, needs: ["camera-body"], reason: "Smooth movement for your camera" },
  { want: "wireless-mic", pct: 40, needs: ["camera-body", "speaker", "dj-deck"], reason: "Clean wireless audio" },
  { want: "battery", pct: 40, needs: ["camera-body", "light", "monitor", "drone"], reason: "Power for a full day" },
  { want: "mixer", pct: 25, needs: ["dj-deck", "speaker"], reason: "Mix your set" },
  { want: "monitor", pct: 30, needs: ["camera-body"], reason: "See your shot in detail" },
];
const MAX_OFFERS = 3;

async function pickByType(ctx: any, itemType: string, exclude: Set<string>) {
  const all = await ctx.db
    .query("listings")
    .withIndex("by_active", (q: any) => q.eq("active", true))
    .collect();
  const cands = all.filter(
    (l: any) => (l.itemType ?? "") === itemType && images(l).length > 0 && !exclude.has(l._id),
  );
  cands.sort((a: any, b: any) => (a.pricing?.daily ?? 0) - (b.pricing?.daily ?? 0));
  return cands[Math.floor(cands.length / 2)] ?? cands[0] ?? null;
}

export const forCart = query({
  args: {
    items: v.array(
      v.object({
        listingId: v.id("listings"),
        start: v.number(),
        end: v.number(),
        total: v.number(),
      }),
    ),
  },
  handler: async (ctx, { items }) => {
    if (items.length === 0) return [];

    // what's in the cart: types present + ids to exclude
    const present = new Set<string>();
    const cartIds = new Set<string>();
    for (const i of items) {
      cartIds.add(i.listingId);
      const l = await ctx.db.get(i.listingId);
      if (l) present.add((l as any).itemType ?? "accessory");
    }

    const range = items[0];
    const d = days(range.start, range.end);
    const offers: any[] = [];

    for (const rule of RULES) {
      if (offers.length >= MAX_OFFERS) break;
      if (present.has(rule.want)) continue; // already have this type
      if (!rule.needs.some((t) => present.has(t))) continue; // not relevant to cart
      const l = await pickByType(ctx, rule.want, cartIds);
      if (!l) continue;
      const q = quote(l.pricing, d);
      const offerTotal = Math.round(q.total * (1 - rule.pct / 100));
      offers.push({
        offerType: `${rule.want}${rule.pct}`,
        pct: rule.pct,
        reason: rule.reason,
        listingId: l._id,
        slug: l.slug,
        title: l.title,
        heroImage: images(l)[0] ?? null,
        start: range.start,
        end: range.end,
        days: d,
        regularTotal: q.total,
        total: offerTotal,
        perDay: Math.round(offerTotal / d),
        deposit: l.depositAmount,
      });
    }
    return offers;
  },
});
