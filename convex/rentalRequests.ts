import { query, mutation } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import { accountForToken, ownedBooking, rentalThread, postRentalMessage } from "./lib/rentalChat";
import { bookingCancelKind, cancellationDaysForBooking, NO_REFUND_WITHIN_48_HOURS_CANCELLATION_VERSION } from "../src/lib/cancellationPolicy";
import { assertAdmin, checkAdminToken } from "./adminAuth";
import { belongsToRentalAccount } from "./lib/rentalAccount";
import type { Id } from "./_generated/dataModel";
import { paginationOptsValidator } from "convex/server";
import { listingRentalImages } from "./lib/catalogImages";

const labels = { dates: "Change dates", items: "Change kit", extension: "Extend rental", cancel: "Cancel rental" };
const requestStillOpen = (request: { status?: string; execution?: { status?: string } }) =>
  (request.status ?? "pending") === "pending" || request.status === "approved" && request.execution?.status !== "applied";

/** Bounded, reactive request history for the selected rental only. */
export const list = query({
  args: { token: v.string(), bookingId: v.id("bookings"), admin: v.optional(v.boolean()), paginationOpts: paginationOptsValidator },
  handler: async (ctx, { token, bookingId, admin, paginationOpts }) => {
    if (!Number.isSafeInteger(paginationOpts.numItems) || paginationOpts.numItems < 1 || paginationOpts.numItems > 50) throw Error("Choose 1–50 requests per page.");
    let accountId: Id<"accounts"> | undefined;
    if (admin) {
      if (!checkAdminToken(token)) throw Error("unauthorized");
      if (!await ctx.db.get(bookingId)) return { page: [], isDone: true, continueCursor: "" };
    } else {
      const account = await accountForToken(ctx, token, true);
      if (!account) throw Error("Please sign in.");
      await ownedBooking(ctx, account, bookingId);
      accountId = account._id;
    }
    const scoped = ctx.db.query("rental_change_requests").withIndex("by_booking", q => q.eq("bookingId", bookingId)).order("desc");
    const rows = await (admin ? scoped : scoped.filter(q => q.eq(q.field("accountId"), accountId))).paginate(paginationOpts);
    return { ...rows, page: rows.page.map(row => ({
      _id: row._id, kind: row.kind, detail: row.detail, createdAt: row.createdAt,
      cancellationKindAtRequest: row.cancellationKindAtRequest,
      cancellationTermsVersion: row.cancellationTermsVersion,
      cancellationChoice: row.cancellationChoice,
      status: row.status ?? "pending", decisionNote: row.decisionNote, decidedAt: row.decidedAt,
      execution: row.execution ? { operation: row.execution.operation, status: row.execution.status, appliedAt: row.execution.appliedAt, detail: row.execution.detail } : undefined,
    })) };
  },
});

/** This records the human decision, not a dates/stock/payment mutation.
 * Those changes retain their existing inventory, bank and verification gates. */
export const review = mutation({
  args: { token: v.string(), bookingId: v.id("bookings"), id: v.id("rental_change_requests"),
    decision: v.union(v.literal("approved"), v.literal("declined")), note: v.string() },
  handler: async (ctx, { token, bookingId, id, decision, note }) => {
    await assertAdmin(ctx, token, "rentalRequests.review");
    const request = await ctx.db.get(id);
    const booking = await ctx.db.get(bookingId);
    const account = request ? await ctx.db.get(request.accountId) : null;
    if (!request || request.bookingId !== bookingId || !belongsToRentalAccount(booking, account)) throw Error("This request is not available for this rental.");
    const text = note.trim();
    if (text.length < 5 || text.length > 1000) throw Error("Record a reply in 5–1000 characters.");
    if (request.status && request.status !== "pending") {
      if (request.status !== decision || request.decisionNote !== text) throw Error("This request has already been reviewed. Discuss any further change in the conversation.");
      return { ok: true, status: decision, messageId: request.decisionMessageId };
    }
    if (decision === "approved") {
      const competing = await ctx.db.query("rental_change_requests").withIndex("by_booking", q => q.eq("bookingId", bookingId)).order("desc").take(50);
      if (competing.some(other => other._id !== id && requestStillOpen(other)))
        throw Error("Resolve the other open request for this rental before approving another change.");
    }
    if (decision === "approved" && (!["pending_payment", "confirmed", "active"].includes(booking!.status) || booking!.cancellationDecision || booking!.returnDecision)) throw Error("This rental can no longer accept a new change. Reply in the conversation instead.");
    if (decision === "approved" && request.kind === "cancel" && booking!.status === "active") throw Error("This rental has started. Arrange an early return in the conversation instead.");
    const messageId = await postRentalMessage(ctx, { accountId: request.accountId, bookingId, sender: "system",
      text: decision === "approved"
        ? `The team approved your ${labels[request.kind].toLowerCase()} request for arrangement: ${text} Your rental is unchanged until the team confirms the actual update and any settlement separately.`
        : `The team declined your ${labels[request.kind].toLowerCase()} request: ${text} Your rental is unchanged. Reply here if you would like to discuss another option.`,
      meta: { type: "rental_change_decision", changeRequestId: id, decision } });
    await ctx.db.patch(id, { status: decision, decisionNote: text, decidedAt: Date.now(), decisionMessageId: messageId });
    return { ok: true, status: decision, messageId };
  },
});

