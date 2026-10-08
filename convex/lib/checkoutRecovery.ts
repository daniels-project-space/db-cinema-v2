import {accountForRental,belongsToRentalAccount} from "./rentalAccount";
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
  _email: string,
  lines: any[],
  bookingId: any,
) {
  return matchingRecovery(ctx, _email, lines, bookingId, false);
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
  _email: string,
  lines: any[],
  bookingId: any,
  stop: boolean,
) {
  const booking=await ctx.db.get(bookingId);
  const a = booking ? await accountForRental(ctx,booking) : null;
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
/** Permanent account links win over recycled or subsequently changed email addresses. */
export async function recoveryBookingsForAccount(ctx:any,account:any) {
  const [linked,legacy]=await Promise.all([
    ctx.db.query("bookings").withIndex("by_account",(q:any)=>q.eq("accountId",account._id)).collect(),
    ctx.db.query("bookings").withIndex("by_guestEmail",(q:any)=>q.eq("guestEmail",account.email.trim().toLowerCase())).collect(),
  ]);
  return [...new Map([...linked,...legacy].filter(b=>belongsToRentalAccount(b,account)).map(b=>[b._id,b])).values()] as any[];
}
