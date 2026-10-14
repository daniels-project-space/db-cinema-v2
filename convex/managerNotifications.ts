import { internalAction, internalMutation, internalQuery } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";

const LEASE_MS = 60_000;
const MAX_ATTEMPTS = 3;
export const claim = internalMutation({
  args: { notificationId: v.id("admin_notifications") },
  handler: async (ctx, { notificationId }) => {
    const n = await ctx.db.get(notificationId), now = Date.now();
    if (!n || !["queued", "sending"].includes(n.managerStatus ?? "") || (n.managerDueAt ?? 0) > now) return null;
    if ((n.managerAttempts ?? 0) >= MAX_ATTEMPTS) { await ctx.db.patch(n._id, { managerStatus: "review" }); return null; }
    const generation = (n.managerGeneration ?? 0) + 1;
    let payload = n.managerPayload;
    if (!payload) {
      const account = await ctx.db.get(n.accountId);
      if (!account) { await ctx.db.patch(n._id, { managerStatus: "review", managerLastError: "Account no longer exists" }); return null; }
      payload = JSON.stringify({ version: 1, eventKey: n.eventKey, kind: n.kind,
        conversationId: n.bookingId ?? `support:${n.accountId}`, createdAt: n.createdAt,
        title: n.title, body: n.body, renterName: account.name ?? "Renter", income: n.income });
    }
    await ctx.db.patch(n._id, { managerStatus: "sending", managerAttempts: (n.managerAttempts ?? 0) + 1,
      managerGeneration: generation, managerDueAt: now + LEASE_MS, managerPayload: payload });
    return { generation, payload };
  },
});
export const finish = internalMutation({
  args: { notificationId: v.id("admin_notifications"), generation: v.number(), result: v.union(v.literal("sent"), v.literal("retry"), v.literal("review")), error: v.optional(v.string()) },
  handler: async (ctx, a) => {
    const n = await ctx.db.get(a.notificationId);
    if (!n || n.managerStatus !== "sending" || n.managerGeneration !== a.generation) return false;
    const review = a.result === "review" || a.result === "retry" && (n.managerAttempts ?? 0) >= MAX_ATTEMPTS;
    await ctx.db.patch(n._id, { managerStatus: review ? "review" : a.result === "sent" ? "sent" : "queued",
      managerDueAt: Date.now() + 30_000 * 2 ** (n.managerAttempts ?? 1), managerLastError: a.error });
    return true;
  },
});
export const deliver = internalAction({
  args: { notificationId: v.id("admin_notifications") },
  handler: async (ctx, a) => {
    if(process.env.RMV2_OUTBOUND_ENABLED==="false")return;
    const claimed = await ctx.runMutation(internal.managerNotifications.claim, a);
    if (!claimed) return;
    let result: "sent" | "retry" | "review" = "retry", error: string | undefined;
    try {
      const base = process.env.RMV2_WEBHOOK_URL ?? "", secret = process.env.RMV2_WEBHOOK_SECRET;
      if (!secret || !/^https:\/\/[^/]+\/dbcinema\/booking-sync\/?$/.test(base)) { result = "review"; error = "Manager bridge configuration needs review"; }
      else {
        const response = await fetch(base.replace(/booking-sync\/?$/, "notifications"), { method: "POST",
          headers: { "content-type": "application/json", "x-dbcinema-sync-token": secret }, body: claimed.payload,
          signal: AbortSignal.timeout(20_000) });
        if (response.ok) {
          const receipt = await response.json();
          result = receipt.ok === true && receipt.version === 1 && receipt.eventKey === JSON.parse(claimed.payload).eventKey ? "sent" : "review";
          if (result === "review") error = "Manager returned an invalid receipt";
        } else { result = response.status >= 500 || response.status === 429 ? "retry" : "review"; error = `Manager HTTP ${response.status}`; }
      }
    } catch { error = "Manager delivery transport failed"; }
    await ctx.runMutation(internal.managerNotifications.finish, { ...a, generation: claimed.generation, result, error });
  },
});
export const due = internalQuery({ args: {}, handler: async ctx => {
  const batches = await Promise.all(["queued", "sending"].map(status => ctx.db.query("admin_notifications")
    .withIndex("by_manager_due", q => q.eq("managerStatus", status).lte("managerDueAt", Date.now())).take(20)));
  return batches.flat().map(n => n._id);
} });
export const retryDue = internalAction({ args: {}, handler: async ctx => {
  const ids = await ctx.runQuery(internal.managerNotifications.due, {});
  for (const notificationId of ids) await ctx.runAction(internal.managerNotifications.deliver, { notificationId });
} });
