import { internal } from "../_generated/api";

export const RENTER_PUSH_NOTICES = [
  "chat_message",
  "support_reply",
  "verification_progress",
  "verification_approved",
  "verification_review",
  "verification_action",
  "rental_action",
  "rental_update",
  "delivery_quote",
  "extension_options",
  "extension_payment",
  "kit_change",
  "rental_price",
  "credit_offer",
  "payment_link",
  "gear_recommendation",
  "checkout_kit",
  "review_invitation",
] as const;

export type RenterPushNotice = typeof RENTER_PUSH_NOTICES[number];

export function renterPushNotice(sender: string, bookingId: unknown, meta: any = undefined): RenterPushNotice {
  if (sender === "owner") return bookingId ? "chat_message" : "support_reply";

  const kind = typeof meta?.kind === "string" ? meta.kind : "";
  const type = typeof meta?.type === "string" ? meta.type : "";

  const hasExtensionOffer = meta?.extensionOffer && typeof meta.extensionOffer === "object" &&
    [meta.extensionOffer.items, meta.extensionOffer.availableItems, meta.extensionOffer.unavailableItems]
      .some((items: unknown) => Array.isArray(items) && items.length > 0);
  const hasCheckoutCart = kind === "checkout_cart" && typeof meta?.path === "string" &&
    /^\/cart\/quote\/[A-Za-z0-9_-]{43}$/.test(meta.path) && Array.isArray(meta?.items) && meta.items.length > 0;
  const hasCatalogueCards = Array.isArray(meta?.catalogueItems) && meta.catalogueItems.length > 0;

  if (sender === "bot") {
    if (hasExtensionOffer) return "extension_options";
    if (hasCheckoutCart) return "checkout_kit";
    if (hasCatalogueCards) return "gear_recommendation";
  }

  if (!bookingId) return "support_reply";
  if (kind === "verification_update") {
    if (meta?.status === "verified") return "verification_approved";
    if (meta?.status === "manual_review") return "verification_review";
    if (meta?.status === "requires_input" || meta?.status === "rejected") return "verification_action";
    return "verification_progress";
  }
  if (kind === "review_invitation") return "review_invitation";
  if (kind === "delivery_quote") return "delivery_quote";
  if (kind === "late_extension_offer") return "extension_options";
  if (kind === "extension_payment") return "extension_payment";
  if (kind === "rental_item_swap" || type === "rental_item_swap") return "kit_change";
  if (kind === "rental_price_proposal" || type === "rental_price_proposal") return "rental_price";
  if (kind === "full_credit_offer") return "credit_offer";
  if (kind === "paylink") return "payment_link";
  if (type === "rental_change_decision") return "rental_update";
  if (["delivery_quote_declined", "delivery_paid", "rental_item_swap_unavailable"].includes(kind)) return "rental_update";
  if (sender === "bot") return "chat_message";
  return "rental_update";
}

export function renterPushKeys() {
  return process.env.RENTER_PUSH_PUBLIC_KEY || process.env.RENTER_PUSH_PRIVATE_KEY
    ? {publicKey:process.env.RENTER_PUSH_PUBLIC_KEY,privateKey:process.env.RENTER_PUSH_PRIVATE_KEY}
    : {publicKey:process.env.ADMIN_PUSH_PUBLIC_KEY,privateKey:process.env.ADMIN_PUSH_PRIVATE_KEY};
}

/** Generic lock-screen text: private chat/document/settlement contents stay in the account. */
export async function queueRenterNotification(ctx: any, args: {
  eventKey: string; kind: "messages" | "booking"; notice?: RenterPushNotice; accountId: any; bookingId?: any; messageAt: number;
}) {
  const existing = await ctx.db.query("renter_notifications").withIndex("by_event", (q: any)=>q.eq("eventKey",args.eventKey)).first();
  if (existing) return existing._id;
  const id = await ctx.db.insert("renter_notifications", {...args, createdAt: Date.now()});
  const devices = await ctx.db.query("renter_push_subscriptions").withIndex("by_account_enabled",(q:any)=>q.eq("accountId",args.accountId).eq("enabled",true)).collect();
  for (const device of devices) {
    if (!(args.kind === "messages" ? device.messagesEnabled : device.bookingEnabled)) continue;
    const deliveryId=await ctx.db.insert("renter_push_deliveries",{notificationId:id,subscriptionId:device._id,
      subscriptionUpdatedAt:device.updatedAt,status:"queued",attempts:0,nextAttemptAt:Date.now(),updatedAt:Date.now()});
    await ctx.scheduler.runAfter(0,internal.renterPushDelivery.deliver,{deliveryId});
  }
  return id;
}
