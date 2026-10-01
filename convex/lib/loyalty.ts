import { qualifyingRentalCount } from "../../shared/loyalty";

export async function loyaltyProgress(ctx: any, account: any) {
  if (account.loyaltyUnlockedAt) return { eligible: true, completed: 3 };
  const bookings = await ctx.db.query("bookings").withIndex("by_guestEmail", (q: any) =>
    q.eq("guestEmail", account.email.trim().toLowerCase())).collect();
  const completed = qualifyingRentalCount(bookings);
  return { eligible: completed >= 3, completed };
}

export async function unlockLoyalty(ctx: any, email: string) {
  const account = await ctx.db.query("accounts").withIndex("by_email", (q: any) =>
    q.eq("email", email.trim().toLowerCase())).first();
  if (account && !account.loyaltyUnlockedAt && (await loyaltyProgress(ctx, account)).eligible)
    await ctx.db.patch(account._id, { loyaltyUnlockedAt: Date.now() });
}
