export async function assertSwapStockReconciled(ctx: any, bookingId: any) {
  for (const deliveryState of [undefined, "pending"] as const) {
    const receipt = await ctx.db.query("swap_stock_applied_receipts").withIndex("by_booking_delivery", (index: any) => index.eq("bookingId", bookingId).eq("deliveryState", deliveryState)).first();
    if (receipt) throw Error("A previous equipment change needs stock reconciliation before this rental can be changed.");
  }
  const risk = await ctx.db.query("swap_stock_applied_receipts").withIndex("by_booking_stock_risk", (index: any) => index.eq("bookingId", bookingId).eq("stockRisk", true)).first();
  if (risk) throw Error("A previous equipment change needs stock reconciliation before this rental can be changed.");
}
