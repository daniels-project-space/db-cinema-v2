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

async function pickByType(ctx: any, itemType: string) {
  const all = await ctx.db
    .query("listings")
    .withIndex("by_active", (q: any) => q.eq("active", true))
    .collect();
  const cands = all.filter(
    (l: any) => (l.itemType ?? "") === itemType && images(l).length > 0,
  );
  // a representative mid-priced one (not the most expensive)
  cands.sort((a: any, b: any) => (a.pricing?.daily ?? 0) - (b.pricing?.daily ?? 0));
  return cands[Math.floor(cands.length / 2)] ?? cands[0] ?? null;
}

/**
 * Cart-conditional offers:
 *  - spend > £300  -> a tripod at 50% off (if none in cart)
 *  - renting a camera -> a gimbal at 30% off (if none in cart)
 * Offer items are excluded from promo-code discounts (non-stackable).
 */
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
    const subtotal = items.reduce((n, i) => n + i.total, 0);
    let hasCamera = false,
      hasTripod = false,
      hasGimbal = false;
    for (const i of items) {
      const l = await ctx.db.get(i.listingId);
      const t = l?.itemType ?? "";
      if (t === "camera-body") hasCamera = true;
      if (t === "tripod") hasTripod = true;
      if (t === "gimbal") hasGimbal = true;
    }
    const range = items[0];
    const d = days(range.start, range.end);

    const offers: any[] = [];
    const build = (l: any, pct: number, offerType: string, reason: string) => {
      const q = quote(l.pricing, d);
      const offerTotal = Math.round(q.total * (1 - pct / 100));
      offers.push({
        offerType,
        pct,
        reason,
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
    };

    if (subtotal > 300 && !hasTripod) {
      const l = await pickByType(ctx, "tripod");
      if (l) build(l, 50, "tripod50", "You've spent over £300");
    }
    if (hasCamera && !hasGimbal) {
      const l = await pickByType(ctx, "gimbal");
      if (l) build(l, 30, "gimbal30", "Great with your camera");
    }
    return offers;
  },
});
