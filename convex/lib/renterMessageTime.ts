/** One account-scoped indexed point read; owner, system and bot messages cannot advance this clock. */
export async function renterMessageTime(ctx: any, booking: any, account: any) {
  if (!account) return booking._creationTime;
  const message = await ctx.db.query("messages")
    .withIndex("by_booking_account_sender_at", (q: any) =>
      q.eq("bookingId", booking._id).eq("accountId", account._id).eq("sender", "renter"))
    .order("desc").first();
  return message?.at ?? booking._creationTime;
}
