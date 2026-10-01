/** Three returned rentals: distinct checkouts AND distinct rental date windows. */
export function qualifyingRentalCount(bookings: any[]): number {
  const windows = new Map<string, Set<string>>();
  for (const b of bookings) {
    if (b.status !== "returned" || b.cancellationDecision || !b.lineItems?.length) continue;
    const checkout = b.stripeCheckoutSessionId || b.stripePaymentIntentId;
    if (!checkout && b.rentalPaidPence === undefined) continue;
    const start = Math.min(...b.lineItems.map((i: any) => i.start));
    const end = Math.max(...b.lineItems.map((i: any) => i.end));
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || end < start) continue;
    const key = checkout || b._id;
    const dates = `${Math.floor(start / 86400000)}:${Math.floor(end / 86400000)}`;
    if (!windows.has(key)) windows.set(key, new Set());
    windows.get(key)!.add(dates);
  }
  // Matching avoids depending on the order of historical duplicate rows.
  const matched = new Map<string, string>();
  function place(checkout: string, seen: Set<string>): boolean {
    for (const date of windows.get(checkout)!) {
      if (seen.has(date)) continue;
      seen.add(date);
      const previous = matched.get(date);
      if (!previous || place(previous, seen)) { matched.set(date, checkout); return true; }
    }
    return false;
  }
  let count = 0;
  for (const checkout of windows.keys()) if (place(checkout, new Set()) && ++count === 3) return 3;
  return count;
}
