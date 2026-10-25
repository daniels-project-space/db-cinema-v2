import { NextRequest, NextResponse } from "next/server";
import { ConvexHttpClient } from "convex/browser";
import { api } from "@cvx/_generated/api";
import { quote } from "@/lib/pricing";
import { lensUpgrade } from "../../../../shared/recommendationPolicy";
import { kitWarnings } from "@/lib/compat";
import { rateLimit } from "@/lib/ratelimit";

export const maxDuration = 60;
const msOf = (d: string) => { const t = Date.parse(/T/.test(d) ? d : d + "T00:00:00Z"); return Number.isNaN(t) ? 0 : t; };

function currentQuote(listing: any, days: number) {
  const q = quote(listing.pricing, days);
  const total = listing.quietDeal ? Math.round(q.total * (1 - listing.quietDeal / 100)) : q.total;
  return { ...q, total, perDay: Math.round(total / days * 100) / 100 };
}

export async function POST(req: NextRequest) {
  const rl = await rateLimit(req, "compat", 60, 60_000);
  if (!rl.allowed) return NextResponse.json({ warnings: [], upgrades: [] }, { status: 429, headers: { "retry-after": String(rl.retryAfterSec) } });
  const b: any = await req.json().catch(() => ({}));
  if (!Array.isArray(b.items) || b.items.length > 100 || b.items.some((item: any) => !item || typeof item.listingId !== "string"))
    return NextResponse.json({ warnings: [], upgrades: [], error: "Invalid basket." }, { status: 400 });
  const items: any[] = b.items;
  if (items.length === 0) return NextResponse.json({ warnings: [], upgrades: [] });
  const c = new ConvexHttpClient(process.env.NEXT_PUBLIC_CONVEX_URL!);

  const ids = items.map((i) => i.listingId).filter(Boolean);
  let cards: any[] = [];
  try { cards = await c.query(api.catalog.listingsByIds, { ids: ids as any }); }
  catch { return NextResponse.json({ warnings: [], upgrades: [], error: "Could not check the current catalogue." }, { status: 503 }); }
  const specOf = new Map(cards.map((cd) => [cd._id, cd]));
  if (ids.some(id => !specOf.has(id))) return NextResponse.json({ warnings: [], upgrades: [], error: "Your basket needs to be refreshed." }, { status: 409 });
  const days = items[0]?.start && items[0]?.end ? Math.max(1, Math.round((msOf(items[0].end) - msOf(items[0].start)) / 86400000) + 1) : 1;

  // enrich cart items with itemType + specs + perDay
  const kit = items.map((i) => {
    const cd: any = specOf.get(i.listingId) || {};
    return { ...cd, listingId: i.listingId, perDay: cd.pricing ? currentQuote(cd, days).perDay : null };
  });
  const warnings = kitWarnings(kit);
  const upgrades: any[] = [];
  // A swap needs one exact, separately priced source. Bundled glass cannot be
  // removed independently; never sell another same-focal lens as its upgrade.
  const window = items[0];
  const sameWindow = window?.start && window?.end && window.pickupTime && window.returnTime && items.every(i =>
    i.start === window.start && i.end === window.end &&
    i.pickupTime === window.pickupTime && i.returnTime === window.returnTime);
  if (sameWindow && kit.some(i => i.itemType === "lens" && i.specs?.tier === "standard")) {
    const lenses: any[] = await c.query(api.catalog.byItemType, { types: ["lens"] });
    const candidates = lenses.filter(candidate => lensUpgrade(candidate, kit))
      .sort((a, b) => (b.demandScore ?? 0) - (a.demandScore ?? 0));
    for (const cand of candidates.slice(0, 12)) {
      const replaced: any = lensUpgrade(cand, kit);
      if (!replaced) continue;
      // Two identical source lines are ambiguous: a single click must not
      // silently remove just one of several rented lenses.
      if (items.filter(i => i.listingId === replaced.listingId).length !== 1) continue;
      const av: any = await c.query(api.availability.forTimeSlots, {
        listingId: cand._id, start: msOf(window.start), end: msOf(window.end),
        pickupTime: window.pickupTime, returnTime: window.returnTime,
        items: items.filter(i => i.listingId !== replaced.listingId).map(i => ({
          listingId: i.listingId, start: msOf(i.start), end: msOf(i.end),
          pickupTime: i.pickupTime, returnTime: i.returnTime,
        })),
      });
      if ((av?.available ?? 0) <= 0 || !av.pickupSlots?.includes(window.pickupTime) || !av.returnSlots?.includes(window.returnTime)) continue;
      const q = currentQuote(cand, days);
      upgrades.push({
        listingId: cand._id, slug: cand.slug, title: cand.title,
        image: cand.heroImage ?? null, imageSources: cand.imageSources,
        start: window.start, end: window.end, pickupTime: window.pickupTime, returnTime: window.returnTime,
        days, perDay: q.perDay, total: q.total, deposit: cand.depositAmount ?? 0,
        replaceListingId: replaced.listingId, replaceTitle: replaced.title,
        diffPerDay: Math.round((q.perDay - replaced.perDay) * 100) / 100,
        reason: `Replace ${replaced.title} with premium glass at the same focal length; native mount and sensor coverage checked.`,
      });
      break;
    }
  }

  return NextResponse.json({ warnings, upgrades });
}
