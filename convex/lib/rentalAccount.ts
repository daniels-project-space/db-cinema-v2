import type { Doc } from "../_generated/dataModel";
/** Permanent rental ownership, with email compatibility for older bookings. */
export function belongsToRentalAccount(booking: any, account: any): boolean {
  return !!booking && !!account && (booking.accountId
    ? booking.accountId === account._id
    : (booking.guestEmail ?? "").trim().toLowerCase() === account.email.trim().toLowerCase());
}

export async function accountForRental(ctx: any, booking: any): Promise<Doc<"accounts"> | null> {
  if (!booking) return null;
  return booking.accountId ? ctx.db.get(booking.accountId) : ctx.db.query("accounts")
    .withIndex("by_email", (q: any) => q.eq("email", (booking.guestEmail ?? "").trim().toLowerCase())).first();
}

export async function rentalsForAccount(ctx: any, account: any, limit: number) {
  const [linked, legacy] = await Promise.all([
    ctx.db.query("bookings").withIndex("by_account", (q: any) => q.eq("accountId", account._id)).order("desc").take(limit),
    ctx.db.query("bookings").withIndex("by_guestEmail", (q: any) => q.eq("guestEmail", account.email))
      .filter((q: any) => q.eq(q.field("accountId"), undefined)).order("desc").take(limit),
  ]);
  return [...linked, ...legacy].sort((a: any,b: any) => b._creationTime-a._creationTime).slice(0,limit);
}
