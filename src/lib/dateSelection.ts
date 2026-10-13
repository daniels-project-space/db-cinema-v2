/** First click is a complete one-day hire; the next extends it in either direction. */
export function pickRentalDates(start: string | null, end: string | null, picked: string) {
  if (!start || (end && start !== end)) return { start: picked, end: picked };
  return { start: picked < start ? picked : start, end: picked < start ? start : picked };
}

export function crossesUnavailableDate(start: string | null, end: string | null, picked: string, unavailable: Set<string>) {
  if (!start || (end && start !== end)) return false;
  const first = picked < start ? picked : start;
  const last = picked < start ? start : picked;
  return [...unavailable].some(day => day >= first && day <= last);
}
