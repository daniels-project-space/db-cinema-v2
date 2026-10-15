export const CART_STOCK_SYNC_MAX_AGE_MS = 90 * 1000;

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
