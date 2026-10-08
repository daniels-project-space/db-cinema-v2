import {stockWindow} from "./stockWindows";
import {bookingStockLines,rentalWindow} from "../../shared/rentalWindow";
/** Verify the current catalogue still describes the physical units reserved for this hire.
 * Aggregate equal periods/components; do not guess a replacement for missing legacy evidence. */
export async function assertRentalAllocation(ctx: any, booking: any, reservations: any[]) {
  const expected = new Map<string, number>(), exact = new Map<string,number>(), days = new Map<string,number>(), actual = new Map<string, number>();
  const add = (map: Map<string, number>, listing: any, unit: any, start: number, end: number, qty: number) => {
    if (!listing || !unit || !Number.isSafeInteger(start) || !Number.isSafeInteger(end) || end < start || !Number.isSafeInteger(qty) || qty < 1) throw Error("The kit inventory mapping needs a team check.");
    const key = JSON.stringify([listing, unit, start, end]), total = (map.get(key) ?? 0) + qty;
    if (!Number.isSafeInteger(total)) throw Error("The kit inventory mapping needs a team check.");
    map.set(key, total);
  };
  if (!booking.lineItems?.length) throw Error("The kit inventory mapping needs a team check.");
  for (const line of bookingStockLines<any>(booking)) {
    const listing = await ctx.db.get(line.listingId);
    if (!listing?.components?.length || !Number.isSafeInteger(line.qty) || line.qty < 1) throw Error("The kit inventory mapping needs a team check.");
    for (const component of listing.components) {
      if (!Number.isSafeInteger(component.qty) || component.qty < 1) throw Error("The kit inventory mapping needs a team check.");
      add(expected, line.listingId, component.inventoryUnitId, line.start, line.end, component.qty * line.qty);
      const precise=stockWindow(line,true),full=stockWindow(line,false);
      add(exact,line.listingId,component.inventoryUnitId,precise.start,precise.end,component.qty*line.qty);
      add(days,line.listingId,component.inventoryUnitId,full.start,full.end,component.qty*line.qty);
    }
  }
  for (const reservation of reservations) if (!reservation.extensionRequestId && ["confirmed", "active"].includes(reservation.status)) {
    if (reservation.source !== "site") throw Error("Manage this rental through its original booking platform.");
    add(actual, reservation.listingId, reservation.inventoryUnitId, reservation.start, reservation.end+(reservation.endExclusive&&reservation.turnaroundBufferMinutes!==60?3600000:0), reservation.qty);
  }
  const fingerprint = (map: Map<string, number>) => JSON.stringify([...map.entries()].sort(([a], [b]) => a.localeCompare(b)));
  const preciseLedger=reservations.some(r=>!r.extensionRequestId&&["confirmed","active"].includes(r.status)&&r.endExclusive);
  const wanted=preciseLedger?[exact,days]:[expected];
  if (!wanted.some(map=>fingerprint(map)===fingerprint(actual))) throw Error("The kit inventory mapping changed. The team must reconcile the current rental before changing it.");
  return preciseLedger?(fingerprint(exact)===fingerprint(actual)?"precise":"day"):"legacy";
}
