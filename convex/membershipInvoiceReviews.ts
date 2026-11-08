import { internalMutation, internalQuery, mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { queueOwnerNotification } from "./lib/adminPush";
import { assertAdmin, checkAdminToken } from "./adminAuth";
import { adminSessionMigrationReady, assertAdminScopeSession } from "./adminAccountSessionV2";

export const recordCheckoutFailure = internalMutation({
  args: { bookingId: v.id("bookings"), sessionId: v.string() },
  handler: async (ctx, { bookingId, sessionId }) => {
    const booking = await ctx.db.get(bookingId);
    if (!booking || booking.stripeCheckoutSessionId !== sessionId || !booking.membershipCheckoutId) throw Error("Membership checkout no longer matches this rental.");
    await queueOwnerNotification(ctx, { eventKey: `membership_checkout_failure:${sessionId}`, kind: "membership_invoice_review", bookingId, accountId: booking.accountId, title: "Subscription checkout needs review", body: "A rental's subscription could not be reconciled after automatic retries. Review its billing in Stripe." });
  },
});

export const record = internalMutation({
  args: { accountId: v.id("accounts"), subscriptionId: v.string(), invoiceId: v.string(), reason: v.string() },
  handler: async (ctx, args) => {
    if (!/^sub_[A-Za-z0-9]+$/.test(args.subscriptionId) || !/^in_[A-Za-z0-9]+$/.test(args.invoiceId) || !/^[a-z_]{1,64}$/.test(args.reason)) throw Error("Invalid membership invoice review.");
    const account = await ctx.db.get(args.accountId);
    if (!account || account.stripeSubscriptionId !== args.subscriptionId) throw Error("Membership invoice account changed.");
    const existing = await ctx.db.query("membership_invoice_reviews").withIndex("by_invoice", q => q.eq("invoiceId", args.invoiceId)).unique();
    if (existing && (existing.accountId !== args.accountId || existing.subscriptionId !== args.subscriptionId)) throw Error("Membership invoice review ownership mismatch.");
    const now = Date.now();
    if (existing?.state === "resolved" && args.reason !== "processing_error") return existing._id;
    const generation = existing?.state === "resolved" ? (existing.generation ?? 0) + 1 : existing?.generation ?? 0;
    const id = existing?._id ?? await ctx.db.insert("membership_invoice_reviews", { ...args, state: "review", createdAt: now, updatedAt: now });
    if (existing) await ctx.db.patch(existing._id, { reason: args.reason, state: "review", resolvedAt: undefined, generation, updatedAt: now, autoFailures: args.reason === "processing_error" ? Math.min((existing.state === "resolved" ? 0 : existing.autoFailures ?? 0) + 1, 3) : existing.autoFailures });
    else if (args.reason === "processing_error") await ctx.db.patch(id, { autoFailures: 1 });
    await queueOwnerNotification(ctx, { eventKey: `membership_invoice_review:${args.invoiceId}:${generation}`, kind: "membership_invoice_review", accountId: args.accountId, title: "Subscription credit needs review", body: "A paid subscription invoice needs a billing or credit reconciliation check." });
    return id;
  },
});

export const resolve = internalMutation({
  args: { accountId: v.id("accounts"), subscriptionId: v.string(), invoiceId: v.string() },
  handler: async (ctx, args) => {
    const row = await ctx.db.query("membership_invoice_reviews").withIndex("by_invoice", q => q.eq("invoiceId", args.invoiceId)).unique();
    if (!row) return;
    if (row.accountId !== args.accountId || row.subscriptionId !== args.subscriptionId) throw Error("Membership invoice review ownership mismatch.");
    const receipt = await ctx.db.query("membership_credit_grants").withIndex("by_invoice", q => q.eq("invoiceId", args.invoiceId)).unique();
    if (!receipt || receipt.accountId !== args.accountId || receipt.subscriptionId !== args.subscriptionId) throw Error("A matching issued credit receipt is required.");
    if (row.state === "resolved") return;
    const now = Date.now();
    await ctx.db.patch(row._id, { state: "resolved", updatedAt: now, resolvedAt: now });
  },
});

export const forAccount = internalQuery({
  args: { accountId: v.id("accounts") },
  handler: (ctx, args) => ctx.db.query("membership_invoice_reviews").withIndex("by_account_state", q => q.eq("accountId", args.accountId).eq("state", "review")).take(30),
});

export const byInvoice = internalQuery({
  args: { accountId: v.id("accounts"), invoiceId: v.string() },
  handler: async (ctx, args) => {
    const row = await ctx.db.query("membership_invoice_reviews").withIndex("by_invoice", q => q.eq("invoiceId", args.invoiceId)).unique();
    if (!row || row.accountId !== args.accountId) throw Error("This invoice review is unavailable.");
    return { state: row.state };
  },
});

export const mayProcess = internalQuery({
  args: { accountId: v.id("accounts"), subscriptionId: v.string(), invoiceId: v.string() },
  handler: async (ctx, args) => {
    const row = await ctx.db.query("membership_invoice_reviews").withIndex("by_invoice", q => q.eq("invoiceId", args.invoiceId)).unique();
    if (!row) return true;
    if (row.accountId !== args.accountId || row.subscriptionId !== args.subscriptionId) throw Error("Membership invoice review ownership mismatch.");
    return row.state === "resolved" || row.reason === "processing_error" && (row.autoFailures ?? 0) < 3;
  },
});

export const adminList = query({
  args: { token: v.string(), accountId: v.id("accounts") },
  handler: async (ctx, args) => {
    if (process.env.ADMIN_SESSION_BILLING_PORTAL_V2 === "enabled") {
      if (!adminSessionMigrationReady()) throw Error("Admin session migration is not ready.");
      await assertAdminScopeSession(ctx, args.token, "payments:write");
    } else if (!await checkAdminToken(args.token)) throw Error("unauthorized");
    const rows = await ctx.db.query("membership_invoice_reviews").withIndex("by_account_state", q => q.eq("accountId", args.accountId).eq("state", "review")).take(30);
    return rows.map(row => ({ invoiceId: row.invoiceId, reason: row.reason, createdAt: row.createdAt, retryAt: row.retryAt ?? null }));
  },
});

export const adminReserveRetry = mutation({
  args: { token: v.string(), accountId: v.id("accounts"), subscriptionId: v.string(), invoiceId: v.string() },
  handler: async (ctx, args) => {
    if (process.env.ADMIN_SESSION_BILLING_PORTAL_V2 === "enabled") {
      if (!adminSessionMigrationReady()) throw Error("Admin session migration is not ready.");
      await assertAdminScopeSession(ctx, args.token, "payments:write");
      await ctx.db.insert("admin_audit_log", { at: Date.now(), success: true, limited: false, fn: "membershipInvoiceReviews.adminReserveRetry" });
    } else await assertAdmin(ctx, args.token, "membershipInvoiceReviews.adminReserveRetry");
    const row = await ctx.db.query("membership_invoice_reviews").withIndex("by_invoice", q => q.eq("invoiceId", args.invoiceId)).unique();
    if (!row || row.state !== "review" || row.accountId !== args.accountId || row.subscriptionId !== args.subscriptionId) throw Error("This invoice review is unavailable.");
    const account = await ctx.db.get(args.accountId);
    if (!account || account.stripeSubscriptionId !== args.subscriptionId) throw Error("The billing link changed.");
    const now = Date.now();
    const windowAt = row.retryWindowAt && now - row.retryWindowAt < 86400000 ? row.retryWindowAt : now;
    const count = windowAt === row.retryWindowAt ? row.retryCount ?? 0 : 0;
    if (count >= 5 || row.retryAt && now - row.retryAt < 60000) throw Error("Please wait before retrying this invoice.");
    await ctx.db.patch(row._id, { retryWindowAt: windowAt, retryCount: count + 1, retryAt: now, updatedAt: now });
  },
});
