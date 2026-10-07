/** Replacement value, in pennies, over inclusive rental days. */
export const RENTAL_VALUE_CAP_PENCE = 1_500_000;
export type ValueInterval = { start: number; end: number; valuePence: number };
export function peakRentalValue(intervals: ValueInterval[], at?: number) {
  const events = new Map<number, number>();
  for (const line of intervals) {
    if (!Number.isSafeInteger(line.start) || !Number.isSafeInteger(line.end) || line.end < line.start || !Number.isSafeInteger(line.valuePence) || line.valuePence < 0)
      throw Error("Equipment replacement value or rental dates need a team check.");
    const start = at === undefined ? line.start : Math.max(at, line.start);
    const end = line.end + 86400000;
    if (end <= start) continue;
    events.set(start, (events.get(start) ?? 0) + line.valuePence);
    events.set(end, (events.get(end) ?? 0) - line.valuePence);
  }
  let total = 0, peak = 0;
  for (const [, change] of [...events].sort(([a], [b]) => a - b)) { total += change; peak = Math.max(peak, total); }
  return peak;
}
