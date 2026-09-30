import { rentalPaymentSources } from "./lib/rentalPaymentSources";
import {
  mutation,
  query,
  internalMutation,
  internalQuery,
} from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import { assertAdmin, checkAdminToken } from "./adminAuth";
import { assertRentalInventory } from "./lib/rentalInventory";
import { postRentalMessage } from "./lib/rentalChat";
import { cancelKind, londonStartOfDay } from "../src/lib/cancellationPolicy";

export const details = query({
  args: { token: v.string(), bookingId: v.id("bookings") },
  handler: async (ctx, { token, bookingId }) => {
    if (!checkAdminToken(token)) return null;
    const b = await ctx.db.get(bookingId);
    if (!b) return null;
    const refunds = await ctx.db
      .query("rental_refunds")
      .withIndex("by_booking", (q) => q.eq("bookingId", bookingId))
      .collect();
    return {
      ...b,
      rentalRefunds: refunds,
      cancellationKind: cancelKind(
        Math.min(...b.lineItems.map((li) => li.start)),
        Date.now(),
      ),
    };
  },
});
export const reschedule = mutation({
  args: {
    token: v.string(),
    bookingId: v.id("bookings"),
    start: v.number(),
    reason: v.string(),
  },
  handler: async (ctx, { token, bookingId, start, reason }) => {
    await assertAdmin(ctx, token, "rentalOperations.reschedule");
    const b = await ctx.db.get(bookingId);
    if (!b || b.status !== "confirmed")
      throw Error("Only an upcoming rental can be rescheduled");
    if (b.cancellationDecision || b.activeAdditionId || b.returnDecision)
      throw Error("Finish the open cancellation or item addition first");
    if (reason.trim().length < 5)
      throw Error("Record the reason for the change");
    if (
      !Number.isSafeInteger(start) ||
      start % 86400000 !== 0 ||
      start < londonStartOfDay(Date.now())
    )
      throw Error("Choose a future start date");
    const reservations = await ctx.db
      .query("reservations")
      .withIndex("by_booking", (q) => q.eq("bookingId", bookingId))
      .collect();
    if (reservations.some((r) => r.source !== "site"))
      throw Error("Manage this rental through its original booking platform");
    const previous = Math.min(...b.lineItems.map((li) => li.start));
    const shift = start - previous;
    const lines = b.lineItems.map((li) => ({
      ...li,
      start: li.start + shift,
      end: li.end + shift,
    }));
    await assertRentalInventory(ctx, lines, bookingId);
    await ctx.db.patch(bookingId, { lineItems: lines });
    for (const r of reservations)
      if (["confirmed", "hold"].includes(r.status))
        await ctx.db.patch(r._id, {
          start: r.start + shift,
          end: r.end + shift,
        });
    const a = await ctx.db
      .query("accounts")
      .withIndex("by_email", (q) =>
        q.eq("email", (b.guestEmail ?? "").trim().toLowerCase()),
      )
      .first();
    const detail = `${new Date(start).toISOString().slice(0, 10)} → ${new Date(Math.max(...lines.map((li) => li.end))).toISOString().slice(0, 10)}`;
    if (a)
      await postRentalMessage(ctx, {
        accountId: a._id,
        bookingId,
        sender: "system",
        text: `The team rescheduled your rental to ${detail}. Duration and agreed price are unchanged. ${reason.trim()}`,
      });
    await ctx.scheduler.runAfter(0, internal.notify.changeEmail, {
      bookingId,
      kind: "rescheduled",
      detail,
    });
    await ctx.scheduler.runAfter(0, internal.rmv2_webhook.push, { bookingId });
    return { ok: true };
  },
});

