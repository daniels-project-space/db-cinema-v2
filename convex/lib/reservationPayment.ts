/** A timer cannot attest that a checkout, amendment payment or refund closed.
 * Unknown amendment bindings remain occupied for reconciliation. */
export async function reservationPaymentUnresolved(ctx: any, row: any) {
  const booking = row.bookingId ? await ctx.db.get(row.bookingId) : null;
  if (booking?.status === "pending_payment") return true;
  if (row.extensionRequestId) {
    const request = await ctx.db.get(row.extensionRequestId);
    if (!request || request.type !== "extend" || request.bookingId !== row.bookingId) return true;
    return !["applied", "refunded", "expired", "withdrawn", "declined"].includes(request.status);
  }
  if (typeof row.externalRef === "string" && row.externalRef.startsWith("addition:")) {
    let addition;
    try { addition = await ctx.db.get(row.externalRef.slice("addition:".length)); }
    catch { return true; } // Malformed/unknown bindings never attest payment closure.
    if (!addition || addition.bookingId !== row.bookingId) return true;
    return !["applied", "applied_draft", "refunded", "expired"].includes(addition.status);
  }
  return false;
}
