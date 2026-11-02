export type SearchConsoleRow = {
  keys?: string[];
  clicks?: number;
  impressions?: number;
  ctr?: number;
  position?: number;
};

export function buildSearchConsoleDateRange(days: number, now: number) {
  const duration = [7, 30, 90].includes(days) ? days : 30;
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "America/Los_Angeles",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(now));
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
  const pacificToday = `${values.year}-${values.month}-${values.day}`;
  const shift = (date: string, amount: number) => {
    const [year, month, day] = date.split("-").map(Number);
    return new Date(Date.UTC(year, month - 1, day + amount)).toISOString().slice(0, 10);
  };
  const endDate = shift(pacificToday, -3);
  return { startDate: shift(endDate, -(duration - 1)), endDate, days: duration };
}

export function summarizeSearchConsoleRows(rows: SearchConsoleRow[]) {
  let clicks = 0;
  let impressions = 0;
  let weightedPosition = 0;
  for (const row of rows) {
    const rowClicks = Number.isFinite(row.clicks) ? row.clicks! : 0;
    const rowImpressions = Number.isFinite(row.impressions) ? row.impressions! : 0;
    clicks += rowClicks;
    impressions += rowImpressions;
    if (rowImpressions > 0 && Number.isFinite(row.position)) weightedPosition += row.position! * rowImpressions;
  }
  return {
    clicks: Math.round(clicks),
    impressions: Math.round(impressions),
    ctr: impressions > 0 ? clicks / impressions : 0,
    position: impressions > 0 ? weightedPosition / impressions : 0,
  };
}
