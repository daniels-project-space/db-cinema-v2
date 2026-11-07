// Cart availability is a preview. Checkout bypasses this cache and reads the
// current Rental Manager snapshot before price validation and payment.
export const CART_STOCK_SYNC_MAX_AGE_MS = 5 * 60 * 1000;

export function isSharedStockSnapshotFresh(
  checkedAt: number | undefined,
  nowMs: number,
  maxAgeMs: number,
): boolean {
  if (
    checkedAt === undefined ||
    !Number.isSafeInteger(checkedAt) ||
    checkedAt < 1 ||
    !Number.isSafeInteger(nowMs) ||
    !Number.isSafeInteger(maxAgeMs) ||
    maxAgeMs < 1
  ) {
    return false;
  }
  const ageMs = nowMs - checkedAt;
  return ageMs >= -60_000 && ageMs <= maxAgeMs;
}

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

export async function assertFreshSharedStock(ctx: any, nowMs = Date.now()): Promise<void> {
  const state = await ctx.db.query("rmv2_sync_state").withIndex("by_key", (index: any) => index.eq("key", "shared-stock-v1")).first();
  let sourceCheckedAt: number | undefined;
  try { sourceCheckedAt = JSON.parse(state?.cursor ?? "null")?.checkedAt; } catch { sourceCheckedAt = undefined; }
  if (!state || state.status !== "ok" ||
      !isSharedStockSnapshotFresh(sourceCheckedAt, nowMs, CART_STOCK_SYNC_MAX_AGE_MS) ||
      !isSharedStockSyncFresh(state.lastSyncedAt, nowMs, CART_STOCK_SYNC_MAX_AGE_MS)) {
    throw Error("Rental Manager stock needs a fresh check before changing equipment.");
  }
}
