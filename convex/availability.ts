import { query } from "./_generated/server";
import { v } from "convex/values";

const DAY = 86400000;

function dayRange(startMs: number, endMs: number): string[] {
  const out: string[] = [];
  const d = new Date(startMs);
  d.setUTCHours(0, 0, 0, 0);
  const end = new Date(endMs);
  end.setUTCHours(0, 0, 0, 0);
  while (d <= end) {
    out.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}

function blockedSet(raw: string[]): Set<string> {
  const set = new Set<string>();
  for (const entry of raw) {
    if (/^\d{4}-\d{2}-\d{2}/.test(entry)) {
      set.add(entry.slice(0, 10));
      continue;
    }
    try {
      const o = JSON.parse(entry);
      const from = o.from ?? o.start ?? o.date;
      const to = o.to ?? o.end ?? from;
      if (from) for (const day of dayRange(Date.parse(from), Date.parse(to))) set.add(day);
    } catch {
      /* ignore */
    }
  }
  return set;
}

export type Iv = { start: number; end: number; qty: number };
/** Max concurrent qty across overlapping intervals (end inclusive). */
export function peak(intervals: Iv[]): number {
  const ev: [number, number][] = [];
  for (const i of intervals) {
    ev.push([i.start, i.qty]);
    ev.push([i.end + DAY, -i.qty]); // end inclusive: frees the day after
  }
  ev.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  let cur = 0,
    mx = 0;
  for (const [, delta] of ev) {
    cur += delta;
    if (cur > mx) mx = cur;
  }
  return mx;
}

const ACTIVE = new Set(["confirmed", "active", "hold"]);

async function unitReservations(ctx: any, unitId: any, lo: number, hi: number): Promise<Iv[]> {
  const res = await ctx.db
    .query("reservations")
    .withIndex("by_unit", (q: any) => q.eq("inventoryUnitId", unitId))
    .collect();
  return res
    .filter((r: any) => ACTIVE.has(r.status) && r.start <= hi && r.end >= lo)
    .map((r: any) => ({ start: r.start, end: r.end, qty: r.qty || 1 }));
}

/** Quantity-aware availability for one listing over [start,end]. */
export const forListing = query({
  args: { listingId: v.id("listings"), start: v.number(), end: v.number() },
  handler: async (ctx, { listingId, start, end }) => {
    const l = await ctx.db.get(listingId);
    if (!l || !l.active) return { available: 0, owned: 0 };
    const requested = dayRange(start, end);
    if (requested.some((d) => blockedSet(l.unavailableDates ?? []).has(d)))
      return { available: 0, owned: 0, blocked: true };

    let minAvail = Infinity;
    let owned = 0;
    for (const comp of l.components) {
      const unit: any = await ctx.db.get(comp.inventoryUnitId);
      const ownedQ = unit?.quantityOwned ?? 1;
      owned = ownedQ;
      const ivs = (await unitReservations(ctx, comp.inventoryUnitId, start, end)).map((r) => ({
        start: Math.max(r.start, start),
        end: Math.min(r.end, end),
        qty: r.qty,
      }));
      const free = Math.max(0, ownedQ - peak(ivs));
      minAvail = Math.min(minAvail, Math.floor(free / (comp.qty || 1)));
    }
    return { available: minAvail === Infinity ? 0 : minAvail, owned };
  },
});

/**
 * Cart-level, UNIT-aware check: aggregates demand per physical unit across ALL
 * cart lines (respecting each bundle's BOM qty) plus site + Hygglo + subscription
 * reservations, then flags every listing that pushes any shared unit over stock.
 */
export const forCart = query({
  args: {
    items: v.array(
      v.object({ listingId: v.id("listings"), start: v.number(), end: v.number() }),
    ),
  },
  handler: async (ctx, { items }) => {
    if (items.length === 0) return {};
    const lo = Math.min(...items.map((i) => i.start));
    const hi = Math.max(...items.map((i) => i.end));

    // resolve each cart line's components
    const lines: { listingId: string; start: number; end: number; comps: any[] }[] = [];
    for (const it of items) {
      const l = await ctx.db.get(it.listingId);
      if (l && (l as any).active)
        lines.push({ listingId: it.listingId, start: it.start, end: it.end, comps: (l as any).components });
    }

    // per-unit: owned, reservation intervals, standalone free
    const unitIds = new Set<string>();
    for (const ln of lines) for (const c of ln.comps) unitIds.add(c.inventoryUnitId);
    const owned: Record<string, number> = {};
    const resIvs: Record<string, Iv[]> = {};
    for (const uid of unitIds) {
      const unit: any = await ctx.db.get(uid as any);
      owned[uid] = unit?.quantityOwned ?? 1;
      resIvs[uid] = await unitReservations(ctx, uid, lo, hi);
    }

    // per-unit peak WITH cart demand, and standalone free (reservations only)
    const unitOver: Record<string, boolean> = {};
    const unitFree: Record<string, number> = {};
    for (const uid of unitIds) {
      const cartIvs: Iv[] = [];
      for (const ln of lines)
        for (const c of ln.comps)
          if (c.inventoryUnitId === uid) cartIvs.push({ start: ln.start, end: ln.end, qty: c.qty || 1 });
      unitOver[uid] = peak([...resIvs[uid], ...cartIvs]) > owned[uid];
      unitFree[uid] = Math.max(0, owned[uid] - peak(resIvs[uid]));
    }

    // per-listing result
    const groups = new Map<string, { comps: any[]; demanded: number }>();
    for (const ln of lines) {
      const g = groups.get(ln.listingId);
      if (g) g.demanded += 1;
      else groups.set(ln.listingId, { comps: ln.comps, demanded: 1 });
    }
    const result: Record<string, { available: number; demanded: number; ok: boolean }> = {};
    for (const [listingId, g] of groups) {
      const ok = g.comps.every((c) => !unitOver[c.inventoryUnitId]);
      const available = Math.min(
        ...g.comps.map((c) => Math.floor((unitFree[c.inventoryUnitId] ?? 0) / (c.qty || 1))),
      );
      result[listingId] = { available, demanded: g.demanded, ok };
    }
    return result;
  },
});
