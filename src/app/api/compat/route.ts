import { NextRequest, NextResponse } from "next/server";
import { ConvexHttpClient } from "convex/browser";
import { api } from "@cvx/_generated/api";
import { quote } from "@/lib/pricing";
import { bestCompat, parseMounts } from "@/lib/mount";
import { kitWarnings } from "@/lib/compat";
import { rateLimit } from "@/lib/ratelimit";

export const maxDuration = 60;
const msOf = (d: string) => { const t = Date.parse(/T/.test(d) ? d : d + "T00:00:00Z"); return Number.isNaN(t) ? 0 : t; };

export async function POST(req: NextRequest) {
  const rl = await rateLimit(req, "compat", 60, 60_000);
  if (!rl.allowed) return NextResponse.json({ warnings: [], upgrades: [] }, { status: 429, headers: { "retry-after": String(rl.retryAfterSec) } });
  const b: any = await req.json().catch(() => ({}));
  const items: any[] = b.items || [];
  if (items.length === 0) return NextResponse.json({ warnings: [], upgrades: [] });
  const c = new ConvexHttpClient(process.env.NEXT_PUBLIC_CONVEX_URL!);

  const ids = items.map((i) => i.listingId).filter(Boolean);
  let cards: any[] = [];
  try { cards = await c.query(api.catalog.listingsByIds, { ids: ids as any }); } catch {}
  const specOf = new Map(cards.map((cd) => [cd._id, cd]));
  const days = items[0]?.start && items[0]?.end ? Math.max(1, Math.round((msOf(items[0].end) - msOf(items[0].start)) / 86400000) + 1) : 1;

  // enrich cart items with itemType + specs + perDay
  const kit = items.map((i) => {
    const cd: any = specOf.get(i.listingId) || {};
    return { ...i, itemType: cd.itemType ?? null, specs: cd.specs ?? {}, perDay: i.total ? Math.round(i.total / days) : null };
  });
  const cameras = kit.filter((x) => x.itemType === "camera-body");
  const lenses = kit.filter((x) => x.itemType === "lens");

  // ALL pairwise compatibility (mount / coverage / filter / battery / redundant / fixed-lens)
  // is decided by the one shared engine — src/lib/compat.ts — so the cart can never diverge
  // from what the bot and assembler reason about.
  const warnings = kitWarnings(kit);
  const camMounts = cameras.map((c) => c.specs.mount).filter(Boolean);
  const camM = [...new Set(camMounts.flatMap((m: string) => parseMounts(m)))];

  // ── upgrades: swap a standard lens (or kit lens) for a premium (GM), priced as the difference ──
  const upgrades: any[] = [];
  const wantsUpgrade = lenses.some((l) => l.specs.tier !== "premium") || cameras.some((c) => c.specs.includesLens);
  if (wantsUpgrade && items[0]?.start && items[0]?.end) {
    const replaced = lenses.find((l) => l.specs.tier !== "premium") || null;
    const allLenses: any[] = await c.query(api.catalog.byItemType, { types: ["lens"] });
    const candidates = allLenses
      .filter((l) => l.specs?.tier === "premium" && !ids.includes(l._id))
      .filter((l) => camM.length === 0 || !l.specs?.mount || bestCompat(parseMounts(l.specs.mount), camM) !== "incompatible");
    // prefer a GM zoom matching the kit focal
    const kitFocal = replaced?.specs?.lensFocal || cameras.find((c) => c.specs.includesLens)?.specs?.lensFocal;
    candidates.sort((a, z) => {
      const am = kitFocal && a.title.includes(kitFocal) ? 0 : 1;
      const zm = kitFocal && z.title.includes(kitFocal) ? 0 : 1;
      const ag = /gm|g master/i.test(a.title) ? 0 : 1;
      const zg = /gm|g master/i.test(z.title) ? 0 : 1;
      return am - zm || ag - zg;
    });
    for (const cand of candidates.slice(0, 2)) {
      const av: any = await c.query(api.availability.forListing, { listingId: cand._id, start: msOf(items[0].start), end: msOf(items[0].end) });
      if ((av?.available ?? 0) <= 0) continue;
      const q: any = quote(cand.pricing, days);
      const diffPerDay = replaced?.perDay ? Math.max(0, q.perDay - replaced.perDay) : q.perDay;
      upgrades.push({
        listingId: cand._id, slug: cand.slug, title: cand.title, image: cand.heroImage ?? null,
        start: items[0].start, end: items[0].end, days, perDay: q.perDay, total: q.total, deposit: cand.depositAmount ?? 0,
        replaceListingId: replaced?.listingId ?? null,
        replaceTitle: replaced?.title ?? null,
        diffPerDay,
        reason: replaced ? `Upgrade from ${String(replaced.title ?? "your lens").slice(0, 24)} to pro GM glass` : "Premium GM upgrade over your kit lens",
      });
      break;
    }
  }

  return NextResponse.json({ warnings, upgrades });
}
