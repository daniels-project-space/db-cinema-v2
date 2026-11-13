import { action, query, mutation, internalQuery } from "./_generated/server";
import { api, internal } from "./_generated/api";
import { v } from "convex/values";
import { accountForToken, ownedBooking, rentalThread, postRentalMessage, scheduleGafferAutoResume } from "./lib/rentalChat";
import { bookingCancelKind, cancellationDaysForBooking, cancellationTimingBasis, isNoRefundWithin48HoursCancellationVersion } from "../src/lib/cancellationPolicy";
import { assertAdmin, checkAdminToken } from "./adminAuth";
import { belongsToRentalAccount } from "./lib/rentalAccount";
import type { Id } from "./_generated/dataModel";
import { paginationOptsValidator } from "convex/server";
import { listingRentalImages } from "./lib/catalogImages";
import { assertRenterRentalActionReady, renterRentalActionReady } from "./lib/renterRentalActionGate";
import { RENTAL_REQUEST_HISTORY_LIMIT, rentalRequestStillOpen, summarizeRentalRequests } from "./lib/rentalRequestStatus";

const labels = { dates: "Change dates", items: "Change kit", extension: "Extend rental", cancel: "Cancel rental", handover: "Change handover time" };
const itemSelectionKey = (line: any) => JSON.stringify([
  line.listingId, line.title, line.qty, line.start, line.end, line.lineTotal,
  line.dailyRate ?? null, line.pickupTime ?? null, line.returnTime ?? null,
]);
const resolveRequestedItemIndexes = (requestedItems: any, lineItems: any[]): number[] | null => {
  const selections = requestedItems?.selections;
  if (!Array.isArray(selections) || !selections.length || selections.length !== requestedItems.lineIndexes?.length) return null;
  const currentByKey = new Map<string, number[]>();
  lineItems.forEach((line, index) => {
    const key = itemSelectionKey(line);
    currentByKey.set(key, [...(currentByKey.get(key) ?? []), index]);
  });
  const requestedByKey = new Map<string, any[]>();
  selections.forEach((selection: any) => {
    const key = itemSelectionKey(selection);
    requestedByKey.set(key, [...(requestedByKey.get(key) ?? []), selection]);
  });
  const resolved = new Map<number, number>();
  for (const [key, matchingSelections] of requestedByKey) {
    const currentIndexes = currentByKey.get(key) ?? [];
    if (currentIndexes.length < matchingSelections.length) return null;
    matchingSelections.sort((left, right) => left.originalIndex - right.originalIndex)
      .forEach((selection, offset) => resolved.set(selection.originalIndex, currentIndexes[offset]));
  }
  const lineIndexes = selections.map((selection: any) => resolved.get(selection.originalIndex));
  return lineIndexes.every((index: number | undefined) => index !== undefined) ? lineIndexes as number[] : null;
};
const requestStillOpen = rentalRequestStillOpen;
async function bookingRequestSummary(ctx: any, bookingId: Id<"bookings">, ignoreId?: string) {
  const rows = await ctx.db.query("rental_change_requests").withIndex("by_booking", (q: any) => q.eq("bookingId", bookingId)).order("desc").take(RENTAL_REQUEST_HISTORY_LIMIT + 1);
  return summarizeRentalRequests(rows, ignoreId);
}
const hasBlockingRentalOperation = (booking: any) => !!(
  booking?.cancellationDecision || booking?.returnDecision || booking?.activeAdditionId ||
  booking?.activeDeliveryQuoteId || booking?.activeExtensionId || booking?.activeItemSwapId ||
  booking?.activePriceAdjustmentId
);

