import { accountForToken, ownedBooking, rentalThread, postRentalMessage } from "./lib/rentalChat";
import { cancelKind } from "../src/lib/cancellationPolicy";
import { contentsText } from "../shared/rentalContents";
import { query, mutation, internalQuery, internalMutation, internalAction } from "./_generated/server";
import { internal, api } from "./_generated/api";
import { v } from "convex/values";
import { queueOwnerNotification } from "./lib/adminPush";
import type { Id } from "./_generated/dataModel";

const ADDON_CUTOFF_MS = 60 * 60 * 1000; // no add-ons within 1h of rental start

function botOk(token: string) {
  return !!process.env.BOT_TOKEN && token === process.env.BOT_TOKEN;
}
const acctByToken = accountForToken;

/** Renter's own message thread (reactive → live). */
export const myThread = query({
  args: { token: v.string() },
  handler: async (ctx, { token }) => {
    const a: any = await acctByToken(ctx, token);
    if (!a) return null;
    const msgs = await ctx.db
      .query("messages")
      .withIndex("by_account_at", (q) => q.eq("accountId", a._id))
      .filter(q=>q.eq(q.field("bookingId"),undefined))
      .order("desc").take(100);
    return msgs
      .sort((x, y) => x.at - y.at)
      .map((m) => ({ _id: m._id, sender: m.sender, text: m.text, meta: m.meta ?? null, at: m.at }));
  },
});

/** Renter sends a message → stored + forwarded to the bot (Telegram). */
export const send = mutation({
  args: { token: v.string(), text: v.string(), bookingId: v.optional(v.id("bookings")) },
  handler: async (ctx, { token, text, bookingId }) => {
    const a: any = await acctByToken(ctx, token);
    if (!a) throw new Error("unauthorized");
    if (bookingId) await ownedBooking(ctx,a,bookingId);
    const t = text.trim();
    if (!t) return;
    if (t.length > 2000) throw new Error("That message is too long — please shorten it.");
    // rate limit: cap renter messages per account so a (leaked) token can't flood the owner's
    // Telegram. ~6 messages / 30s is plenty for a human conversation.
    const WINDOW_MS = 30_000, MAX_IN_WINDOW = 6;
    const recent = (
      await ctx.db.query("messages").withIndex("by_account_at", (q) => q.eq("accountId", a._id).gte("at",Date.now()-WINDOW_MS)).take(30)
    ).filter((m) => m.sender === "renter" && m.at > Date.now() - WINDOW_MS);
    if (recent.length >= MAX_IN_WINDOW)
      throw new Error("You're sending messages a little too fast — give us a moment to catch up.");
    const messageId = await postRentalMessage(ctx,{accountId:a._id,bookingId,sender:"renter",text:t});
    const thread = await rentalThread(ctx,a._id,bookingId);
    if (thread?.escalated) {
      // a human is handling this thread → forward to Telegram so they see the new message
      await ctx.scheduler.runAfter(0, internal.notify.renterChat, { email: a.email, text: t, bookingId });
    } else {
      // Gaffer (AI) handles it — scoped to the rental the customer is asking about, if any
      await ctx.scheduler.runAfter(0, internal.gaffer.gafferReply, { accountId: a._id, bookingId, messageId });
    }
  },
});

/** Internal: post a system/assistant message (booking info, upsells, add-on confirmations). */
export const postSystem = internalMutation({
  args: {
    accountId: v.id("accounts"),
    bookingId: v.optional(v.id("bookings")),
    text: v.string(),
    meta: v.optional(v.any()),
  },
  handler: async (ctx, a) => {
    await postRentalMessage(ctx,{...a,sender:"system"});
  },
});

