import { peak, blockedSet } from "../availability";
import { rentalUnavailable } from "./marketingInventory";
import { reservationOccupancy } from "./reservationOccupancy";
import { inventoryCapacity } from "./inventoryCapacity";
/** Query-local cache only: all checks still use the same live database snapshot. */
export type RentalInventoryCache = { records: Map<string, any>; reservations: Map<string, any[]> };
/** Check the whole proposed order together, including overlapping bundles and quantities. */
export async function assertRentalInventory(
  ctx: any,
  lines: any[],
  excludeBookingId?: any,
  cache?: RentalInventoryCache,
) {
  async function get(id: any) {
    const key = String(id);
    if (cache?.records.has(key)) return cache.records.get(key);
    const record = await ctx.db.get(id);
    cache?.records.set(key, record);
    return record;
  }
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
    const listing = await get(line.listingId);
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
    const unit = await get(row.id);
    const owned = inventoryCapacity(unit);
    if (owned === null) throw Error("Inventory capacity is missing, inactive or invalid");
    let reservations = cache?.reservations.get(String(row.id));
    if (!reservations) {
      reservations = await ctx.db
      .query("reservations")
      .withIndex("by_unit", (q: any) => q.eq("inventoryUnitId", row.id))
      .collect();
      cache?.reservations.set(String(row.id), reservations!);
    }
    const occupied = await Promise.all(reservations!.filter((r: any) => !excludeBookingId || r.bookingId !== excludeBookingId)
      .map((r: any) => reservationOccupancy(ctx, r)));
    const existing = occupied.filter((row): row is NonNullable<typeof row> => row !== null);
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
      return peak(overlapping) > owned;
    });
    if (over)
      throw Error(
        `${unit.name ?? "An item"} is already reserved for those dates`,
      );
  }
}
