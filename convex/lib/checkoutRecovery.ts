export function basketKey(lines: any[]) {
  const counts = new Map<string, number>();
  for (const l of lines) {
    const key = `${l.listingId}|${l.start}|${l.end}`;
    counts.set(key, (counts.get(key) ?? 0) + l.qty);
  }
  return JSON.stringify([...counts].sort(([a], [b]) => a.localeCompare(b)));
}
/** Stripe-attested unpaid expiry is recoverable; explicit cancellation is not. */
export function recoveryBookingState(
  booking: any,
): "waiting" | "recoverable" | "stopped" {
  if (!booking) return "recoverable";
  if (booking.cancellationDecision) return "stopped";
  if (booking.status === "pending_payment") return "waiting";
  if (
    booking.status === "cancelled" &&
    booking.checkoutExpiredAt &&
    !booking.stripePaymentIntentId
  )
    return "recoverable";
  return "stopped";
}
export async function linkMatchingRecovery(
  ctx: any,
  email: string,
  lines: any[],
  bookingId: any,
) {
  return matchingRecovery(ctx, email, lines, bookingId, false);
}
export async function stopMatchingRecovery(
  ctx: any,
  email: string,
  lines: any[],
  bookingId: any,
) {
  return matchingRecovery(ctx, email, lines, bookingId, true);
}
async function matchingRecovery(
  ctx: any,
  email: string,
  lines: any[],
  bookingId: any,
  stop: boolean,
) {
  const a = await ctx.db
    .query("accounts")
    .withIndex("by_email", (q: any) =>
      q.eq("email", email.trim().toLowerCase()),
    )
    .first();
  if (!a) return;
  const rows = await ctx.db
    .query("checkout_recoveries")
    .withIndex("by_account", (q: any) => q.eq("accountId", a._id))
    .collect();
  for (const r of rows)
    if (r.state !== "stopped" && basketKey(r.lines) === basketKey(lines))
      await ctx.db.patch(r._id, {
        ...(stop ? { state: "stopped" } : {}),
        bookingId,
        leaseUntil: undefined,
      });
}
