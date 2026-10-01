import { query, mutation, internalQuery, internalMutation } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import { assertAdmin, checkAdminToken } from "./adminAuth";
import { validatePushSubscription } from "./lib/adminPush";

export const device = query({
  args: { token: v.string(), deviceId: v.string() },
  handler: async (ctx, { token, deviceId }) => {
    if (!checkAdminToken(token)) throw Error("unauthorized");
    const subscription = await ctx.db.query("admin_push_subscriptions").withIndex("by_device", q => q.eq("deviceId", deviceId)).first();
    return { enabled: !!subscription?.enabled, publicKey: process.env.ADMIN_PUSH_PUBLIC_KEY ?? null,
      configured: !!process.env.ADMIN_PUSH_PUBLIC_KEY && !!process.env.ADMIN_PUSH_PRIVATE_KEY, lastError: subscription?.lastError ?? null };
  },
});
export const subscribe = mutation({
  args: { token: v.string(), deviceId: v.string(), endpoint: v.string(), p256dh: v.string(), auth: v.string() },
  handler: async (ctx, { token, deviceId, ...subscription }) => {
    await assertAdmin(ctx, token, "adminNotifications.subscribe");
    if (!/^[A-Za-z0-9_-]{8,80}$/.test(deviceId)) throw Error("Invalid device.");
    if (!process.env.ADMIN_PUSH_PRIVATE_KEY || !process.env.ADMIN_PUSH_PUBLIC_KEY) throw Error("Phone notifications are not configured.");
    validatePushSubscription(subscription.endpoint, subscription.p256dh, subscription.auth);
    const existing = await ctx.db.query("admin_push_subscriptions").withIndex("by_device", q => q.eq("deviceId", deviceId)).first();
    const patch = { ...subscription, enabled: true, updatedAt: Math.max(Date.now(), (existing?.updatedAt ?? 0) + 1), lastError: undefined };
    if (existing) await ctx.db.patch(existing._id, patch);
    else await ctx.db.insert("admin_push_subscriptions", { ...patch, deviceId, createdAt: Date.now() });
    return { enabled: true };
  },
});
export const disable = mutation({
  args: { token: v.string(), deviceId: v.string() },
  handler: async (ctx, { token, deviceId }) => {
    await assertAdmin(ctx, token, "adminNotifications.disable");
    const existing = await ctx.db.query("admin_push_subscriptions").withIndex("by_device", q => q.eq("deviceId", deviceId)).first();
    if (existing) await ctx.db.patch(existing._id, { enabled: false, updatedAt: Date.now() });
  },
});
export const latest = query({
  args: { token: v.string() },
  handler: async (ctx, { token }) => {
    if (!checkAdminToken(token)) return [];
    const notifications = await ctx.db.query("admin_notifications").withIndex("by_read_created", q => q.eq("read", false)).order("desc").take(30);
    return Promise.all(notifications.map(async n => {
      const b = n.bookingId ? await ctx.db.get(n.bookingId) : null;
      const account = await ctx.db.get(n.accountId);
      return { ...n, rentalStage: b?.status ?? "general", renterName: account?.name?.split(/\s+/)[0] ?? "Renter" };
    }));
  },
});
export const acknowledge = mutation({
  args: { token: v.string(), id: v.id("admin_notifications") },
  handler: async (ctx, { token, id }) => { await assertAdmin(ctx, token, "adminNotifications.acknowledge"); await ctx.db.patch(id, { read: true }); },
});
export const claim = internalMutation({
  args: { deliveryId: v.id("admin_push_deliveries"), claimId: v.string() },
  handler: async (ctx, { deliveryId, claimId }) => {
    const delivery = await ctx.db.get(deliveryId);
    if (!delivery || ["sent", "skipped", "permanent_failure"].includes(delivery.status) || delivery.nextAttemptAt > Date.now() ||
      delivery.status === "delivering" && (delivery.claimedAt ?? 0) > Date.now() - 120000) return null;
    const subscription = await ctx.db.get(delivery.subscriptionId);
    const notification = await ctx.db.get(delivery.notificationId);
    if (!subscription?.enabled || !notification || notification.read || Date.now() - notification.createdAt > 86400000) {
      await ctx.db.patch(deliveryId, { status: "skipped", updatedAt: Date.now() }); return null;
    }
    await ctx.db.patch(deliveryId, { status: "delivering", claimId, claimedAt: Date.now(), attempts: delivery.attempts + 1, updatedAt: Date.now(), subscriptionUpdatedAt: subscription.updatedAt });
    return { subscription, notification, attempts: delivery.attempts + 1 };
  },
});
export const finish = internalMutation({
  args: { deliveryId: v.id("admin_push_deliveries"), claimId: v.string(), sent: v.boolean(), expired: v.boolean(), error: v.optional(v.string()) },
  handler: async (ctx, { deliveryId, claimId, sent, expired, error }) => {
    const delivery = await ctx.db.get(deliveryId);
    if (!delivery || delivery.claimId !== claimId || delivery.status !== "delivering") return;
    const retry = !sent && !expired && delivery.attempts < 5;
    const next = Date.now() + Math.min(3600000, 30000 * 2 ** delivery.attempts);
    await ctx.db.patch(deliveryId, { status: sent ? "sent" : retry ? "retry" : "permanent_failure", updatedAt: Date.now(), nextAttemptAt: next, lastError: error });
    const subscription = expired ? await ctx.db.get(delivery.subscriptionId) : null;
    if (expired && subscription?.updatedAt === delivery.subscriptionUpdatedAt)
      await ctx.db.patch(delivery.subscriptionId, { enabled: false, lastError: "Push subscription expired. Enable the bell again.", updatedAt: Date.now() });
    if (retry) await ctx.scheduler.runAfter(next - Date.now(), internal.adminPushDelivery.deliver, { deliveryId });
  },
});
export const due = internalQuery({
  args: {}, handler: async (ctx) => {
    const pages = await Promise.all(["queued", "retry", "delivering"].map(status => ctx.db.query("admin_push_deliveries")
      .withIndex("by_status_due", q => q.eq("status", status).lte("nextAttemptAt", Date.now())).take(20)));
    return pages.flat().map(row => row._id);
  },
});