/** Bounded, reactive request history for the selected rental only. */
export const list = query({
  args: { token: v.string(), bookingId: v.id("bookings"), admin: v.optional(v.boolean()), paginationOpts: paginationOptsValidator },
  handler: async (ctx, { token, bookingId, admin, paginationOpts }) => {
    if (!Number.isSafeInteger(paginationOpts.numItems) || paginationOpts.numItems < 1 || paginationOpts.numItems > 50) throw Error("Choose 1–50 requests per page.");
    let accountId: Id<"accounts"> | undefined;
    let booking: any;
    if (admin) {
      if (!checkAdminToken(token)) throw Error("unauthorized");
      booking = await ctx.db.get(bookingId);
      if (!booking) return { page: [], isDone: true, continueCursor: "" };
    } else {
      const account = await accountForToken(ctx, token, true);
      if (!account) throw Error("Please sign in.");
      booking = await ownedBooking(ctx, account, bookingId);
      accountId = account._id;
    }
    const scoped = ctx.db.query("rental_change_requests").withIndex("by_booking", q => q.eq("bookingId", bookingId)).order("desc");
    const rows = await (admin ? scoped : scoped.filter(q => q.eq(q.field("accountId"), accountId))).paginate(paginationOpts);
    return { ...rows, page: rows.page.map(row => ({
      _id: row._id, kind: row.kind, detail: row.detail, createdAt: row.createdAt,
      ...(admin ? { requestId: row.requestId } : {}),
      cancellationKindAtRequest: row.cancellationKindAtRequest,
      cancellationTermsVersion: row.cancellationTermsVersion,
      cancellationChoice: row.cancellationChoice,
      requestedStart: row.requestedStart,
      requestedEnd: row.requestedEnd,
      ...(row.requestedItems ? (() => {
        const currentLineIndexes = resolveRequestedItemIndexes(row.requestedItems, booking.lineItems ?? []);
        return {
          requestedItems: { lineIndexes: row.requestedItems.lineIndexes },
          itemChangeItems: (row.requestedItems.selections ?? []).map((selection: any) => ({ lineIndex: selection.originalIndex, title: selection.title, qty: selection.qty })),
          ...(admin ? { currentLineIndexes: currentLineIndexes ?? undefined, itemSelectionStale: currentLineIndexes === null } : {}),
        };
      })() : {}),
      ...(row.requestedHandover ? {
        requestedHandover: row.requestedHandover,
        handoverItems: row.requestedHandover.lineIndexes.map(lineIndex => {
          const line = booking.lineItems?.[lineIndex];
          return line ? { lineIndex, title: line.title, qty: line.qty } : null;
        }).filter((item): item is { lineIndex: number; title: string; qty: number } => item !== null),
      } : {}),
      requestedSnapshot: admin ? row.requestedSnapshot : undefined,
      ...(admin ? { approvalBlocked: hasBlockingRentalOperation(booking) } : {}),
      status: row.status ?? "pending", decisionNote: row.decisionNote, decidedAt: row.decidedAt,
      execution: row.execution ? { operation: row.execution.operation, status: row.execution.status, appliedAt: row.execution.appliedAt, detail: row.execution.detail } : undefined,
    })) };
  },
});

/** Admin-only request blockers, independent of the paginated display history. */
export const blockingActions = query({
  args: { token: v.string(), bookingId: v.id("bookings") },
  handler: async (ctx, { token, bookingId }) => {
    if (!checkAdminToken(token)) throw Error("unauthorized");
    if (!await ctx.db.get(bookingId)) return { ready: true, any: false, dates: false, cancel: false, handover: false, other: false };
    return bookingRequestSummary(ctx, bookingId);
  },
});

