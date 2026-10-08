import { londonStartOfDay } from "./cancellationPolicy";

export type CalendarLine = { title: string; start: number; end: number; qty: number; returnTime?: string | null };
export type CalendarRental = { _id: string; status: string; lineItems: CalendarLine[]; pickupTime?: string | null; returnTime?: string | null };
export type CalendarEntry = { rental: CalendarRental; lines: CalendarLine[]; pickup: boolean; returns: CalendarLine[] };

/** London civil dates, bounded by the viewed month, rather than a booking's
 * earliest/latest union. One entry per rental/day retains every actual line. */
export function calendarMonth(rentals: CalendarRental[], year: number, month: number) {
  const first = Date.UTC(year, month, 1), last = Date.UTC(year, month + 1, 0);
  const cover = new Map<number, CalendarEntry[]>();
  for (const rental of rentals) {
    const days = new Map<number, CalendarEntry>();
    for (const line of rental.lineItems) {
      if (!Number.isFinite(line.start) || !Number.isFinite(line.end) || line.end < line.start) continue;
      const start = londonStartOfDay(line.start), end = londonStartOfDay(line.end);
      for (let day = Math.max(first, start); day <= Math.min(last, end); day += 86400000) {
        let entry = days.get(day);
        if (!entry) { entry = { rental, lines: [], pickup: false, returns: [] }; days.set(day, entry); }
        entry.lines.push(line);
        if (day === start) entry.pickup = true;
        if (day === end) entry.returns.push(line);
      }
    }
    for (const [day, entry] of days) { if (!cover.has(day)) cover.set(day, []); cover.get(day)!.push(entry); }
  }
  return cover;
}
