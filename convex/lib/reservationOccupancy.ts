import { reservationPaymentUnresolved } from "./reservationPayment";
/** Availability follows booked dates; custody/settlement remain separate state. */
export async function reservationOccupancy(ctx: any, row: any, now = Date.now()) {
  if (!["confirmed", "active", "hold"].includes(row.status)) return null;
  if (row.status === "hold" && (row.holdExpiresAt ?? Infinity) <= now) {
    if (!await reservationPaymentUnresolved(ctx, row)) return null;
  }
  // A missed return-status update must not extend the rental's forecast
  // indefinitely. This neither marks the rental returned nor settles money.
  return { start: row.start, end: row.end, qty: row.qty || 1, ...(row.endExclusive ? {endExclusive:true} : {}) };
}
