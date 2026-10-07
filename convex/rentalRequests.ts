import { query, mutation } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import { accountForToken, ownedBooking, rentalThread, postRentalMessage } from "./lib/rentalChat";
import { bookingCancelKind, cancellationDaysForBooking } from "../src/lib/cancellationPolicy";

export const context = query({
  args: { token: v.string(), bookingId: v.id("bookings"), refreshKey: v.optional(v.number()) },
  handler: async (ctx, { token, bookingId }) => {
    const a = await accountForToken(ctx, token);
    if (!a) return null;
    const b = await ownedBooking(ctx, a, bookingId);
    const reservations = await ctx.db.query("reservations").withIndex("by_booking", q => q.eq("bookingId", bookingId)).collect();
    return { status: b.status, start: Math.min(...b.lineItems.map((l: { start: number }) => l.start)), end: Math.max(...b.lineItems.map((l: { end: number }) => l.end)),
      cancellationKind: bookingCancelKind(b, Date.now()), cancellationFullRefundDays: cancellationDaysForBooking(b),
      cancellationTermsVersion: b.agreementDocs?.find((d: { kind: string; version: string }) => d.kind === "cancellation")?.version ?? "2026-10-v10",
      direct: reservations.every(r => r.source === "site"),
      selfService: process.env.CUSTOMER_BOOKING_ACTIONS === "true",
      locked: !!(b.cancellationDecision || (b.activeAdditionId || b.activeExtensionId) || b.returnDecision) };
  },
});

/** Requests reach a human; they never mutate dates, prices or payments. */
export const submit = mutation({
  args: { token: v.string(), bookingId: v.id("bookings"), requestId: v.string(),
    kind: v.union(v.literal("dates"), v.literal("items"), v.literal("extension"), v.literal("cancel")), detail: v.string() },
  handler: async (ctx, { token, bookingId, requestId, kind, detail }) => {
    const a = await accountForToken(ctx, token);
    if (!a) throw Error("Please sign in.");
    const b = await ownedBooking(ctx, a, bookingId);
    if (!/^[a-zA-Z0-9-]{16,80}$/.test(requestId)) throw Error("Invalid request.");
    const previous = await ctx.db.query("rental_change_requests").withIndex("by_request", q => q.eq("requestId", requestId)).first();
    if (previous) {
      if (previous.accountId !== a._id || previous.bookingId !== bookingId || previous.kind !== kind || previous.detail !== detail.trim()) throw Error("Request belongs to a different change.");
      return { ok: true, messageId: previous.messageId };
    }
    if (!["pending_payment", "confirmed", "active"].includes(b.status)) throw Error("This rental has finished. Please message the team instead.");
    if (kind === "cancel" && b.status === "active") throw Error("This rental has started. Ask the team about an early return instead.");
    if (b.cancellationDecision || b.returnDecision) throw Error("A cancellation or return is already being processed.");
    const text = detail.trim();
    if (text.length < 5 || text.length > 1000) throw Error("Describe your request in 5–1000 characters.");
    const recent = await ctx.db.query("rental_change_requests").withIndex("by_account", q => q.eq("accountId", a._id)).order("desc").take(10);
    if (recent.filter(r => r.createdAt > Date.now() - 60000).length >= 3) throw Error("Please wait a minute before sending another request.");
    const thread = await rentalThread(ctx, a._id, bookingId);
    if (thread) await ctx.db.patch(thread._id, { escalated: true });
    else await ctx.db.insert("chat_threads", { accountId: a._id, bookingId, escalated: true, updatedAt: Date.now(), unreadOwner: 0, unreadRenter: 0 });
    const label = { dates: "Change dates", items: "Change kit", extension: "Extend rental", cancel: "Cancel rental" }[kind];
    const messageId = await postRentalMessage(ctx, { accountId: a._id, bookingId, sender: "renter", text: `${label} request: ${text}`, meta: { type: "rental_change_request", kind, requestedStage: b.status } });
    await ctx.db.insert("rental_change_requests", { requestId, accountId: a._id, bookingId, kind, detail: text, messageId, createdAt: Date.now() });
    await ctx.scheduler.runAfter(0, internal.notify.renterChat, { email: a.email, bookingId, text: `${label} request: ${text}` });
    return { ok: true, messageId };
  },
});
