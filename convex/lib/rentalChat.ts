import { queueOwnerNotification } from "./adminPush";
/** Shared boundaries for customer and owner rental conversations. */
export async function accountForToken(ctx: any, token: string) {
  const s = await ctx.db
    .query("sessions")
    .withIndex("by_token", (q: any) => q.eq("token", token))
    .first();
  if (!s || (s.expiresAt != null && s.expiresAt <= Date.now())) return null;
  const account=await ctx.db.get(s.accountId);return account?.emailVerificationRequired&&!account.emailVerifiedAt?null:account;
}
export async function ownedBooking(ctx: any, account: any, bookingId: any) {
  const b = await ctx.db.get(bookingId);
  if (
    !account ||
    !b ||
    (b.guestEmail ?? "").trim().toLowerCase() !==
      account.email.trim().toLowerCase()
  )
    throw new Error("This rental is not available to your account.");
  return b;
}
export async function rentalThread(ctx: any, accountId: any, bookingId?: any) {
  return ctx.db
    .query("chat_threads")
    .withIndex("by_account_booking", (q: any) =>
      q.eq("accountId", accountId).eq("bookingId", bookingId),
    )
    .first();
}
export async function postRentalMessage(
  ctx: any,
  a: {
    accountId: any;
    bookingId?: any;
    sender: "renter" | "bot" | "system" | "owner";
    text: string;
    meta?: any;
  },
) {
  if (a.bookingId)
    await ownedBooking(ctx, await ctx.db.get(a.accountId), a.bookingId);
  const thread = await rentalThread(ctx, a.accountId, a.bookingId);
  const now = Math.max(Date.now(), (thread?.updatedAt ?? 0) + 1);
  const id = await ctx.db.insert("messages", {
    ...a,
    at: now,
    readByOwner: a.sender !== "renter",
    threadCounted: true,
  });
  const patch = {
    updatedAt: now,
    lastMessage: a.text.slice(0, 160),
    lastSender: a.sender,
    unreadOwner: (thread?.unreadOwner ?? 0) + (a.sender === "renter" ? 1 : 0),
    unreadRenter: (thread?.unreadRenter ?? 0) + (a.sender !== "renter" ? 1 : 0),
  };
  if (thread) await ctx.db.patch(thread._id, patch);
  else
    await ctx.db.insert("chat_threads", {
      accountId: a.accountId,
      bookingId: a.bookingId,
      escalated: false,
      ...patch,
    });
  if (a.bookingId)
    await ctx.db.patch(a.bookingId, {
      chatUpdatedAt: now,
      chatUnreadOwner: patch.unreadOwner,
      chatUnreadRenter: patch.unreadRenter,
    });
  if (a.sender === "renter" && thread?.escalated) await queueOwnerNotification(ctx, {
    eventKey: `renter-message:${id}`, kind: "renter_message", accountId: a.accountId, bookingId: a.bookingId,
    title: "New rental message", body: "A renter has replied in a conversation handled by your team.",
  });
  return id;
}
