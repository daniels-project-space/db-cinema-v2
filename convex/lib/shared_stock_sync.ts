// Cart availability is a preview. Checkout bypasses this cache and reads the
// current Rental Manager snapshot before price validation and payment.
export const CART_STOCK_SYNC_MAX_AGE_MS = 5 * 60 * 1000;

export function isSharedStockSyncFresh(
  lastSyncedAt: number | undefined,
  nowMs: number,
  maxAgeMs: number,
): boolean {
  if (
    lastSyncedAt === undefined ||
    !Number.isSafeInteger(lastSyncedAt) ||
    !Number.isSafeInteger(nowMs) ||
    !Number.isSafeInteger(maxAgeMs) ||
    maxAgeMs < 1
  ) {
    return false;
  }
  const ageMs = nowMs - lastSyncedAt;
  return ageMs >= 0 && ageMs < maxAgeMs;
}
