/** Shared date helpers — UTC day math on YYYY-MM-DD strings. */

const pad = (n: number) => String(n).padStart(2, "0");

export const iso = (y: number, m: number, d: number) => `${y}-${pad(m + 1)}-${pad(d)}`;

/** Parse a YYYY-MM-DD (or full ISO datetime) to ms; 0 if invalid. */
export const dayMs = (d: string) => {
  const t = Date.parse(/T/.test(d) ? d : d + "T00:00:00Z");
  return Number.isNaN(t) ? 0 : t;
};

export function addDaysIso(start: string, n: number): string {
  const [y, m, d] = start.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + n));
  return iso(dt.getUTCFullYear(), dt.getUTCMonth(), dt.getUTCDate());
}

export function daysInclusive(start: string, end: string): number {
  return Math.max(1, Math.round((dayMs(end) - dayMs(start)) / 86400000) + 1);
}
