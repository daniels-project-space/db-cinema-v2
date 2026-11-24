import { bookingStockLines } from "./rentalWindow";

/** Stable fingerprint for the booking's logical lines and exact physical stock ledger. */
export function stockAllocationFingerprint(booking: any, rows: any[]) {
  const lines = bookingStockLines<any>(booking)
    .map((line) => [
      String(line.listingId),
      line.start,
      line.end,
      line.pickupTime ?? null,
      line.returnTime ?? null,
      line.qty,
    ])
    .map((line) => JSON.stringify(line))
    .sort();
  const physical = rows
    .map((row) =>
      JSON.stringify([
        String(row.inventoryUnitId),
        String(row.listingId),
        row.start,
        row.end,
        row.qty,
        row.endExclusive === true,
        row.turnaroundBufferMinutes ?? 0,
      ]),
    )
    .sort();
  return JSON.stringify({ lines, physical });
}
