import { NextRequest, NextResponse } from "next/server";
import { ConvexHttpClient } from "convex/browser";
import { api } from "@cvx/_generated/api";
import { quote } from "@/lib/pricing";

export const maxDuration = 60;
const msOf = (d: string) => { const t = Date.parse(/T/.test(d) ? d : d + "T00:00:00Z"); return Number.isNaN(t) ? 0 : t; };
const FOCAL_THREAD: Record<string, number> = { "28-70": 67, "24-70": 82, "16-35": 72, "24-105": 77, "70-200": 77, "24-240": 67 };
const battOk = (camBatt: string, batt: string) =>
  camBatt === batt || camBatt.includes(batt) || batt.includes(camBatt);

export async function POST(req: NextRequest) {
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
  const nds = kit.filter((x) => x.itemType === "nd-filter");
  const batteries = kit.filter((x) => x.itemType === "battery");
  const warnings: any[] = [];

  // 1) redundant lens — camera bundle already includes a lens
  for (const cam of cameras)
    if (cam.specs.includesLens && lenses.length)
      warnings.push({ level: "info", text: `Your ${cam.title.slice(0, 34)} already includes a ${cam.specs.lensFocal || "kit"}mm lens — the ${lenses[0].title.slice(0, 28)} would be a second lens.` });

  // 2) lens mount vs camera
  const camMounts = cameras.map((c) => c.specs.mount).filter(Boolean);
  const actionOnly = cameras.length > 0 && cameras.every((c) => c.specs.mount === "fixed");
  if (actionOnly && lenses.length)
    warnings.push({ level: "error", text: `Your action camera has a fixed lens — separate lenses won't attach.` });
  for (const l of lenses) {
    const lm = l.specs.mount;
    if (!lm || camMounts.length === 0 || actionOnly) continue;
    if (camMounts.includes(lm)) continue;
    if (lm === "EF" && camMounts.some((m) => m === "E" || m === "RF"))
      warnings.push({ level: "warn", text: `${l.title.slice(0, 30)} is EF mount — needs an EF→${camMounts[0]} adapter for your camera.` });
    else
      warnings.push({ level: "error", text: `${l.title.slice(0, 30)} (${lm} mount) doesn't fit your ${camMounts[0]}-mount camera.` });
  }

  // 3) ND thread vs lens / kit-lens thread
  const lensThreads = lenses.map((l) => l.specs.filterThreadMm).filter(Boolean);
  for (const cam of cameras) if (cam.specs.includesLens && cam.specs.lensFocal && FOCAL_THREAD[cam.specs.lensFocal]) lensThreads.push(FOCAL_THREAD[cam.specs.lensFocal]);
  for (const nd of nds) {
    const ndT = nd.specs.filterThreadMm;
    if (ndT && lensThreads.length && !lensThreads.includes(ndT))
      warnings.push({ level: "warn", text: `The ${ndT}mm ${nd.title.slice(0, 20)} won't fit your lens (Ø${[...new Set(lensThreads)].join("/")}mm) — no step-ring available.` });
  }

  // 4) battery vs camera
  const camBatts = cameras.map((c) => c.specs.batteryType).filter(Boolean);
  for (const bat of batteries) {
    const bt = bat.specs.batteryType;
    if (bt && camBatts.length && !camBatts.some((cb) => battOk(cb, bt)))
      warnings.push({ level: "error", text: `The ${bat.title.slice(0, 26)} (${bt}) won't power your camera (needs ${camBatts[0]}).` });
  }

  // ── upgrades: swap a standard lens (or kit lens) for a premium (GM), priced as the difference ──
  const upgrades: any[] = [];
  const wantsUpgrade = lenses.some((l) => l.specs.tier !== "premium") || cameras.some((c) => c.specs.includesLens);
  if (wantsUpgrade && items[0]?.start && items[0]?.end) {
    const replaced = lenses.find((l) => l.specs.tier !== "premium") || null;
    const allLenses: any[] = await c.query(api.catalog.byItemType, { types: ["lens"] });
    const candidates = allLenses
      .filter((l) => l.specs?.tier === "premium" && !ids.includes(l._id))
      .filter((l) => camMounts.length === 0 || !l.specs?.mount || camMounts.includes(l.specs.mount) || (l.specs.mount === "EF"));
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
        reason: replaced ? `Upgrade from ${replaced.title.slice(0, 24)} to pro GM glass` : "Premium GM upgrade over your kit lens",
      });
      break;
    }
  }

  return NextResponse.json({ warnings, upgrades });
}