export const context = query({
  args: { token: v.string(), bookingId: v.id("bookings"), refreshKey: v.optional(v.number()) },
  handler: async (ctx, { token, bookingId }) => {
    const a = await accountForToken(ctx, token, true);
    if (!a) return null;
    const b = await ownedBooking(ctx, a, bookingId);
    const reservations = await ctx.db.query("reservations").withIndex("by_booking", q => q.eq("bookingId", bookingId)).collect();
    const recentRequests = await ctx.db.query("rental_change_requests").withIndex("by_booking", q => q.eq("bookingId", bookingId)).order("desc").take(50);
    const requestInProgress = recentRequests.some(requestStillOpen);
    const items = await Promise.all(b.lineItems.map(async (line: { listingId: Id<"listings">; title: string; start: number; end: number; qty: number }, index: number) => {
      const imageSources = listingRentalImages(await ctx.db.get(line.listingId));
      return { index, listingId: line.listingId, title: line.title, start: line.start, end: line.end, qty: line.qty, imageSources, heroImage: imageSources[0] ?? null };
    }));
    return { status: b.status, start: Math.min(...b.lineItems.map((l: { start: number }) => l.start)), end: Math.max(...b.lineItems.map((l: { end: number }) => l.end)),
      items,
      cancellationKind: bookingCancelKind(b, Date.now()), cancellationFullRefundDays: cancellationDaysForBooking(b),
      cancellationTermsVersion: b.agreementDocs?.find((d: { kind: string; version: string }) => d.kind === "cancellation")?.version ?? "2026-10-v10",
      direct: reservations.every(r => r.source === "site"),
      selfService: process.env.CUSTOMER_BOOKING_ACTIONS === "true",
      locked: !!(b.cancellationDecision || (b.activeAdditionId || b.activeExtensionId) || b.returnDecision || requestInProgress) };
  },
});