/** Context for Gaffer's reply: recent thread + the renter's most relevant booking + location/hours. */
export const _gafferContext = internalQuery({
  args: { accountId: v.id("accounts"), focusBookingId: v.optional(v.id("bookings")) },
  handler: async (ctx, { accountId, focusBookingId }) => {
    const acct: any = await ctx.db.get(accountId);
    if (!acct) return null;
    const thread = await rentalThread(ctx,accountId,focusBookingId);
    const rawMessages = focusBookingId
      ? await ctx.db.query("messages").withIndex("by_booking_at",q=>q.eq("bookingId",focusBookingId)).filter(q=>q.eq(q.field("accountId"),accountId)).order("desc").take(12)
      : (await ctx.db.query("messages").withIndex("by_account_at",q=>q.eq("accountId",accountId)).filter(q=>q.eq(q.field("bookingId"),undefined)).order("desc").take(12));
    const msgs=rawMessages.reverse().map(m=>({_id:m._id,sender:m.sender,text:m.text}));
    const pick:any=focusBookingId?await ownedBooking(ctx,acct,focusBookingId):null;
    const STATUS_PHRASE: Record<string, string> = {
      pending_payment: "NOT YET CONFIRMED — an unpaid draft; the customer must complete checkout to confirm it",
      confirmed: "confirmed",
      active: "out now (rental in progress)",
      returned: "completed and returned",
      cancelled: "cancelled",
    };
    let booking: any = null;
    if (pick) {
      const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10);
      const start = Math.min(...pick.lineItems.map((li: any) => li.start));
      const end = Math.max(...pick.lineItems.map((li: any) => li.end));
      // NOTE: the customer's stored delivery/home address is deliberately NOT included here —
      // Gaffer must never be able to read it out. Only the depot pickup address (settings) is shareable.
      const rentalContents = await Promise.all(pick.lineItems.map(async (li:any) => {
        const listing = await ctx.db.get(li.listingId);
        return `${li.title}: ${contentsText(listing)}`;
      }));
      const credit=pick.creditIssuedId?await ctx.db.get(pick.creditIssuedId as Id<"credits">):null;
      const refunds=await ctx.db.query("rental_refunds").withIndex("by_booking",q=>q.eq("bookingId",pick._id)).collect();
      const addition=pick.activeAdditionId?await ctx.db.get(pick.activeAdditionId as Id<"rental_additions">):null;
      booking = {
        items:pick.lineItems.map((li:any)=>({title:li.title,qty:li.qty,start:iso(li.start),end:iso(li.end)})),
        pendingItemAddition:addition?{title:addition.title,qty:addition.qty,status:addition.status,rentalCharge:addition.lineTotal,securityCharge:addition.securityCharge,updatedHold:addition.holdTotal,applied:false}:null,
        rentalContents,
        stage:pick.status,
        cancellation:{policy:pick.cancellationDecision?.kind??cancelKind(start,Date.now()),cardRefund:pick.refundAmount??null,creditIssued:credit?.amount??0,creditExpiresAt:credit?.expiresAt??null,rentalRefunds:refunds.map(r=>({amount:r.amountPence/100,status:r.status}))},
        payment:{total:pick.total,securityPaid:pick.depositAmount,securityRefunded:pick.depositRefundAmount??null,depositRefunded:!!pick.depositRefunded,securityRetained:pick.depositKept??0,holdStatus:pick.depositHoldStatus??null,lateFee:pick.lateFeeAmount??0,lateFeeStatus:pick.lateFeeStatus??null},
        summary: pick.lineItems.map((li: any) => li.title).join(", "),
        dates: `${iso(start)} → ${iso(end)}`,
        fulfilment: pick.fulfilment,
        status: STATUS_PHRASE[pick.status] ?? pick.status,
        pickupTime: pick.pickupTime ?? null,
        returnTime: pick.returnTime ?? null,
      };
    }
    const settings: any = await ctx.db.query("settings").first();
    return {
      email: acct.email,
      escalated: !!thread?.escalated,
      messages: msgs,
      latestRenterId:[...msgs].reverse().find(m=>m.sender==="renter")?._id??null,
      booking,
      // An unpaid draft must never receive depot details or pickup confirmation.
      location: pick && ["confirmed", "active"].includes(pick.status) && pick.fulfilment === "pickup"
        ? settings?.businessAddress || null : null,
      hours: settings?.openingHours || "09:00–22:00, daily",
    };
  },
});

export const _postBot = internalMutation({
  args:{accountId:v.id("accounts"),bookingId:v.optional(v.id("bookings")),replyTo:v.optional(v.id("messages")),text:v.string()},
  handler:async(ctx,{accountId,bookingId,replyTo,text})=>{
    const t=await rentalThread(ctx,accountId,bookingId);
    if(t?.escalated || (replyTo && t?.gafferReplyTo===replyTo))return false;
    if(replyTo){
      const recent=bookingId?await ctx.db.query("messages").withIndex("by_booking_at",q=>q.eq("bookingId",bookingId)).filter(q=>q.eq(q.field("accountId"),accountId)).order("desc").take(20):await ctx.db.query("messages").withIndex("by_account_at",q=>q.eq("accountId",accountId)).filter(q=>q.eq(q.field("bookingId"),undefined)).order("desc").take(20);
      if(recent.find(m=>m.sender==="renter")?._id!==replyTo)return false;
    }
    await postRentalMessage(ctx,{accountId,bookingId,sender:"bot",text});
    const updated=await rentalThread(ctx,accountId,bookingId);
    if(updated && replyTo)await ctx.db.patch(updated._id,{gafferReplyTo:replyTo});
    return true;
  },
});

