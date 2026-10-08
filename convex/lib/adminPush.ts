import { internal } from "../_generated/api";

/** Browser-owned push services only: never send credentials to an arbitrary URL. */
export function validatePushSubscription(endpoint: string, p256dh: string, auth: string) {
  const url = new URL(endpoint);
  const host = url.hostname.toLowerCase();
  const allowed = host === "fcm.googleapis.com" || host === "jmt17.google.com" || host === "updates.push.services.mozilla.com" ||
    host === "web.push.apple.com" || host.endsWith(".push.apple.com") || host.endsWith(".notify.windows.com");
  if (!allowed || url.protocol !== "https:" || url.username || url.password || url.hash || url.port && url.port !== "443" || endpoint.length > 2048)
    throw Error("Unsupported push service.");
  if (!/^[A-Za-z0-9_-]{87}$/.test(p256dh) || !/^[A-Za-z0-9_-]{22}$/.test(auth)) throw Error("Invalid push keys.");
}

export function ownerPushAllowed(subscription: {humanRequests?:boolean;renterMessages?:boolean},kind:string) {
  return kind === "human_request" ? subscription.humanRequests !== false : kind === "renter_message" ? subscription.renterMessages !== false : true;
}

export async function queueOwnerNotification(ctx: any, args: {
  eventKey: string; kind: string; accountId: any; bookingId?: any; title: string; body: string;
}) {
  const existing = await ctx.db.query("admin_notifications").withIndex("by_event", (q: any) => q.eq("eventKey", args.eventKey)).first();
  if (existing) return existing._id;
  const id = await ctx.db.insert("admin_notifications", { ...args, createdAt: Date.now(), read: false });
  const subscriptions = await ctx.db.query("admin_push_subscriptions").withIndex("by_enabled", (q: any) => q.eq("enabled", true)).collect();
  for (const subscription of subscriptions) {
    if (!ownerPushAllowed(subscription,args.kind)) continue;
    const deliveryId = await ctx.db.insert("admin_push_deliveries", { notificationId: id, subscriptionId: subscription._id, subscriptionUpdatedAt: subscription.updatedAt,
      status: "queued", attempts: 0, nextAttemptAt: Date.now(), updatedAt: Date.now() });
    await ctx.scheduler.runAfter(0, internal.adminPushDelivery.deliver, { deliveryId });
  }
  return id;
}
export async function acknowledgeOwnerNotifications(ctx: any, accountId: any, bookingId?: any, through = Date.now()) {
  const notifications = await ctx.db.query("admin_notifications").withIndex("by_account_booking_read", (q: any) =>
    q.eq("accountId", accountId).eq("bookingId", bookingId).eq("read", false)).take(100);
  for (const notification of notifications) if (notification.createdAt <= through) await ctx.db.patch(notification._id, { read: true });
}
