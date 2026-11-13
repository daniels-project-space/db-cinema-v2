const settlementStatuses = ["awaiting_acceptance", "accepted", "awaiting_payment", "refund_pending", "refund_compensating", "review"] as const;

export async function assertSwapStockReconciled(ctx: any, bookingId: any, ownSwapId?: any, allowUnacceptedProposal = false) {
  for (const status of settlementStatuses) {
    // An unaccepted proposal has not changed inventory or money. Handover and
    // cancellation may proceed while it is open; the caller still validates
    // the booking's active swap pointer. Every accepted/settling state remains
    // fenced until stock reconciliation completes.
    if (allowUnacceptedProposal && status === "awaiting_acceptance") continue;
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

export async function assertActiveItemSwapReady(ctx: any, booking: any, allowUnacceptedProposal = false) {
  if (!booking?.activeItemSwapId) return;
  const swap = await ctx.db.get(booking.activeItemSwapId);
  if (!swap || String(swap.bookingId) !== String(booking._id)) {
    throw Error("The active equipment change is missing its booking link; reconcile it before continuing.");
  }
  if (swap.status === "awaiting_acceptance" && !swap.acceptedAt && allowUnacceptedProposal) return;
  if (swap.status === "applied") {
    const receipt = await ctx.db.query("swap_stock_applied_receipts")
      .withIndex("by_swap", (index: any) => index.eq("swapId", swap._id))
      .unique();
    if (receipt?.deliveryState === "acknowledged" && receipt.stockRisk !== true) return;
  }
  throw Error("The active equipment change still needs stock reconciliation before continuing.");
}

export async function expireUnacceptedItemSwap(ctx: any, booking: any) {
  if (!booking?.activeItemSwapId) return null;
  const swap = await ctx.db.get(booking.activeItemSwapId);
  if (!swap || String(swap.bookingId) !== String(booking._id)) {
    throw Error("The active equipment change is missing its booking link; reconcile it before continuing.");
  }
  if (swap.status !== "awaiting_acceptance" || swap.acceptedAt) return null;
  const now = Date.now();
  await ctx.db.patch(swap._id, { status: "expired", updatedAt: now, reconcileAfter: undefined });
  await ctx.db.patch(booking._id, { activeItemSwapId: undefined });
  return swap;
}
