import { peak, blockedSet } from "../availability";
import { rentalUnavailable } from "./marketingInventory";
/** Check the whole proposed order together, including overlapping bundles and quantities. */
export async function assertRentalInventory(
  ctx: any,
  lines: any[],
  excludeBookingId?: any,
) {
  const byUnit = new Map<string, { id: any; intervals: any[] }>();
  for (const line of lines) {
    if (
      !Number.isSafeInteger(line.qty) ||
      line.qty < 1 ||
      !Number.isSafeInteger(line.start) ||
      !Number.isSafeInteger(line.end) ||
      line.end < line.start
    )
      throw Error("Invalid rental dates or quantity");
    const listing = await ctx.db.get(line.listingId);
    if (!listing || rentalUnavailable(listing))
      throw Error("An item is no longer available");
    // Explicit day blocks from the live catalogue are independent of reservations.
    const blocked = blockedSet(listing.unavailableDates ?? []);
    for (let day = line.start; day <= line.end; day += 86400000)
      if (blocked.has(new Date(day).toISOString().slice(0, 10)))
        throw Error(`${listing.title} is unavailable on those dates`);
    if (!Array.isArray(listing.components) || !listing.components.length)
      throw Error("Inventory capacity mapping is missing");
    for (const comp of listing.components) {
      if (!Number.isSafeInteger(comp.qty) || comp.qty < 1)
        throw Error("Inventory capacity mapping is invalid");
      const key = String(comp.inventoryUnitId);
      const row = byUnit.get(key) ?? {
        id: comp.inventoryUnitId,
        intervals: [],
      };
      row.intervals.push({
        start: line.start,
        end: line.end,
        qty: comp.qty * line.qty,
      });
      byUnit.set(key, row);
    }
  }
  for (const row of byUnit.values()) {
    const unit = await ctx.db.get(row.id);
    if (
      !unit ||
      !Number.isSafeInteger(unit.quantityOwned) ||
      unit.quantityOwned < 0
    )
      throw Error("Inventory capacity is missing or invalid");
    const reservations = await ctx.db
      .query("reservations")
      .withIndex("by_unit", (q: any) => q.eq("inventoryUnitId", row.id))
      .collect();
    const existing = reservations
      .filter(
        (r: any) =>
          (!excludeBookingId || r.bookingId !== excludeBookingId) &&
          (["confirmed", "active"].includes(r.status) ||
            (r.status === "hold" &&
              (r.holdExpiresAt ?? Infinity) > Date.now())),
      )
      .map((r: any) => ({ start: r.start, end: r.end, qty: r.qty }));
    const over = row.intervals.some((window) => {
      const overlapping = [...existing, ...row.intervals]
        .filter(
          (interval) =>
            interval.start <= window.end && interval.end >= window.start,
        )
        .map((interval) => ({
          ...interval,
          start: Math.max(interval.start, window.start),
          end: Math.min(interval.end, window.end),
        }));
      return peak(overlapping) > unit.quantityOwned;
    });
    if (over)
      throw Error(
        `${unit.name ?? "An item"} is already reserved for those dates`,
      );
  }
}
