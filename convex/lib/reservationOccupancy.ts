import { rentalWindow, bookingStockLines } from "../../shared/rentalWindow";
import { legacyStockWindow } from "./stockWindows";
import { reservationPaymentUnresolved } from "./reservationPayment";
/** Availability follows booked dates; custody/settlement remain separate state. */
export async function reservationOccupancy(ctx: any, row: any, now = Date.now()) {
  if (!["confirmed", "active", "hold"].includes(row.status)) return null;
  if (row.status === "hold" && (row.holdExpiresAt ?? Infinity) <= now) {
    if (!await reservationPaymentUnresolved(ctx, row)) return null;
  }
  // A missed return-status update must not extend the rental's forecast
  // indefinitely. This neither marks the rental returned nor settles money.
  if (row.endExclusive && (row.source !== "hygglo" || row.stockWindowVersion === 2)) return {start:row.start,end:row.end,qty:row.qty||1,endExclusive:true};
  if (row.source === "hygglo") return legacyStockWindow({...row,qty:row.qty||1});
  const booking=row.bookingId?await ctx.db.get(row.bookingId):null;
  const line=booking?.lineItems?bookingStockLines(booking).find((li:any)=>li.listingId===row.listingId&&li.start===row.start&&li.end===row.end):null;
  return {...rentalWindow({start:row.start,end:row.end,pickupTime:line?.pickupTime,returnTime:line?.returnTime}),qty:row.qty||1};
}