/** Internal form for actions that recheck request blockers server-side. */
export const blockingActionsInternal = internalQuery({
  args: {
    bookingId: v.id("bookings"),
    ignoreRequestId: v.optional(v.id("rental_change_requests")),
    expectedKind: v.optional(v.union(v.literal("dates"), v.literal("cancel"), v.literal("handover"))),
  },
  handler: async (ctx, { bookingId, ignoreRequestId, expectedKind }) => {
    if (ignoreRequestId) {
      const request = await ctx.db.get(ignoreRequestId);
      if (!request || request.bookingId !== bookingId || request.status !== "approved" || !expectedKind || request.kind !== expectedKind)
        throw Error("Only this rental’s approved matching request can be excluded from the blocker check.");
    }
    return bookingRequestSummary(ctx, bookingId, ignoreRequestId);
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
    if (!request || !booking || request.bookingId !== bookingId || !belongsToRentalAccount(booking, account)) throw Error("This request is not available for this rental.");
    const text = note.trim();
    if (text.length < 5 || text.length > 1000) throw Error("Record a reply in 5–1000 characters.");
    if (request.status && request.status !== "pending") {
      if (request.status !== decision || request.decisionNote !== text) throw Error("This request has already been reviewed. Discuss any further change in the conversation.");
      return { ok: true, status: decision, messageId: request.decisionMessageId };
    }
    if (decision === "approved") {
      if (request.kind === "items" && !resolveRequestedItemIndexes(request.requestedItems, booking.lineItems ?? []))
        throw Error("The renter’s selected items have changed. Ask them to select the current kit items again before approving.");
      if (request.kind === "extension") throw Error("This older free-text request has no availability or price quote. Use the live extension panel instead.");
      const competing = await ctx.db.query("rental_change_requests").withIndex("by_booking", q => q.eq("bookingId", bookingId)).order("desc").take(RENTAL_REQUEST_HISTORY_LIMIT + 1);
      if (competing.length > RENTAL_REQUEST_HISTORY_LIMIT) throw Error("This rental has a long request history. Review the earlier requests before approving a change.");
      if (competing.some(other => other._id !== id && requestStillOpen(other)))
        throw Error("Resolve the other open request for this rental before approving another change.");
      if (hasBlockingRentalOperation(booking))
        throw Error("Finish the active rental operation before approving this request. The renter’s rental has not changed.");
      if (request.kind === "dates" && request.requestedStart !== undefined) {
        if (request.requestedEnd === undefined || !request.requestedSnapshot) throw Error("This date request is incomplete. Ask the renter to send it again.");
        const preview = await ctx.runQuery(api.rentalOperations.previewReschedule, {
          token,
          bookingId,
          start: request.requestedStart,
          reason: request.detail,
        });
        if (!preview.ok || preview.controlsSnapshot !== request.requestedSnapshot || preview.end !== request.requestedEnd) {
          throw Error(preview.reason ?? "The rental or availability has changed. Ask the renter to send a fresh date request.");
        }
      }
      if (request.kind === "handover") {
        const proposal = request.requestedHandover;
        if (!proposal || !request.requestedSnapshot) throw Error("This time request is incomplete. Ask the renter to send it again.");
        const preview = await ctx.runQuery(api.rentalOperations.previewHandoverTimes, {
          token,
          bookingId,
          lineIndexes: proposal.lineIndexes,
          kind: proposal.kind,
          time: proposal.time,
          reason: request.detail,
        });
        if (!preview.ok || preview.controlsSnapshot !== request.requestedSnapshot || JSON.stringify(preview.lineIndexes) !== JSON.stringify([...proposal.lineIndexes].sort((left, right) => left - right)))
          throw Error(preview.reason ?? "The rental or availability has changed. Ask the renter to send a fresh time request.");
      }
    }
    if (decision === "approved" && (!(["pending_payment", "confirmed", "active"].includes(booking!.status) ||
        request.kind === "cancel" && booking!.status === "pending_verification" && booking!.verificationProvider === "didit" &&
        Number.isSafeInteger(booking!.checkoutPaidAt) && typeof booking!.checkoutPaidAt === "number" && booking!.checkoutPaidAt > 0) || booking!.cancellationDecision || booking!.returnDecision))
      throw Error("This rental can no longer accept a new change. Reply in the conversation instead.");
    if (decision === "approved" && request.kind === "cancel" && booking!.status === "active") throw Error("This rental has started. Arrange an early return in the conversation instead.");
    const messageId = await postRentalMessage(ctx, { accountId: request.accountId, bookingId, sender: "system",
      text: decision === "approved"
        ? request.kind === "items"
          ? `The team approved your kit-change request for a live quote: ${text} Your booked kit and return times stay unchanged until you accept the quoted equipment, dates, and any payment or refund.`
          : `The team approved your ${labels[request.kind].toLowerCase()} request for arrangement: ${text} Your rental is unchanged until the team confirms the actual update and any settlement separately.`
        : `The team declined your ${labels[request.kind].toLowerCase()} request: ${text} Your rental is unchanged. Reply here if you would like to discuss another option.`,
      meta: { type: "rental_change_decision", changeRequestId: id, decision } });
    await ctx.db.patch(id, { status: decision, decisionNote: text, decidedAt: Date.now(), decisionMessageId: messageId });
    return { ok: true, status: decision, messageId };
  },
});

