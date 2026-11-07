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
  eventKey: string; kind: string; accountId?: any; bookingId?: any; title: string; body: string;
  income?: { gross: number; net: number; currency: string };
}) {
  const existing = await ctx.db.query("admin_notifications").withIndex("by_event", (q: any) => q.eq("eventKey", args.eventKey)).first();
  if (existing) return existing._id;
  const managerEnabled = !!process.env.RMV2_WEBHOOK_URL && !!process.env.RMV2_WEBHOOK_SECRET;
  const directTelegram = managerEnabled && ["renter_message", "human_request", "verification_archive", "verification_failure", "email_failure", "checkout_failure"].includes(args.kind);
  const id = await ctx.db.insert("admin_notifications", { ...args, createdAt: Date.now(), read: false,
    ...(managerEnabled ? { managerStatus: "queued", managerAttempts: 0, managerDueAt: Date.now() } : {}),
    ...(directTelegram ? { telegramStatus: "queued", telegramAttempts: 0, telegramDueAt: Date.now() } : {}) });
  if (managerEnabled) await ctx.scheduler.runAfter(0, internal.managerNotifications.deliver, { notificationId: id });
  if (directTelegram) await ctx.scheduler.runAfter(0, internal.ownerTelegram.deliver, { notificationId: id });
  const subscriptions = await ctx.db.query("admin_push_subscriptions").withIndex("by_enabled", (q: any) => q.eq("enabled", true)).collect();
  for (const subscription of subscriptions) {
    if (!ownerPushAllowed(subscription,args.kind)) continue;
    const deliveryId = await ctx.db.insert("admin_push_deliveries", { notificationId: id, subscriptionId: subscription._id, subscriptionUpdatedAt: subscription.updatedAt,
      status: "queued", attempts: 0, nextAttemptAt: Date.now(), updatedAt: Date.now() });
    await ctx.scheduler.runAfter(0, internal.adminPushDelivery.deliver, { deliveryId });
  }
  return id;
}
type ConversationMarker = { at: number; creationTime: number };
type ConversationBatch = { accountId: any; bookingId?: any; through: number; kind: string; cursor?: string; marker?: ConversationMarker };

export async function acknowledgeOwnerNotificationPage(ctx: any, args: ConversationBatch) {
  const { accountId, bookingId, through, kind, marker } = args;
  const result = await ctx.db.query("admin_notifications").withIndex("by_account_booking_kind_read_created", (q: any) =>
    q.eq("accountId", accountId).eq("bookingId", bookingId).eq("kind", kind).eq("read", false).lte("createdAt", through))
    .paginate({ numItems: 100, cursor: args.cursor ?? null });
  for (const notification of result.page) {
    if (marker) {
      const match = /^(?:renter-message|human-request|gaffer-resumed):([^:]+)$/.exec(notification.eventKey);
      const messageId = match ? ctx.db.normalizeId("messages", match[1]) : null;
      const message = messageId ? await ctx.db.get(messageId) : null;
      if (message && message.accountId === accountId && message.bookingId === bookingId) {
        if (message.at > marker.at || message.at === marker.at && message._creationTime > marker.creationTime) continue;
      } else if (notification.createdAt >= marker.creationTime) continue;
    }
    await ctx.db.patch(notification._id, { read: true });
  }
  if (!result.isDone) await ctx.scheduler.runAfter(0, internal.adminNotifications.acknowledgeConversationBatch, {
    accountId, ...(bookingId ? { bookingId } : {}), through, kind, cursor: result.continueCursor, ...(marker ? { marker } : {}),
  });
}

export async function acknowledgeOwnerNotifications(ctx: any, accountId: any, bookingId?: any, through = Date.now(), marker?: ConversationMarker) {
  for (const kind of ["renter_message", "human_request", "gaffer_resumed"])
    await acknowledgeOwnerNotificationPage(ctx, { accountId, bookingId, through, kind, marker });
}
