import { dateLabel, londonRentalInstant, STOCK_DAY } from "./rentalWindow";

/** Bill at least one day, then one more for each started 24-hour period. */
export function rentalPricingDays(start: number, end: number, pickupTime?: string | null, returnTime?: string | null): number {
  const first = dateLabel(start);
  const last = dateLabel(end);
  if (last < first) throw new Error("Return must be after pickup");
  if (pickupTime && returnTime) {
    const duration = londonRentalInstant(last, returnTime) - londonRentalInstant(first, pickupTime);
    if (duration <= 0) throw new Error("Return must be after pickup");
    return Math.max(1, Math.ceil(duration / STOCK_DAY));
  }
  // Date-only previews and legacy baskets keep their prior inclusive-day price.
  return Math.max(1, Math.round((last - first) / STOCK_DAY) + 1);
}
