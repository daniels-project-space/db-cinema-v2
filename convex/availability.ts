import { query } from "./_generated/server";
import { v } from "convex/values";

/**
 * P1 read-path availability: a listing is available for [start,end] if none of
 * the requested days fall in the mirrored Hygglo `unavailableDates`.
 *
 * P2 will replace this with the full BOM-over-reservation-ledger check (walk
 * components → free = quantityOwned − overlapping reservations from all
 * sources) once site bookings write into the ledger.
 */

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

/** Normalise stored unavailable entries (ISO strings or {from,to} JSON). */
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
      if (from) {
        for (const day of dayRange(Date.parse(from), Date.parse(to)))
          set.add(day);
      }
    } catch {
      /* ignore unparseable */
    }
  }
  return set;
}

/**
 * Quantity-aware availability for a listing over [start,end]: how many can be
 * booked, given physical units owned minus overlapping reservations (site +
 * subscription + hygglo), and Hygglo blocked dates.
 */
export const forListing = query({
  args: { listingId: v.id("listings"), start: v.number(), end: v.number() },
  handler: async (ctx, { listingId, start, end }) => {
    const l = await ctx.db.get(listingId);
    if (!l || !l.active) return { available: 0, owned: 0 };

    const requested = dayRange(start, end);
    const blocked = blockedSet(l.unavailableDates ?? []);
    if (requested.some((d) => blocked.has(d)))
      return { available: 0, owned: 0, blocked: true };

    let minAvail = Infinity;
    let owned = 0;
    for (const comp of l.components) {
      const unit = await ctx.db.get(comp.inventoryUnitId);
      const ownedQ = unit?.quantityOwned ?? 1;
      owned = ownedQ;
      const res = await ctx.db
        .query("reservations")
        .withIndex("by_unit", (q) => q.eq("inventoryUnitId", comp.inventoryUnitId))
        .collect();
      const used = res
        .filter(
          (r) =>
            (r.status === "confirmed" || r.status === "active" || r.status === "hold") &&
            r.start <= end &&
            r.end >= start,
        )
        .reduce((n, r) => n + (r.qty || 1), 0);
      const free = Math.max(0, ownedQ - used);
      const perBooking = comp.qty || 1;
      minAvail = Math.min(minAvail, Math.floor(free / perBooking));
    }
    return { available: minAvail === Infinity ? 0 : minAvail, owned };
  },
});

/**
 * Cart-level check: for each distinct listing, how many can be booked over the
 * cart's date span vs how many the cart demands. Powers grey-out + over-stock
 * blocking ("2 speaker sets but only 2 in stock").
 */
export const forCart = query({
  args: {
    items: v.array(
      v.object({ listingId: v.id("listings"), start: v.number(), end: v.number() }),
    ),
  },
  handler: async (ctx, { items }) => {
    const groups = new Map<string, { start: number; end: number; demanded: number }>();
    for (const it of items) {
      const g = groups.get(it.listingId);
      if (g) {
        g.start = Math.min(g.start, it.start);
        g.end = Math.max(g.end, it.end);
        g.demanded += 1;
      } else {
        groups.set(it.listingId, { start: it.start, end: it.end, demanded: 1 });
      }
    }
    const result: Record<string, { available: number; demanded: number; ok: boolean }> = {};
    for (const [listingId, g] of groups) {
      const l = await ctx.db.get(listingId as any);
      let available = 0;
      if (l && (l as any).active) {
        const requested = dayRange(g.start, g.end);
        const blocked = blockedSet((l as any).unavailableDates ?? []);
        if (!requested.some((d) => blocked.has(d))) {
          let minAvail = Infinity;
          for (const comp of (l as any).components) {
            const unit: any = await ctx.db.get(comp.inventoryUnitId);
            const ownedQ = unit?.quantityOwned ?? 1;
            const res = await ctx.db
              .query("reservations")
              .withIndex("by_unit", (q) => q.eq("inventoryUnitId", comp.inventoryUnitId))
              .collect();
            const used = res
              .filter(
                (r) =>
                  (r.status === "confirmed" || r.status === "active" || r.status === "hold") &&
                  r.start <= g.end &&
                  r.end >= g.start,
              )
              .reduce((n, r) => n + (r.qty || 1), 0);
            minAvail = Math.min(minAvail, Math.floor(Math.max(0, ownedQ - used) / (comp.qty || 1)));
          }
          available = minAvail === Infinity ? 0 : minAvail;
        }
      }
      result[listingId] = { available, demanded: g.demanded, ok: g.demanded <= available };
    }
    return result;
  },
});

export const check = query({
  args: { listingId: v.id("listings"), start: v.number(), end: v.number() },
  handler: async (ctx, { listingId, start, end }) => {
    const l = await ctx.db.get(listingId);
    if (!l || !l.active) return { available: false, reason: "unavailable" };
    const requested = dayRange(start, end);
    const blocked = blockedSet(l.unavailableDates ?? []);
    const clash = requested.filter((d) => blocked.has(d));
    const minDays = l.minimumRentalDays ?? 1;
    if (requested.length < minDays)
      return { available: false, reason: `min ${minDays} days`, blocked: clash };
    return { available: clash.length === 0, blocked: clash };
  },
});