/** Read the exact approved request for the server-side approve-and-apply action. */
export const approvedExecutionContext = internalQuery({
  args: { token: v.string(), bookingId: v.id("bookings"), id: v.id("rental_change_requests") },
  handler: async (ctx, { token, bookingId, id }) => {
    if (!checkAdminToken(token)) throw Error("unauthorized");
    const request = await ctx.db.get(id);
    const booking = await ctx.db.get(bookingId);
    const account = request ? await ctx.db.get(request.accountId) : null;
    if (!request || !booking || request.bookingId !== bookingId || !belongsToRentalAccount(booking, account)) return null;
    if (request.status !== "approved") throw Error("Approve this renter request before applying it.");
    return {
      kind: request.kind,
      status: request.status,
      execution: request.execution,
      requestId: request.requestId,
      requestedStart: request.requestedStart,
      requestedEnd: request.requestedEnd,
      requestedSnapshot: request.requestedSnapshot,
      requestedHandover: request.requestedHandover,
      cancellationKindAtRequest: request.cancellationKindAtRequest,
      cancellationTermsVersion: request.cancellationTermsVersion,
      cancellationChoice: request.cancellationChoice,
      decisionNote: request.decisionNote,
    };
  },
});

/** One explicit admin approval applies a structured request through the existing guarded operation. */
export const approveAndApply = action({
  args: { token: v.string(), bookingId: v.id("bookings"), id: v.id("rental_change_requests"), note: v.string() },
  handler: async (ctx, args): Promise<{ status: "applied" | "processing" | "needs_review"; detail?: string }> => {
    const note = args.note.trim();
    if (note.length < 5 || note.length > 1000) throw Error("Record a reply in 5–1000 characters.");
    await ctx.runMutation(api.rentalRequests.review, { ...args, decision: "approved", note });
    const request: any = await ctx.runQuery(internal.rentalRequests.approvedExecutionContext, args);
    if (!request) throw Error("This approved request is not available for the selected rental.");
    if (request.execution?.status === "applied") return { status: "applied", detail: request.execution.detail };

    if (request.kind === "dates") {
      if (request.requestedStart === undefined || request.requestedEnd === undefined || !request.requestedSnapshot)
        throw Error("This older date request needs a fresh availability review before it can be applied.");
      await ctx.runMutation(api.rentalOperations.reschedule, {
        token: args.token,
        bookingId: args.bookingId,
        changeRequestId: args.id,
        start: request.requestedStart,
        reason: note,
        expectedSnapshot: request.requestedSnapshot,
      });
    } else if (request.kind === "handover") {
      const proposal = request.requestedHandover;
      if (!request.requestId || !request.requestedSnapshot || !proposal)
        throw Error("This older time request needs a fresh availability review before it can be applied.");
      await ctx.runMutation(api.rentalOperations.changeHandoverTimes, {
        token: args.token,
        bookingId: args.bookingId,
        requestId: request.requestId,
        changeRequestId: args.id,
        lineIndexes: proposal.lineIndexes,
        kind: proposal.kind,
        time: proposal.time,
        expectedSnapshot: request.requestedSnapshot,
        reason: note,
      });
    } else if (request.kind === "cancel") {
      // Older free-text requests do not carry the accepted terms snapshot or the renter's
      // required settlement choice, so they keep the explicit recovery/clarification path.
      if (!request.cancellationKindAtRequest || !request.cancellationTermsVersion)
        throw Error("This older cancellation request needs a fresh terms review before it can be applied.");
      try {
        await ctx.runAction(api.checkout.cancelByAdmin, {
          token: args.token,
          bookingId: args.bookingId,
          changeRequestId: args.id,
          expectedCancellationKind: request.cancellationKindAtRequest,
          ...(request.cancellationChoice ? { customerChoice: request.cancellationChoice } : {}),
          reason: note,
        });
      } catch (error: any) {
        if (error?.data?.code === "CANCELLATION_PENDING") return { status: "processing", detail: "Cancellation settlement is processing; any required Stripe approval will finish automatically." };
        if (error?.data?.code === "CANCELLATION_REVIEW") return { status: "needs_review", detail: error.data.message };
        throw error;
      }
    } else {
      throw Error("This request needs its quote and payment flow before the booking can change.");
    }

    const after: any = await ctx.runQuery(internal.rentalRequests.approvedExecutionContext, args);
    if (after?.execution?.status === "applied") return { status: "applied", detail: after.execution.detail };
    if (after?.execution?.status === "processing") return { status: "processing", detail: "The approved change is processing and will update here when complete." };
    if (request.kind === "cancel") return { status: "processing", detail: "Cancellation settlement is processing; any required Stripe approval will finish automatically." };
    throw Error("Approval was saved, but the booking change was not applied. Retry from the saved request after checking availability.");
  },
});

