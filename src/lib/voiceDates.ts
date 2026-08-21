/**
 * Date handling for the Gaffer voice agent.
 *
 * The agent cannot be trusted with dates. In a real call a caller asked to rent
 * "tomorrow" and the model called check_availability with 2023-10-12 — a date
 * three years in the past, from its training data — so availability was checked
 * against nothing and the caller was told the gear was free. The model has no
 * clock, so the clock lives here: we resolve relative speech ourselves and
 * reject anything historic rather than answering confidently from a bad date.
 *
 * Everything is London time: that's where the shop, the gear and the callers are.
 */
export const TZ = "Europe/London";

/** Today in London as YYYY-MM-DD. */
export function londonToday(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

function addDays(iso: string, n: number): string {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Day of week, 0=Sunday, for an ISO date. */
function dow(iso: string): number {
  return new Date(`${iso}T12:00:00Z`).getUTCDay();
}

const WEEKDAYS: Record<string, number> = {
  sunday: 0, monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6,
};

export type ResolvedDate =
  | { ok: true; date: string }
  | { ok: false; reason: "past" | "unparsed"; today: string };

/**
 * Turn whatever the agent sends into a real, non-historic ISO date.
 *
 * Accepts ISO dates and the relative phrasings people actually say on the
 * phone. A parsed date earlier than today is reported as `past` rather than
 * silently shifted: a caller saying "the 12th" when the 12th has gone means the
 * next 12th, but a model emitting 2023 means it guessed — and the safe response
 * to a guess is to ask, not to invent a different guess.
 */
export function resolveDate(input: string | undefined, today = londonToday()): ResolvedDate {
  if (!input || !String(input).trim()) return { ok: false, reason: "unparsed", today };
  const raw = String(input).trim().toLowerCase();

  // Relative phrases first — these are what callers actually say.
  if (raw === "today" || raw === "tonight") return { ok: true, date: today };
  if (raw === "tomorrow") return { ok: true, date: addDays(today, 1) };
  if (raw === "day after tomorrow") return { ok: true, date: addDays(today, 2) };

  const inDays = raw.match(/^in (\d{1,2}) days?$/);
  if (inDays) return { ok: true, date: addDays(today, Number(inDays[1])) };

  if (raw === "this weekend" || raw === "the weekend" || raw === "weekend") {
    // Saturday of the current week; if it's already the weekend, today.
    const d = dow(today);
    return { ok: true, date: d === 0 || d === 6 ? today : addDays(today, 6 - d) };
  }

  const wd = raw.replace(/^(next|this|on)\s+/, "");
  if (WEEKDAYS[wd] !== undefined) {
    const target = WEEKDAYS[wd];
    let delta = (target - dow(today) + 7) % 7;
    if (delta === 0) delta = 7; // "monday" spoken on a Monday means the next one
    if (raw.startsWith("next ") && delta < 7) delta += 7;
    return { ok: true, date: addDays(today, delta) };
  }

  // ISO / near-ISO
  const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) {
    const date = `${iso[1]}-${iso[2]}-${iso[3]}`;
    if (Number.isNaN(new Date(`${date}T12:00:00Z`).getTime())) {
      return { ok: false, reason: "unparsed", today };
    }
    if (date < today) return { ok: false, reason: "past", today };
    return { ok: true, date };
  }

  return { ok: false, reason: "unparsed", today };
}

/** Hygglo-style inclusive day count: a one-day hire is 1 day, not 0. */
export function inclusiveDays(start: string, end?: string): number {
  if (!end || end === start) return 1;
  const ms = new Date(`${end}T12:00:00Z`).getTime() - new Date(`${start}T12:00:00Z`).getTime();
  return Math.max(1, Math.round(ms / 86400000) + 1);
}

/** "Friday the 22nd of August" — natural for a voice agent to read back. */
export function speak(iso: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: TZ,
    weekday: "long",
    day: "numeric",
    month: "long",
  }).format(new Date(`${iso}T12:00:00Z`));
}
