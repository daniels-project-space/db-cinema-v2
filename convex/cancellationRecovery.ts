import { internalMutation, internalQuery, query } from "./_generated/server";
import { v } from "convex/values";
import { cancellationReceipt } from "./lib/cancellationFields";
import { checkAdminToken } from "./adminAuth";
import { accountForToken, ownedBooking } from "./lib/rentalChat";

export const ownerStatus = query({ args: { token: v.string(), bookingId: v.id("bookings") }, handler: async (ctx, args) => {
  if (!checkAdminToken(args.token)) throw Error("unauthorized");
  const job = await ctx.db.query("rental_cancellations").withIndex("by_booking", q => q.eq("bookingId", args.bookingId)).unique();
  return job ? { status: job.status, refunds: job.receipts.map(r => ({ amount: r.amountPence / 100, status: r.status,
    approvalUrl: r.approvalUrl && /^https:\/\/dashboard\.stripe\.com\/(?:acct_[A-Za-z0-9]+\/)?settings\/approvals\/requests\/apreq_[A-Za-z0-9]+$/.test(r.approvalUrl) ? r.approvalUrl : null })) } : null;
}});
export const renterStatus = query({ args: { token: v.string(), bookingId: v.id("bookings") }, handler: async (ctx, args) => {
  const account = await accountForToken(ctx, args.token); if (!account) return null;
  await ownedBooking(ctx, account, args.bookingId);
  const job = await ctx.db.query("rental_cancellations").withIndex("by_booking", q => q.eq("bookingId", args.bookingId)).unique();
  return job ? { status: job.status } : null;
}});

// This ledger is private: approval IDs and provider receipts never enter renter projections.
export const claim = internalMutation({ args: { bookingId: v.id("bookings"),
  accountId: v.optional(v.id("accounts")), adminReason: v.optional(v.string()), legacy: v.boolean() },
handler: async (ctx, args) => {
  const b = await ctx.db.get(args.bookingId), now = Date.now();
  if (!b?.cancellationDecision?.quote || !["pending_payment", "confirmed"].includes(b.status)) return null;
  let job = await ctx.db.query("rental_cancellations").withIndex("by_booking", q => q.eq("bookingId", args.bookingId)).unique();
  if (job && (job.status === "succeeded" || job.leaseUntil > now)) return null;
  if (!job) {
    const quote = b.cancellationDecision.quote;
    const allocations = quote.allocations ?? (quote.paymentIntentId && quote.refundAmount > 0 ?
      [{ paymentIntentId: quote.paymentIntentId, amountPence: Math.round(quote.refundAmount * 100) }] : []);
    if (new Set(allocations.map(a => a.paymentIntentId)).size !== allocations.length ||
        allocations.some(a => !Number.isSafeInteger(a.amountPence) || a.amountPence <= 0) ||
        allocations.reduce((sum, a) => sum + a.amountPence, 0) !== Math.round(quote.refundAmount * 100))
      throw Error("Invalid frozen cancellation payment allocations.");
    const id = await ctx.db.insert("rental_cancellations", { ...args, status: "processing", generation: 1, leaseUntil: now + 120_000,
      retryAt: now + 120_000, updatedAt: now, receipts: allocations.map(a => ({ ...a,
        attemptedAt: args.legacy ? b.cancellationDecision!.createdAt : now, status: "unknown" as const })) });
    return ctx.db.get(id);
  }
  const generation = job.generation + 1;
  await ctx.db.patch(job._id, { generation, leaseUntil: now + 120_000, retryAt: now + 120_000, status: "processing", updatedAt: now });
  return { ...job, generation, leaseUntil: now + 120_000 };
}});

export const receipt = internalMutation({ args: { id: v.id("rental_cancellations"), generation: v.number(), receipt: cancellationReceipt },
handler: async (ctx, { id, generation, receipt }) => {
  const job = await ctx.db.get(id), prior = job?.receipts.find(r => r.paymentIntentId === receipt.paymentIntentId);
  if (!job || job.generation !== generation || !prior || prior.amountPence !== receipt.amountPence || prior.attemptedAt !== receipt.attemptedAt ||
      (prior.stripeRefundId && prior.stripeRefundId !== receipt.stripeRefundId) ||
      (prior.approvalRequestId && prior.approvalRequestId !== receipt.approvalRequestId)) throw Error("Refund receipt binding changed.");
  await ctx.db.patch(id, { receipts: job.receipts.map(r => r.paymentIntentId === receipt.paymentIntentId ? receipt : r), updatedAt: Date.now() });
}});

export const finishAttempt = internalMutation({ args: { id: v.id("rental_cancellations"), complete: v.boolean(), generation: v.optional(v.number()), review: v.optional(v.boolean()) },
handler: async (ctx, { id, complete, generation, review }) => {
  const job = await ctx.db.get(id); if (!job) return;
  if (generation !== undefined && job.generation !== generation) return;
  if (complete && job.receipts.some(r => r.status !== "succeeded")) throw Error("Stripe settlement is incomplete.");
  const failed = review || job.receipts.some(r => r.status === "failed");
  await ctx.db.patch(id, { status: complete ? "succeeded" : failed ? "attention" : "processing",
    leaseUntil: 0, retryAt: complete || failed ? undefined : Date.now() + 5 * 60_000, updatedAt: Date.now() });
}});

export const due = internalQuery({ args: {}, handler: async ctx => ctx.db.query("rental_cancellations")
  .withIndex("by_retry", q => q.gt("retryAt", 0).lte("retryAt", Date.now())).take(40) });