export const _setEscalated = internalMutation({
  args: { accountId: v.id("accounts"), bookingId:v.optional(v.id("bookings")), escalated: v.boolean(), tgMessageId: v.optional(v.number()) },
  handler: async (ctx, { accountId, bookingId, escalated, tgMessageId }) => {
    const t = await rentalThread(ctx,accountId,bookingId);
    const wasEscalated = !!t?.escalated;
    if (t) await ctx.db.patch(t._id, { escalated, ...(tgMessageId != null ? { tgMessageId } : {}), updatedAt: Date.now() });
    else await ctx.db.insert("chat_threads", { accountId, bookingId, escalated, tgMessageId, updatedAt: Date.now() });
    if (escalated && !wasEscalated) await queueOwnerNotification(ctx, {
      eventKey: `human-handoff:${accountId}:${bookingId ?? "general"}:${Date.now()}`, kind: "human_request", accountId, bookingId,
      title: "Gaffer needs your help", body: "A rental conversation has been passed to your team.",
    });
  },
});

/** Customer presses "Talk to a human" → escalate + alert the team on Telegram. */
export const requestHuman = mutation({
  args: { token: v.string(), bookingId:v.optional(v.id("bookings")) },
  handler: async (ctx, { token, bookingId }) => {
    const a: any = await acctByToken(ctx, token);
    if (!a) throw new Error("unauthorized");
    if(bookingId)await ownedBooking(ctx,a,bookingId);
    const t = await rentalThread(ctx,a._id,bookingId);
    if (t?.escalated) return { ok: true };
    if (t) await ctx.db.patch(t._id, { escalated: true, updatedAt: Date.now() });
    else await ctx.db.insert("chat_threads", { accountId: a._id, bookingId, escalated: true, updatedAt: Date.now() });
    const messageId = await postRentalMessage(ctx,{accountId:a._id,bookingId,sender:"system",text:"The team has been notified. Your conversation stays here."});
    await queueOwnerNotification(ctx, { eventKey: `human-request:${messageId}`, kind: "human_request", accountId: a._id, bookingId,
      title: "Renter requested a human", body: "A renter is waiting for your team in the rental inbox." });
    await ctx.scheduler.runAfter(0, internal.chat._escalationAlert, { accountId: a._id, bookingId });
    return { ok: true };
  },
});

/** Telegram alert to the team; stores the message id so an admin REPLY routes back to the thread. */
export const _escalationAlert = internalAction({
  args: { accountId: v.id("accounts"), bookingId:v.optional(v.id("bookings")) },
  handler: async (ctx, { accountId, bookingId }) => {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    const chat = process.env.TELEGRAM_ADMIN_CHAT_ID;
    if (!token || !chat) return;
    const cx: any = await ctx.runQuery(internal.chat._gafferContext, { accountId, focusBookingId:bookingId });
    if (!cx) return;
    const last = cx.messages.slice(-5).map((m: any) => `${m.sender === "renter" ? "👤" : m.sender === "bot" ? "🤖" : "•"} ${m.text}`).join("\n");
    const esc=(text:string)=>text.replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[c]!);
    const origin=new URL(process.env.APP_URL??"https://dbcinemarentals.com").origin;
    const link=`${origin}/admin${bookingId?`?rental=${bookingId}`:""}#messages`;
    const text = `🙋 <b>Human requested — rental chat</b>\n${esc(cx.email)}\n${esc(cx.booking ? `${cx.booking.summary} · ${cx.booking.stage}` : "General support")}\n\n${esc(last)}\n\n<a href="${link}">Open conversation</a>\n<i>Reply to this message to answer the customer. Send "/gaffer" to hand back to the AI.</i>`;
    try {
      const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ chat_id: chat, text, parse_mode: "HTML" }),
      });
      const j = await res.json();
      const mid = j?.result?.message_id;
      if (mid) await ctx.runMutation(internal.chat._setEscalated, { accountId, bookingId, escalated: true, tgMessageId: mid });
    } catch {
      /* best-effort */
    }
  },
});

/** Admin REPLIED to an escalation Telegram message → route their text into the renter's thread. */
export const _adminReply = internalMutation({
  args: { tgMessageId: v.number(), text: v.string() },
  handler: async (ctx, { tgMessageId, text }) => {
    const t = await ctx.db.query("chat_threads").withIndex("by_tgMessageId", (q) => q.eq("tgMessageId", tgMessageId)).first();
    if (!t) return { ok: false };
    if (text.trim().toLowerCase() === "/gaffer") {
      await ctx.db.patch(t._id, { escalated: false, updatedAt: Date.now() });
      await postRentalMessage(ctx,{accountId:t.accountId,bookingId:t.bookingId,sender:"system",text:"Gaffer is back to help with this rental."});
      return { ok: true };
    }
    await postRentalMessage(ctx,{accountId:t.accountId,bookingId:t.bookingId,sender:"owner",text});
    return { ok: true };
  },
});

