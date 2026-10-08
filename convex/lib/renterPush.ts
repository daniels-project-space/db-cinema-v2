import { internal } from "../_generated/api";

export function renterPushKeys() {
  return process.env.RENTER_PUSH_PUBLIC_KEY || process.env.RENTER_PUSH_PRIVATE_KEY
    ? {publicKey:process.env.RENTER_PUSH_PUBLIC_KEY,privateKey:process.env.RENTER_PUSH_PRIVATE_KEY}
    : {publicKey:process.env.ADMIN_PUSH_PUBLIC_KEY,privateKey:process.env.ADMIN_PUSH_PRIVATE_KEY};
}

/** Generic lock-screen text: private chat/document/settlement contents stay in the account. */
export async function queueRenterNotification(ctx: any, args: {
  eventKey: string; kind: "messages" | "booking"; accountId: any; bookingId?: any; messageAt: number;
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