export const context = query({
  args: { token: v.string(), bookingId: v.id("bookings"), refreshKey: v.optional(v.number()) },
  handler: async (ctx, { token, bookingId }) => {
    const a = await accountForToken(ctx, token, true);
    if (!a) return null;
    const b = await ownedBooking(ctx, a, bookingId);
    const reservations = await ctx.db.query("reservations").withIndex("by_booking", q => q.eq("bookingId", bookingId)).collect();
    const requestSummary = await bookingRequestSummary(ctx, bookingId);
    const requestInProgress = requestSummary.any || !requestSummary.ready;
    const items = await Promise.all(b.lineItems.map(async (line: { listingId: Id<"listings">; title: string; start: number; end: number; qty: number; pickupTime?: string | null; returnTime?: string | null }, index: number) => {
      const imageSources = listingRentalImages(await ctx.db.get(line.listingId));
      return { index, listingId: line.listingId, title: line.title, start: line.start, end: line.end, qty: line.qty, pickupTime: line.pickupTime ?? undefined, returnTime: line.returnTime ?? undefined, imageSources, heroImage: imageSources[0] ?? null };
    }));
    return { status: b.status, start: Math.min(...b.lineItems.map((l: { start: number }) => l.start)), end: Math.max(...b.lineItems.map((l: { end: number }) => l.end)),
      items,
      actionReady: renterRentalActionReady(b),
      cancellationKind: bookingCancelKind(b, Date.now()), cancellationFullRefundDays: cancellationDaysForBooking(b),
      canRequestPaidPendingCancellation: b.status === "pending_verification" && b.siteOnly === true && b.verificationProvider === "didit" && Number.isSafeInteger(b.checkoutPaidAt) && b.checkoutPaidAt > 0,
      cancellationTermsVersion: b.agreementDocs?.find((d: { kind: string; version: string }) => d.kind === "cancellation")?.version ?? "2026-10-v10",
      direct: reservations.every(r => r.source === "site"),
      selfService: process.env.CUSTOMER_BOOKING_ACTIONS === "true",
      locked: hasBlockingRentalOperation(b) || requestInProgress };
  },
});