/** Stage and receipt are checked in the same transaction as the message. */
export const postBookingMessages = internalMutation({
  args: { bookingId: v.id("bookings") },
  handler: async (ctx, { bookingId }) => {
    const b = await ctx.db.get(bookingId);
    if (!b || !["confirmed", "active"].includes(b.status) || b.chatConfirmationMessageId) return;
    const account = await ctx.db.query("accounts").withIndex("by_email", q => q.eq("email", (b.guestEmail ?? "").trim().toLowerCase())).first();
    if (!account) return;
    const settings = await ctx.db.query("settings").first();
    const day = (ms: number) => new Date(ms).toLocaleDateString("en-GB", { timeZone: "UTC", day: "numeric", month: "short", year: "numeric" });
    const start = Math.min(...b.lineItems.map(li => li.start));
    const end = Math.max(...b.lineItems.map(li => li.end));
    const collection = b.fulfilment === "pickup"
      ? `Collection: ${day(start)}${b.pickupTime ? ` at ${b.pickupTime} (London time)` : "; time to be confirmed"}.${settings?.businessAddress ? ` Location: ${settings.businessAddress}.` : " We will confirm the collection location here."}`
      : `Delivery: ${day(start)}${b.pickupTime ? ` at ${b.pickupTime} (London time)` : "; time to be confirmed"}, to the address on your booking.`;
    const id = await postRentalMessage(ctx, { accountId: account._id, bookingId, sender: "system",
      text: `${b.status === "active" ? "Your rental is on hire." : "Your rental is confirmed."}\n${collection}\nReturn: ${day(end)}${b.returnTime ? ` at ${b.returnTime} (London time)` : "; time to be confirmed"}.\nYour kit and any updates are in this conversation.`,
      meta: { kind: "booking_confirmation", bookingId, stage: b.status } });
    await ctx.db.patch(bookingId, { chatConfirmationMessageId: id });
  },
});

// ── bot API (for the renter-facing bot; auth via BOT_TOKEN) ──────────
export const botFeed = query({
  args: { botToken: v.string() },
  handler: async (ctx, { botToken }) => {
    if (!botOk(botToken)) return { authorized: false as const, items: [] };
    const unread = await ctx.db
      .query("messages")
      .withIndex("by_unread", (q) => q.eq("sender", "renter").eq("readByOwner", false))
      .collect();
    const out: any[] = [];
    for (const m of unread.sort((a, b) => a.at - b.at)) {
      const acct: any = await ctx.db.get(m.accountId);
      const thread=await rentalThread(ctx,m.accountId,m.bookingId);
      if((thread?.ownerReadAt??0)>=m.at)continue;
      const booking=m.bookingId&&acct?await ownedBooking(ctx,acct,m.bookingId).catch(()=>null):null;
      out.push({
        messageId: m._id,
        accountId: m.accountId,
        bookingId:m.bookingId??null,
        email: acct?.email,
        name: acct?.name ?? null,
        text: m.text,
        at: m.at,
        booking: booking
          ? {
              status: booking.status,
              items: booking.lineItems.map((li: any) => li.title),
              start: Math.min(...booking.lineItems.map((li: any) => li.start)),
              end: Math.max(...booking.lineItems.map((li: any) => li.end)),
              fulfilment: booking.fulfilment,
            }
          : null,
      });
    }
    return { authorized: true as const, items: out };
  },
});

export const botSend = mutation({
  args: { botToken: v.string(), accountId: v.id("accounts"), text: v.string() },
  handler: async (ctx, { botToken, accountId, text }) => {
    if (!botOk(botToken)) throw new Error("unauthorized");
    await postRentalMessage(ctx, {
      accountId,
      sender: "bot",
      text: text.trim(),
    });
    return { ok: true };
  },
});

export const botMarkRead = mutation({
  args: { botToken: v.string(), accountId: v.id("accounts") },
  handler: async (ctx, { botToken, accountId }) => {
    if (!botOk(botToken)) throw new Error("unauthorized");
    const msgs = await ctx.db
      .query("messages")
      .withIndex("by_account", (q) => q.eq("accountId", accountId))
      .collect();
    for (const m of msgs)
      if (m.sender === "renter" && !m.readByOwner) await ctx.db.patch(m._id, { readByOwner: true });
  },
});

export { ADDON_CUTOFF_MS };
