import { internalAction, internalMutation, internalQuery, mutation } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import { assertAdmin } from "./adminAuth";

const MAX_ATTEMPTS = 8;
const LEASE_MS = 60_000;

export const retry = mutation({args:{token:v.string(),notificationId:v.id("admin_notifications")},handler:async(ctx,{token,notificationId})=>{
  await assertAdmin(ctx,token,"ownerTelegram.retry");
  const notification=await ctx.db.get(notificationId);
  if(!notification || notification.telegramStatus!=="review" || notification.read || Date.now()-notification.createdAt>86400000) throw Error("This alert cannot be retried.");
  await ctx.db.patch(notificationId,{telegramStatus:"queued",telegramAttempts:0,telegramDueAt:Date.now(),telegramLastError:undefined});
  await ctx.scheduler.runAfter(0,internal.ownerTelegram.deliver,{notificationId});
}});

export const claim = internalMutation({
  args: { notificationId: v.id("admin_notifications") },
  handler: async (ctx, {notificationId}) => {
    const notification = await ctx.db.get(notificationId), now = Date.now();
    if (!notification || !["queued", "sending"].includes(notification.telegramStatus ?? "") || (notification.telegramDueAt ?? 0) > now) return null;
    if (notification.read || now - notification.createdAt > 86400000) {
      await ctx.db.patch(notificationId, {telegramStatus:"skipped"});
      return null;
    }
    if ((notification.telegramAttempts ?? 0) >= MAX_ATTEMPTS) {
      await ctx.db.patch(notificationId, {telegramStatus:"review",telegramLastError:"Alert delivery exhausted retries"});
      return null;
    }
    const account = notification.accountId ? await ctx.db.get(notification.accountId) : null;
    if (notification.accountId && !account) {
      await ctx.db.patch(notificationId, {telegramStatus:"review",telegramLastError:"Account no longer exists"});
      return null;
    }
    const messageId = notification.kind === "renter_message" && notification.eventKey.startsWith("renter-message:")
      ? ctx.db.normalizeId("messages", notification.eventKey.slice("renter-message:".length)) : null;
    const message = messageId ? await ctx.db.get(messageId) : null;
    const messageText = message?.sender === "renter" && message.accountId === notification.accountId && message.bookingId === notification.bookingId ? message.text.slice(0, 1500) : null;
    const generation = (notification.telegramGeneration ?? 0) + 1;
    await ctx.db.patch(notificationId, {telegramStatus:"sending",telegramAttempts:(notification.telegramAttempts ?? 0)+1,telegramGeneration:generation,telegramDueAt:now+LEASE_MS});
    return {generation,attempts:(notification.telegramAttempts ?? 0)+1,kind:notification.kind,title:notification.title,body:notification.body,email:account?.email,bookingId:notification.bookingId,accountId:notification.accountId,messageText};
  },
});

export const finish = internalMutation({
  args: {notificationId:v.id("admin_notifications"),generation:v.number(),result:v.union(v.literal("sent"),v.literal("retry"),v.literal("review")),messageId:v.optional(v.number()),error:v.optional(v.string())},
  handler: async (ctx, args) => {
    const notification = await ctx.db.get(args.notificationId);
    if (!notification || notification.telegramStatus !== "sending" || notification.telegramGeneration !== args.generation) return false;
    const review = args.result === "review" || args.result === "retry" && (notification.telegramAttempts ?? 0) >= MAX_ATTEMPTS;
    await ctx.db.patch(notification._id, {telegramStatus:review?"review":args.result === "sent"?"sent":"queued",telegramDueAt:Date.now()+Math.min(3600000,30000*2**Math.min(notification.telegramAttempts ?? 1,7)),telegramLastError:args.error,telegramMessageId:args.messageId});
    return true;
  },
});

export const deliver = internalAction({
  args: {notificationId:v.id("admin_notifications")},
  handler: async (ctx, args) => {
    const claimed = await ctx.runMutation(internal.ownerTelegram.claim, args);
    if (!claimed) return;
    let result: "sent"|"retry"|"review" = "retry", error: string|undefined, messageId: number|undefined;
    try {
      const token = process.env.TELEGRAM_BOT_TOKEN, chat = process.env.TELEGRAM_ADMIN_CHAT_ID;
      if (!token || !chat) { result="review"; error="Telegram alert configuration is missing"; }
      else {
        const origin = new URL(process.env.APP_URL ?? "https://dbcinemarentals.com").origin;
        const link = claimed.bookingId ? `${origin}/admin?rental=${claimed.bookingId}#messages` : claimed.accountId ? `${origin}/admin?account=${claimed.accountId}#messages` : `${origin}/admin`;
        const text = [claimed.title, claimed.email, claimed.messageText ?? claimed.body, `Open conversation: ${link}`].filter(Boolean).join("\n\n");
        const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({chat_id:chat,text}),signal:AbortSignal.timeout(20000)});
        if (response.ok) {
          const receipt = await response.json();
          if (receipt?.ok === true && Number.isSafeInteger(receipt?.result?.message_id)) {result="sent";messageId=receipt.result.message_id;}
          else {result="review";error="Telegram returned an invalid receipt";}
        } else {result=response.status === 429 || response.status >= 500 ? "retry" : "review";error=`Telegram HTTP ${response.status}`;}
      }
    } catch { error="Telegram delivery transport failed"; }
    await ctx.runMutation(internal.ownerTelegram.finish, {...args,generation:claimed.generation,result,...(error?{error}:{}),...(messageId===undefined?{}:{messageId})});
  },
});

export const due = internalQuery({args:{},handler:async ctx=>{
  const batches=await Promise.all(["queued","sending"].map(status=>ctx.db.query("admin_notifications").withIndex("by_telegram_due",q=>q.eq("telegramStatus",status).lte("telegramDueAt",Date.now())).take(20)));
  return batches.flat().map(notification=>notification._id);
}});
export const retryDue = internalAction({args:{},handler:async ctx=>{
  const ids=await ctx.runQuery(internal.ownerTelegram.due,{});
  for(const notificationId of ids) await ctx.runAction(internal.ownerTelegram.deliver,{notificationId});
}});