/** Requests reach a human; they never mutate dates, prices or payments. */
export const submit = mutation({
  args: { token: v.string(), bookingId: v.id("bookings"), requestId: v.string(),
    kind: v.union(v.literal("dates"), v.literal("items"), v.literal("extension"), v.literal("cancel")), detail: v.string(),
    cancellationChoice: v.optional(v.union(v.literal("refund"), v.literal("credit"))) },
  handler: async (ctx, { token, bookingId, requestId, kind, detail, cancellationChoice }) => {
    const a = await accountForToken(ctx, token, true);
    if (!a) throw Error("Please sign in.");
    const b = await ownedBooking(ctx, a, bookingId);
    if (!/^[a-zA-Z0-9-]{16,80}$/.test(requestId)) throw Error("Invalid request.");
    const previous = await ctx.db.query("rental_change_requests").withIndex("by_request", q => q.eq("requestId", requestId)).first();
    if (previous) {
      if (previous.accountId !== a._id || previous.bookingId !== bookingId || previous.kind !== kind || previous.detail !== detail.trim() || previous.cancellationChoice !== cancellationChoice) throw Error("Request belongs to a different change.");
      return { ok: true, messageId: previous.messageId };
    }
    if (!["pending_payment", "confirmed", "active"].includes(b.status)) throw Error("This rental has finished. Please message the team instead.");
    if (kind === "cancel" && b.status === "active") throw Error("This rental has started. Ask the team about an early return instead.");
    if (kind !== "cancel" && cancellationChoice !== undefined) throw Error("A cancellation settlement choice is only valid for a cancellation request.");
    if (b.cancellationDecision || b.returnDecision) throw Error("A cancellation or return is already being processed.");
    const text = detail.trim();
    if (text.length < 5 || text.length > 1000) throw Error("Describe your request in 5–1000 characters.");
    const createdAt = Date.now();
    const cancellationTermsVersion = kind === "cancel" ? b.agreementDocs?.find((d: { kind: string; version: string }) => d.kind === "cancellation")?.version ?? "2026-10-v10" : undefined;
    const cancellationKindAtRequest = kind === "cancel" && b.status === "confirmed" ? bookingCancelKind(b, createdAt) : undefined;
    if (cancellationTermsVersion === NO_REFUND_WITHIN_48_HOURS_CANCELLATION_VERSION && b.status === "confirmed") {
      if (cancellationKindAtRequest === "full_refund" && !cancellationChoice) throw Error("Choose a full refund or 100% account credit before sending this cancellation request.");
      if (cancellationKindAtRequest !== "full_refund" && cancellationChoice) throw Error("The accepted terms allow only the stated cancellation outcome at this time.");
    } else if (cancellationChoice !== undefined) {
      throw Error("A settlement choice is not available under the terms accepted for this rental.");
    }
    const recent = await ctx.db.query("rental_change_requests").withIndex("by_account", q => q.eq("accountId", a._id)).order("desc").take(10);
    if (recent.filter(r => r.createdAt > Date.now() - 60000).length >= 3) throw Error("Please wait a minute before sending another request.");
    const openRequests = await ctx.db.query("rental_change_requests").withIndex("by_booking", q => q.eq("bookingId", bookingId)).order("desc").take(50);
    if (openRequests.some(requestStillOpen))
      throw Error("A change request is already awaiting the team. Wait for the decision before sending another.");
    const thread = await rentalThread(ctx, a._id, bookingId);
    if (thread) await ctx.db.patch(thread._id, { escalated: true });
    else await ctx.db.insert("chat_threads", { accountId: a._id, bookingId, escalated: true, updatedAt: Date.now(), unreadOwner: 0, unreadRenter: 0 });
    const label = labels[kind];
    const cancellationSummary = cancellationKindAtRequest === "full_refund"
      ? `\nCancellation terms at request: more than seven London calendar days before pickup. Renter chose ${cancellationChoice === "credit" ? "100% account credit" : "a full refund to the original payment method"}.`
      : cancellationKindAtRequest === "store_credit"
        ? "\nCancellation terms at request: more than 48 hours and seven or fewer London calendar days before pickup; account credit only."
        : cancellationKindAtRequest === "no_refund"
          ? "\nCancellation terms at request: 48 hours or less before pickup; no rental refund or account credit."
          : "";
    const messageId = await postRentalMessage(ctx, { accountId: a._id, bookingId, sender: "renter", text: `${label} request: ${text}${cancellationSummary}`, meta: { type: "rental_change_request", kind, requestedStage: b.status, ...(cancellationKindAtRequest ? { cancellationKindAtRequest } : {}), ...(cancellationTermsVersion ? { cancellationTermsVersion } : {}), ...(cancellationChoice ? { cancellationChoice } : {}) } });
    await ctx.db.insert("rental_change_requests", { requestId, accountId: a._id, bookingId, kind, detail: text, messageId, createdAt, ...(cancellationKindAtRequest ? { cancellationKindAtRequest } : {}), ...(cancellationTermsVersion ? { cancellationTermsVersion } : {}), ...(cancellationChoice ? { cancellationChoice } : {}), status: "pending" });
    await ctx.scheduler.runAfter(0, internal.notify.renterChat, { email: a.email, bookingId, text: `${label} request: ${text}` });
    return { ok: true, messageId };
  },
});
