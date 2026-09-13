/** Requested rental discount. The threshold includes offer lines; the saving does not. */
export const GAFFER_PRICE_CODE = "gaffer10";

export function gafferDiscount(subtotal: number, eligibleSubtotal: number): number {
  if (!Number.isFinite(subtotal) || !Number.isFinite(eligibleSubtotal)) return 0;
  const subtotalPence = Math.round(subtotal * 100);
  const eligiblePence = Math.round(eligibleSubtotal * 100);
  if (subtotalPence <= 40_000) return 0;
  return Math.round(Math.max(0, Math.min(subtotalPence, eligiblePence)) * 0.1) / 100;
}