/** Requests reach a human; they never mutate dates, prices or payments. */
export const submit = mutation({
  args: { token: v.string(), bookingId: v.id("bookings"), requestId: v.string(),
    kind: v.union(v.literal("dates"), v.literal("items"), v.literal("extension"), v.literal("cancel"), v.literal("handover")), detail: v.string(),
    proposedStart: v.optional(v.number()),
    itemLineIndexes: v.optional(v.array(v.number())),
    handoverKind: v.optional(v.union(v.literal("pickup"), v.literal("return"))),
    handoverTime: v.optional(v.string()),
    handoverLineIndexes: v.optional(v.array(v.number())),
    cancellationChoice: v.optional(v.union(v.literal("refund"), v.literal("credit"))) },
  handler: async (ctx, { token, bookingId, requestId, kind, detail, proposedStart, itemLineIndexes, handoverKind, handoverTime, handoverLineIndexes, cancellationChoice }) => {
    const a = await accountForToken(ctx, token, true);
    if (!a) throw Error("Please sign in.");
    const b = await ownedBooking(ctx, a, bookingId);
    if (["returned", "cancelled", "declined", "expired"].includes(b.status)) throw Error("This rental has finished. Please message the team instead.");
    const paidPendingDiditCancellation = kind === "cancel" && b.status === "pending_verification" &&
      b.siteOnly === true && b.verificationProvider === "didit" &&
      Number.isSafeInteger(b.checkoutPaidAt) && b.checkoutPaidAt > 0;
    if (!paidPendingDiditCancellation) assertRenterRentalActionReady(b);
    if (!/^[a-zA-Z0-9-]{16,80}$/.test(requestId)) throw Error("Invalid request.");
    if (kind === "extension") throw Error("Use the extension panel to check availability and request a priced extension.");
    const requestedItems = kind === "items" && itemLineIndexes ? {
      lineIndexes: [...new Set(itemLineIndexes)].sort((left, right) => left - right),
      selections: [...new Set(itemLineIndexes)].sort((left, right) => left - right).map(originalIndex => {
        const line = b.lineItems[originalIndex];
        return {
          originalIndex, listingId: line.listingId, title: line.title, qty: line.qty,
          start: line.start, end: line.end, lineTotal: line.lineTotal,
          ...(line.dailyRate !== undefined ? { dailyRate: line.dailyRate } : {}),
          ...(line.pickupTime !== undefined ? { pickupTime: line.pickupTime } : {}),
          ...(line.returnTime !== undefined ? { returnTime: line.returnTime } : {}),
        };
      }),
    } : undefined;
    if (kind === "items" && (!requestedItems || requestedItems.lineIndexes.length !== itemLineIndexes?.length || !requestedItems.lineIndexes.length || requestedItems.lineIndexes.some(index => !Number.isSafeInteger(index) || index < 0 || index >= b.lineItems.length))) throw Error("Choose one or more items from this rental.");
    if (kind !== "items" && itemLineIndexes !== undefined) throw Error("Item selections are only valid for a kit-change request.");
    const previous = await ctx.db.query("rental_change_requests").withIndex("by_request", q => q.eq("requestId", requestId)).first();
    if (previous) {
      if (previous.accountId !== a._id || previous.bookingId !== bookingId || previous.kind !== kind || previous.detail !== detail.trim() || previous.cancellationChoice !== cancellationChoice || previous.requestedStart !== proposedStart || JSON.stringify(previous.requestedItems?.lineIndexes ?? null) !== JSON.stringify(requestedItems?.lineIndexes ?? null) || JSON.stringify(previous.requestedItems?.selections ?? null) !== JSON.stringify(requestedItems?.selections ?? null) || previous.requestedHandover?.kind !== handoverKind || previous.requestedHandover?.time !== handoverTime || JSON.stringify(previous.requestedHandover?.lineIndexes ?? null) !== JSON.stringify(handoverLineIndexes ? [...handoverLineIndexes].sort((left, right) => left - right) : null)) throw Error("Request belongs to a different change.");
      return { ok: true, messageId: previous.messageId };
    }
    if (!( ["confirmed", "active"].includes(b.status) || paidPendingDiditCancellation)) throw Error("This rental has finished. Please message the team instead.");
    if (kind === "cancel" && b.status === "active") throw Error("This rental has started. Ask the team about an early return instead.");
    if (kind !== "cancel" && cancellationChoice !== undefined) throw Error("A cancellation settlement choice is only valid for a cancellation request.");
    if (hasBlockingRentalOperation(b)) throw Error("Finish the active rental operation before sending another request.");
    const text = detail.trim();
    if (text.length < 5 || text.length > 1000) throw Error("Describe your request in 5–1000 characters.");
    if (kind === "dates" && (b.status !== "confirmed" || !Number.isSafeInteger(proposedStart))) throw Error("Choose a new collection date and wait for the live availability check.");
    if (kind !== "dates" && proposedStart !== undefined) throw Error("A collection date is only valid for a date-change request.");
    if (kind !== "handover" && (handoverKind !== undefined || handoverTime !== undefined || handoverLineIndexes !== undefined)) throw Error("A handover time is only valid for a pickup or return-time request.");
    if (kind === "handover" && (!handoverKind || !handoverTime || !handoverLineIndexes)) throw Error("Choose pickup or return, the items affected, and a new time.");
    if (kind === "handover" && handoverKind === "pickup" && b.status !== "confirmed") throw Error("Pickup time can only change before collection. Ask the team about return time instead.");
    const proposedHandover = kind === "handover" ? {
      lineIndexes: [...new Set(handoverLineIndexes!)].sort((left, right) => left - right),
      kind: handoverKind!,
      time: handoverTime!,
    } : undefined;
    if (proposedHandover && (proposedHandover.lineIndexes.length !== handoverLineIndexes!.length || !proposedHandover.lineIndexes.length || proposedHandover.lineIndexes.some(index => !Number.isSafeInteger(index) || index < 0 || index >= b.lineItems.length))) throw Error("Choose one or more items from this rental.");
    if (kind === "handover" && proposedHandover && proposedHandover.lineIndexes.every(index => (handoverKind === "pickup" ? b.lineItems[index].pickupTime : b.lineItems[index].returnTime) === handoverTime)) throw Error("Choose a new time for at least one selected item.");
    let dateProposal: { start: number; end: number; snapshot: string } | undefined;
    if (kind === "dates") {
      const preview = await ctx.runQuery(api.rentalOperations.renterReschedulePreview, { token, bookingId, start: proposedStart!, reason: text });
      if (preview.ok !== true || typeof preview.start !== "number" || typeof preview.end !== "number" || typeof preview.controlsSnapshot !== "string") throw Error(preview.reason ?? "Those dates are not currently available.");
      dateProposal = { start: preview.start, end: preview.end, snapshot: preview.controlsSnapshot };
    }
    let handoverSnapshot: string | undefined;
    if (proposedHandover) {
      const preview = await ctx.runQuery(api.rentalOperations.renterHandoverPreview, { token, bookingId, ...proposedHandover, reason: text });
      if (preview.ok !== true || typeof preview.controlsSnapshot !== "string" || JSON.stringify(preview.lineIndexes) !== JSON.stringify(proposedHandover.lineIndexes)) throw Error(preview.reason ?? "That handover time is not currently available.");
      handoverSnapshot = preview.controlsSnapshot;
    }
    const createdAt = Date.now();
    const cancellationTermsVersion = kind === "cancel" ? b.agreementDocs?.find((d: { kind: string; version: string }) => d.kind === "cancellation")?.version ?? "2026-10-v10" : undefined;
    const cancellationKindAtRequest = kind === "cancel" && ["confirmed", "pending_verification"].includes(b.status) ? bookingCancelKind(b, createdAt) : undefined;
    if (isNoRefundWithin48HoursCancellationVersion(cancellationTermsVersion) && ["confirmed", "pending_verification"].includes(b.status)) {
      if (cancellationKindAtRequest === "full_refund" && !cancellationChoice) throw Error("Choose a full refund or 100% account credit before sending this cancellation request.");
      if (cancellationKindAtRequest !== "full_refund" && cancellationChoice) throw Error("The accepted terms allow only the stated cancellation outcome at this time.");
    } else if (cancellationChoice !== undefined) {
      throw Error("A settlement choice is not available under the terms accepted for this rental.");
    }
    const recent = await ctx.db.query("rental_change_requests").withIndex("by_account", q => q.eq("accountId", a._id)).order("desc").take(10);
    if (recent.filter(r => r.createdAt > Date.now() - 60000).length >= 3) throw Error("Please wait a minute before sending another request.");
    const openRequests = await ctx.db.query("rental_change_requests").withIndex("by_booking", q => q.eq("bookingId", bookingId)).order("desc").take(RENTAL_REQUEST_HISTORY_LIMIT + 1);
    if (openRequests.length > RENTAL_REQUEST_HISTORY_LIMIT) throw Error("This rental has a long request history. Ask the team to review the earlier requests before sending another change.");
    if (openRequests.some(requestStillOpen))
      throw Error("A change request is already awaiting the team. Wait for the decision before sending another.");
    const thread = await rentalThread(ctx, a._id, bookingId);
    const escalationAt=Date.now();
    if (thread) await ctx.db.patch(thread._id, { escalated: true, ...(!thread.escalated?{escalatedAt:escalationAt,lastHumanActivityAt:undefined}:{}) });
    else await ctx.db.insert("chat_threads", { accountId: a._id, bookingId, escalated: true, escalatedAt:escalationAt, updatedAt: escalationAt, unreadOwner: 0, unreadRenter: 0 });
    await scheduleGafferAutoResume(ctx,a._id,bookingId);
    const label = labels[kind];
    const timingBasis = cancellationTimingBasis(cancellationKindAtRequest, cancellationTermsVersion);
    const cancellationSummary = timingBasis
      ? `\nCancellation terms at request: ${timingBasis}. ${cancellationKindAtRequest === "full_refund"
        ? `Renter chose ${cancellationChoice === "credit" ? "100% account credit" : "a full refund to the original payment method"}.`
        : cancellationKindAtRequest === "store_credit"
          ? "Account credit only."
          : "No rental refund and no account credit."}`
      : cancellationKindAtRequest === "full_refund"
      ? `\nCancellation terms at request: more than seven London calendar days before pickup. Renter chose ${cancellationChoice === "credit" ? "100% account credit" : "a full refund to the original payment method"}.`
      : cancellationKindAtRequest === "store_credit"
        ? "\nCancellation terms at request: more than 48 hours and seven or fewer London calendar days before pickup; account credit only."
        : cancellationKindAtRequest === "no_refund"
          ? "\nCancellation terms at request: 48 hours or less before pickup; no rental refund or account credit."
          : "";
    const itemChangeSummary = requestedItems ? ` Selected items: ${requestedItems.lineIndexes.map(index => { const line = b.lineItems[index]; const returnDate = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", day: "numeric", month: "short" }).format(new Date(line.end)); return `${line.qty}× ${line.title} (booked return ${returnDate}${line.returnTime ? ` at ${line.returnTime}` : " at the scheduled time"})`; }).join(", ")}. Keep the current kit and original return times unless you accept a new proposal.` : "";
    const dateSummary = dateProposal ? ` All items requested to move together to ${new Date(dateProposal.start).toISOString().slice(0, 10)}; estimated return date ${new Date(dateProposal.end).toISOString().slice(0, 10)}.` : "";
    const handoverSummary = proposedHandover ? ` ${proposedHandover.kind === "pickup" ? "Pickup" : "Return"} time requested: ${proposedHandover.time} for ${proposedHandover.lineIndexes.map(index => `${b.lineItems[index].qty}× ${b.lineItems[index].title}`).join(", ")}.` : "";
    const requestText = `${label} request: ${text}${itemChangeSummary}${dateSummary}${handoverSummary}${cancellationSummary}`;
    const messageId = await postRentalMessage(ctx, { accountId: a._id, bookingId, sender: "renter", text: requestText, meta: { type: "rental_change_request", kind, requestedStage: b.status, ...(requestedItems ? { requestedItems: { lineIndexes: requestedItems.lineIndexes } } : {}), ...(dateProposal ? { requestedStart: dateProposal.start, requestedEnd: dateProposal.end } : {}), ...(proposedHandover ? { requestedHandover: proposedHandover } : {}), ...(cancellationKindAtRequest ? { cancellationKindAtRequest } : {}), ...(cancellationTermsVersion ? { cancellationTermsVersion } : {}), ...(cancellationChoice ? { cancellationChoice } : {}) } });
    await ctx.db.insert("rental_change_requests", { requestId, accountId: a._id, bookingId, kind, detail: text, messageId, createdAt, ...(requestedItems ? { requestedItems } : {}), ...(dateProposal ? { requestedStart: dateProposal.start, requestedEnd: dateProposal.end, requestedSnapshot: dateProposal.snapshot } : {}), ...(proposedHandover ? { requestedHandover: proposedHandover, requestedSnapshot: handoverSnapshot } : {}), ...(cancellationKindAtRequest ? { cancellationKindAtRequest } : {}), ...(cancellationTermsVersion ? { cancellationTermsVersion } : {}), ...(cancellationChoice ? { cancellationChoice } : {}), status: "pending" });
    await ctx.scheduler.runAfter(0, internal.notify.renterChat, { email: a.email, bookingId, text: requestText });
    return { ok: true, messageId };
  },
});
