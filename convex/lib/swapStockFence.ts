const settlementStatuses = ["awaiting_acceptance", "accepted", "awaiting_payment", "refund_pending", "refund_compensating", "review"] as const;

export async function assertSwapStockReconciled(ctx: any, bookingId: any, ownSwapId?: any) {
  for (const status of settlementStatuses) {
    const swaps = await ctx.db.query("rental_item_swaps").withIndex("by_booking_status", (index: any) => index.eq("bookingId", bookingId).eq("status", status)).take(2);
    if (swaps.some((swap: any) => String(swap._id) !== String(ownSwapId)))
      throw Error("An equipment change is still settling; reconcile it before changing this rental.");
  }
  for (const status of ["refunded", "withdrawn", "expired"] as const) {
    const swaps = await ctx.db.query("rental_item_swaps").withIndex("by_booking_status", (index: any) => index.eq("bookingId", bookingId).eq("status", status)).take(101);
    if (swaps.length > 100) throw Error("Equipment change history needs stock reconciliation before this rental can be changed.");
    for (const swap of swaps) {
      const acquire = await ctx.db.query("swap_stock_operations").withIndex("by_swap_operation", (index: any) => index.eq("swapId", swap._id).eq("operation", "acquire")).unique();
      if (status !== "refunded" && !acquire) continue;
      const operation = status === "refunded" ? "releaseCompensated" : "releasePrepared";
      const release = await ctx.db.query("swap_stock_operations").withIndex("by_swap_operation", (index: any) => index.eq("swapId", swap._id).eq("operation", operation)).unique();
      const expected = status === "refunded" ? "compensated_released" : "released";
      if (!acquire || acquire.state !== "confirmed" || typeof acquire.receipt?.requestId !== "string" || !acquire.receipt.requestId || typeof acquire.receipt?.fingerprint !== "string" || !acquire.receipt.fingerprint || !release || release.state !== "confirmed" || release.request?.args?.id !== acquire.receipt.requestId || release.request?.args?.fingerprint !== acquire.receipt.fingerprint || release.receipt?.state !== expected || typeof release.receipt?.replayed !== "boolean")
        throw Error("A previous equipment change needs stock reconciliation before this rental can be changed.");
    }
  }
  for (const deliveryState of [undefined, "pending"] as const) {
    const receipt = await ctx.db.query("swap_stock_applied_receipts").withIndex("by_booking_delivery", (index: any) => index.eq("bookingId", bookingId).eq("deliveryState", deliveryState)).first();
    if (receipt) throw Error("A previous equipment change needs stock reconciliation before this rental can be changed.");
  }
  const risk = await ctx.db.query("swap_stock_applied_receipts").withIndex("by_booking_stock_risk", (index: any) => index.eq("bookingId", bookingId).eq("stockRisk", true)).first();
  if (risk) throw Error("A previous equipment change needs stock reconciliation before this rental can be changed.");
}
