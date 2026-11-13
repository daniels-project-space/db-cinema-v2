/** Stable public reference for a rental-card refund, derived from its Convex row. */
export function rentalRefundReference(id: string) {
  return `DBC-R-${String(id).slice(-8).toUpperCase()}`;
}
