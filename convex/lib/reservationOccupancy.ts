import { reservationPaymentUnresolved } from "./reservationPayment";
/** Preserve physical custody and unresolved payments beyond their planned dates. */
export async function reservationOccupancy(ctx: any, row: any, now = Date.now()) {
  if (!["confirmed", "active", "hold"].includes(row.status)) return null;
  if (row.status === "hold" && (row.holdExpiresAt ?? Infinity) <= now) {
    if (!await reservationPaymentUnresolved(ctx, row)) return null;
  }
  const today = Math.floor(now / 86400000) * 86400000;
  // Keep the saved return date intact. An overdue rental physically still out
  // has no reliable next availability date until its return is recorded.
  const end = row.status === "active" && row.end < today ? Infinity : row.end;
  return { start: row.start, end, qty: row.qty || 1, ...(row.endExclusive ? {endExclusive:true} : {}) };
}
