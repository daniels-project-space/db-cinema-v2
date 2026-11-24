export async function findReviewInvitationMessage(ctx: any, booking: any) {
  if (!booking) return null;
  if (booking.reviewInvitationMessageId) {
    const marked = await ctx.db.get(booking.reviewInvitationMessageId);
    if (marked?.bookingId === booking._id && marked.meta?.kind === "review_invitation") return marked;
  }
  const messages = await ctx.db.query("messages")
    .withIndex("by_booking_at", (q: any) => q.eq("bookingId", booking._id))
    .order("asc")
    .collect();
  return messages.find((message: any) => message.meta?.kind === "review_invitation") ?? null;
}

export async function reconcileReviewInvitationMessage(ctx: any, booking: any) {
  const message = await findReviewInvitationMessage(ctx, booking);
  if (!message) return null;
  if (booking.reviewInvitationMessageId !== message._id || booking.reviewFollowUpStatus !== "sent" || !booking.remindedReview) {
    await ctx.db.patch(booking._id, {
      reviewInvitationMessageId: message._id,
      reviewFollowUpStatus: "sent",
      reviewFollowUpReason: undefined,
      reviewFollowUpSentAt: Number.isFinite(message.at) ? message.at : Date.now(),
      remindedReview: true,
    });
  }
  return message;
}
