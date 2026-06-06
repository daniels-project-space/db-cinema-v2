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
