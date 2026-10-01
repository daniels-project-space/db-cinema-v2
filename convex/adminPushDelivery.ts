"use node";
import webpush from "web-push";
import { randomUUID, createHash } from "node:crypto";
import { internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import { validatePushSubscription } from "./lib/adminPush";

export const deliver = internalAction({
  args: { deliveryId: v.id("admin_push_deliveries") },
  handler: async (ctx, { deliveryId }) => {
    const claimId = randomUUID();
    const data = await ctx.runMutation(internal.adminNotifications.claim, { deliveryId, claimId });
    if (!data) return;
    let sent = false, expired = false, error: string | undefined;
    try {
      const subscription = data.subscription;
      validatePushSubscription(subscription.endpoint, subscription.p256dh, subscription.auth);
      const publicKey = process.env.ADMIN_PUSH_PUBLIC_KEY, privateKey = process.env.ADMIN_PUSH_PRIVATE_KEY;
      if (!publicKey || !privateKey) throw Error("Push configuration missing.");
      const notification = data.notification;
      const url = `/admin${notification.bookingId ? `?rental=${encodeURIComponent(notification.bookingId)}` : ""}#messages`;
      await webpush.sendNotification({ endpoint: subscription.endpoint, keys: { p256dh: subscription.p256dh, auth: subscription.auth } },
        JSON.stringify({ title: notification.title, body: notification.body, url, tag: notification.eventKey }),
        { vapidDetails: { subject: "https://dbcinemarentals.com", publicKey, privateKey }, TTL: 300, timeout: 10000,
          urgency: "high", topic: createHash("sha256").update(notification.eventKey).digest("hex").slice(0,32) });
      sent = true;
    } catch (failure: any) {
      expired = [404,410].includes(failure.statusCode);
      error = expired ? "Subscription expired" : `Push delivery failed${failure.statusCode ? ` (${failure.statusCode})` : ""}`;
    }
    await ctx.runMutation(internal.adminNotifications.finish, { deliveryId, claimId, sent, expired, error });
  },
});
export const retryDue = internalAction({
  args: {}, handler: async (ctx) => { const due = await ctx.runQuery(internal.adminNotifications.due, {}); for (const deliveryId of due) await ctx.scheduler.runAfter(0, internal.adminPushDelivery.deliver, { deliveryId }); },
});
