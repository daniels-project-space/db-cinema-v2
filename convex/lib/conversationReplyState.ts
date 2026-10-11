/** Read receipts never clear an unanswered message. Each sender uses a scoped index. */
export async function conversationReplyState(ctx: any, accountId: any, bookingId: any, escalated: boolean) {
  const latest = await Promise.all(["renter", "owner", "bot"].map(sender => ctx.db.query("messages")
    .withIndex("by_booking_account_sender_at", (q: any) => q.eq("bookingId", bookingId).eq("accountId", accountId).eq("sender", sender))
    .order("desc").first()));
  const renterAt = latest[0]?.at ?? null, ownerAt = latest[1]?.at ?? null, botAt = latest[2]?.at ?? null;
  return { renterAt, awaitingReply: renterAt !== null && renterAt > Math.max(ownerAt ?? 0, botAt ?? 0),
    awaitingTeam: escalated && renterAt !== null && renterAt > (ownerAt ?? 0) };
}