export const prepareRefund = internalMutation({
  args: {
    token: v.string(),
    bookingId: v.id("bookings"),
    requestId: v.string(),
    amountPence: v.optional(v.number()),
    reason: v.string(),
  },
  handler: async (
    ctx,
    { token, bookingId, requestId, amountPence, reason },
  ) => {
    await assertAdmin(ctx, token, "rentalOperations.refund");
    if (!/^[a-zA-Z0-9-]{16,80}$/.test(requestId))
      throw Error("Invalid refund request");
    const prior = await ctx.db
      .query("rental_refunds")
      .withIndex("by_request", (q) => q.eq("requestId", requestId))
      .first();
    if (prior) {
      if (prior.bookingId !== bookingId)
        throw Error("Refund request belongs to another rental");
      return prior;
    }
    const b = await ctx.db.get(bookingId);
    if (!b || b.status !== "confirmed" || !b.stripePaymentIntentId)
      throw Error("Only a paid upcoming rental can receive a rental refund");
    if (b.cancellationDecision || b.activeAdditionId || b.returnDecision)
      throw Error("Finish the open cancellation or item addition first");
    if (
      cancelKind(Math.min(...b.lineItems.map((li) => li.start)), Date.now()) !==
      "full_refund"
    )
      throw Error(
        "The rental cash refund window has closed. Cancel to issue account credit instead. Security payment is settled separately on return or cancellation.",
      );
    if (reason.trim().length < 5) throw Error("Record the refund reason");
    const previous = await ctx.db
      .query("rental_refunds")
      .withIndex("by_booking", (q) => q.eq("bookingId", bookingId))
      .collect();
    if (previous.some((r) => r.status === "prepared" || r.status === "pending"))
      throw Error(
        "A refund is still processing. Wait for its bank result before another refund or cancellation.",
      );
    const remaining = Math.max(
      0,
      Math.round((b.total - b.depositAmount) * 100) -
        previous.reduce(
          (sum, r) =>
            sum +
            (r.parts
              ? r.parts
                  .filter((p) => p.status === "succeeded")
                  .reduce((n, p) => n + p.amountPence, 0)
              : r.status === "succeeded"
                ? r.amountPence
                : 0),
          0,
        ),
    );
    const amount = amountPence ?? remaining;
    if (!Number.isSafeInteger(amount) || amount <= 0 || amount > remaining)
      throw Error("Refund must be within the remaining rental payment");
    const id = await ctx.db.insert("rental_refunds", {
      bookingId,
      requestId,
      amountPence: amount,
      reason: reason.trim().slice(0, 400),
      status: "prepared",
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    return (await ctx.db.get(id))!;
  },
});
export const refundContext = internalQuery({
  args: { bookingId: v.id("bookings") },
  handler: async (ctx, { bookingId }) => ctx.db.get(bookingId),
});
export const recordRefund = internalMutation({
  args: {
    id: v.id("rental_refunds"),
    stripeRefundId: v.string(),
    status: v.union(
      v.literal("pending"),
      v.literal("succeeded"),
      v.literal("failed"),
    ),
  },
  handler: async (ctx, { id, stripeRefundId, status }) => {
    const r = await ctx.db.get(id);
    if (!r) return;
    if (
      r.status === "succeeded" ||
      (r.status === status && r.stripeRefundId === stripeRefundId)
    )
      return;
    if (r.stripeRefundId && r.stripeRefundId !== stripeRefundId)
      throw Error("Refund identity mismatch");
    await ctx.db.patch(id, { stripeRefundId, status, updatedAt: Date.now() });
    const b = await ctx.db.get(r.bookingId);
    if (!b) return;
    const a = await ctx.db
      .query("accounts")
      .withIndex("by_email", (q) =>
        q.eq("email", (b.guestEmail ?? "").trim().toLowerCase()),
      )
      .first();
    if (a)
      await postRentalMessage(ctx, {
        accountId: a._id,
        bookingId: b._id,
        sender: "system",
        text: `Rental refund £${(r.amountPence / 100).toFixed(2)}: ${status === "succeeded" ? "confirmed by the payment provider" : status === "failed" ? "failed; the team is checking it" : "processing with the payment provider"}. ${r.reason}`,
      });
    await ctx.scheduler.runAfter(0, internal.notify.changeEmail, {
      bookingId: b._id,
      kind: "rental refund",
      detail: `£${(r.amountPence / 100).toFixed(2)} · ${status}. ${r.reason}`,
    });
  },
});

export const paymentSources = internalQuery({
  args: { bookingId: v.id("bookings") },
  handler: async (ctx, { bookingId }) => {
    const b = await ctx.db.get(bookingId);
    return b ? await rentalPaymentSources(ctx, b) : [];
  },
});
export const bindRefundAllocations = internalMutation({
  args: {
    id: v.id("rental_refunds"),
    allocations: v.array(
      v.object({ paymentIntentId: v.string(), amountPence: v.number() }),
    ),
  },
  handler: async (ctx, { id, allocations }) => {
    const r = await ctx.db.get(id);
    if (!r) throw Error("Refund missing");
    if (r.allocations) return r.allocations;
    if (
      new Set(allocations.map((p) => p.paymentIntentId)).size !==
        allocations.length ||
      allocations.some(
        (p) => !Number.isSafeInteger(p.amountPence) || p.amountPence <= 0,
      ) ||
      allocations.reduce((sum, p) => sum + p.amountPence, 0) !== r.amountPence
    )
      throw Error("Invalid refund allocation");
    await ctx.db.patch(id, { allocations });
    return allocations;
  },
});
export const recordRefundPart = internalMutation({
  args: {
    id: v.id("rental_refunds"),
    paymentIntentId: v.string(),
    stripeRefundId: v.string(),
    status: v.string(),
  },
  handler: async (ctx, { id, paymentIntentId, stripeRefundId, status }) => {
    const r = await ctx.db.get(id);
    if (!r) return;
    const allocation = r.allocations?.find(
      (p) => p.paymentIntentId === paymentIntentId,
    );
    if (!allocation) throw Error("Unknown refund payment source");
    const existing = r.parts?.find(
      (p) => p.paymentIntentId === paymentIntentId,
    );
    if (existing?.status === "succeeded") return;
    if (existing && existing.stripeRefundId !== stripeRefundId)
      throw Error("Refund identity mismatch");
    const parts = [
      ...(r.parts ?? []).filter((p) => p.paymentIntentId !== paymentIntentId),
      {
        paymentIntentId,
        stripeRefundId,
        status,
        amountPence: allocation.amountPence,
      },
    ];
    const aggregate =
      parts.length !== r.allocations!.length
        ? "prepared"
        : parts.every((p) => p.status === "succeeded")
          ? "succeeded"
          : parts.some((p) => p.status === "pending")
            ? "pending"
            : "failed";
    await ctx.db.patch(id, { parts, status: aggregate, updatedAt: Date.now() });
    if (aggregate !== "prepared" && aggregate !== r.status) {
      const b = await ctx.db.get(r.bookingId);
      if (!b) return;
      const a = await ctx.db
        .query("accounts")
        .withIndex("by_email", (q) =>
          q.eq("email", (b.guestEmail ?? "").trim().toLowerCase()),
        )
        .first();
      if (a)
        await postRentalMessage(ctx, {
          accountId: a._id,
          bookingId: b._id,
          sender: "system",
          text: `Rental refund £${(r.amountPence / 100).toFixed(2)}: ${aggregate}. ${r.reason}`,
        });
      await ctx.scheduler.runAfter(0, internal.notify.changeEmail, {
        bookingId: b._id,
        kind: "rental refund",
        detail: `£${(r.amountPence / 100).toFixed(2)} · ${aggregate}. ${r.reason}`,
      });
    }
  },
});
