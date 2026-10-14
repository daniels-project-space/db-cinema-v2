import { rentalsForAccount } from "./lib/rentalAccount";
import {availableCreditRows} from "./lib/checkoutCredit";
import {operatorCancellationOptions} from "../shared/operatorCancellationCredit";
import { accountForToken, ownedBooking, rentalThread, postRentalMessage } from "./lib/rentalChat";
import { accountForRental } from "./lib/rentalAccount";
import { bookingCancelKind, cancellationDaysForBooking } from "../src/lib/cancellationPolicy";
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
    if (!acct || acct.blockedAt != null) return null;
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
      const creditIssue=await ctx.db.query("credit_issues").withIndex("by_booking",q=>q.eq("bookingId",pick._id)).unique();
      const operatorChoice=pick.cancellationDecision?.operatorOfferId?await ctx.db.get(pick.cancellationDecision.operatorOfferId as Id<"operator_cancellation_offers">):null;
      const operatorAmounts=operatorChoice?.cashRemainingPence==null?null:operatorCancellationOptions({cashRemainingPence:operatorChoice.cashRemainingPence,securityRemainingPence:operatorChoice.securityRemainingPence??0,spentCreditPence:operatorChoice.spentCreditPence??0});
      const refunds=await ctx.db.query("rental_refunds").withIndex("by_booking",q=>q.eq("bookingId",pick._id)).collect();
      const addition=pick.activeAdditionId?await ctx.db.get(pick.activeAdditionId as Id<"rental_additions">):null;
      const extensionRequests=await ctx.db.query("booking_change_requests").withIndex("by_booking",q=>q.eq("bookingId",pick._id)).order("desc").take(20);
      const extension=extensionRequests.find(r=>r.type==="extend"&&["pending","approved","awaiting_payment","refund_pending"].includes(r.status));
      booking = {
        items:pick.lineItems.map((li:any)=>({title:li.title,qty:li.qty,start:iso(li.start),end:iso(li.end),returnTime:li.returnTime===undefined?pick.returnTime??null:li.returnTime})),
        pendingItemAddition:addition?{title:addition.title,qty:addition.qty,status:addition.status,rentalCharge:addition.lineTotal,securityCharge:addition.securityCharge,updatedHold:addition.holdTotal,applied:false}:null,
        pendingExtension:extension?{status:extension.status,extraDays:extension.extraDays,charge:extension.priceDelta,requestedReturnTime:extension.requestedReturnTime,approvedReturnTime:extension.approvedReturnTime,proposedItems:extension.quoteItems?.map(i=>({title:i.title,qty:i.qty,proposedReturn:iso(i.end)})),applied:false}:null,
        rentalContents,
        operatorCancellation:operatorChoice?{state:operatorChoice.state,choice:operatorChoice.choice??null,decisionAfter:operatorChoice.decisionAfter,choiceDeadline:operatorChoice.choiceDeadline??null,creditPence:operatorAmounts?.credit.creditPence??null,cashRefundPence:operatorAmounts?.refund.cardRefundPence??null,depositRefundPence:operatorChoice.securityRemainingPence??null}:null,
        stage:pick.status,
        cancellation:{fullRefundDays:cancellationDaysForBooking(pick),policy:pick.cancellationDecision?.kind??bookingCancelKind(pick,Date.now()),cardRefund:pick.refundAmount??null,creditIssued:creditIssue?creditIssue.amountPence/100:credit?.amount??0,creditBonus:(creditIssue?.bonusPence??0)/100,creditExpiresAt:creditIssue?.expiresAt??credit?.expiresAt??null,rentalRefunds:refunds.map(r=>({amount:r.amountPence/100,status:r.status}))},
        payment:{securityPolicyVersion:pick.securityPolicyVersion??null,savedCardLimit:pick.savedCardLimit??null,total:pick.total,securityPaid:pick.depositAmount,securityRefunded:pick.depositRefundAmount??null,depositRefunded:!!pick.depositRefunded,securityRetained:pick.depositKept??0,holdStatus:pick.depositHoldStatus??null,savedCardChargePaidPence:pick.savedCardChargePaidPence??0,savedCardChargeReservedPence:pick.savedCardChargeReservedPence??0,lateFee:pick.lateFeeAmount??0,lateFeeStatus:pick.lateFeeStatus??null},
        summary: pick.lineItems.map((li: any) => li.title).join(", "),
        dates: `${iso(start)} → ${iso(end)}`,
        fulfilment: pick.fulfilment,
        status: STATUS_PHRASE[pick.status] ?? pick.status,
        pickupTime: pick.pickupTime ?? null,
        returnTime: pick.returnTime ?? null,
      };
    }
    const settings: any = await ctx.db.query("settings").first();
    const creditRows=await availableCreditRows(ctx,acct._id),availableCreditPence=creditRows.reduce((n:number,row:any)=>n+row.availablePence,0);
    return {
      accountCredit:{available:availableCreditPence/100,expiresAt:creditRows.find((row:any)=>row.availablePence>0)?.expiresAt??null,currency:"GBP",selection:"Choose Use account credit at checkout; it is not automatically spent",nonRefundable:true,securityAndMembershipExcluded:true},
      checkoutUi:{accountCredit:"Header credit bar opens Account credit and receipts. Checkout shows the credit checkbox only when an available balance exists.",cancellationProtectionEnabled:process.env.CANCELLATION_PROTECTION_POLICY_ENABLED==="true",cancellationProtection:"Free shield card at checkout opens the policy. After DB cancels before pickup and the one-hour account decision, eligible renters receive private email links to review a full refund or 130% rental credit, with refundable deposit returned separately. No choice is executed by opening a link."},
      accountRentals: (await rentalsForAccount(ctx,acct,10)).map(b => ({id:b._id,status:b.status,items:b.lineItems.map((i:any)=>({title:i.title,qty:i.qty,start:i.start,end:i.end})),total:b.total,securityPaid:b.depositAmount})),
      email: acct.email,
      gafferGeneration: thread?.gafferGeneration ?? 0,
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
  args:{accountId:v.id("accounts"),bookingId:v.optional(v.id("bookings")),replyTo:v.optional(v.id("messages")),generation:v.optional(v.number()),text:v.string()},
  handler:async(ctx,{accountId,bookingId,replyTo,generation,text})=>{
    const t=await rentalThread(ctx,accountId,bookingId);
    if(t?.escalated || (generation ?? 0) !== (t?.gafferGeneration ?? 0) || (replyTo && t?.gafferReplyTo===replyTo))return false;
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
  args: { accountId: v.id("accounts"), bookingId:v.optional(v.id("bookings")), escalated: v.boolean(), tgMessageId: v.optional(v.number()), expectedGeneration: v.optional(v.number()) },
  handler: async (ctx, { accountId, bookingId, escalated, tgMessageId, expectedGeneration }) => {
    const t = await rentalThread(ctx,accountId,bookingId);
    if(expectedGeneration !== undefined && expectedGeneration !== (t?.gafferGeneration ?? 0)) return false;
    const wasEscalated = !!t?.escalated;
    if (t) await ctx.db.patch(t._id, { escalated, gafferGeneration: (t.gafferGeneration ?? 0) + 1, ...(tgMessageId != null ? { tgMessageId } : {}), updatedAt: Date.now() });
    else await ctx.db.insert("chat_threads", { accountId, bookingId, escalated, gafferGeneration: 1, tgMessageId, updatedAt: Date.now() });
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
    if (t) await ctx.db.patch(t._id, { escalated: true, gafferGeneration: (t.gafferGeneration ?? 0) + 1, updatedAt: Date.now() });
    else await ctx.db.insert("chat_threads", { accountId: a._id, bookingId, escalated: true, gafferGeneration: 1, updatedAt: Date.now() });
    const messageId = await postRentalMessage(ctx,{accountId:a._id,bookingId,sender:"system",text:"The team has been notified. Your conversation stays here."});
    await queueOwnerNotification(ctx, { eventKey: `human-request:${messageId}`, kind: "human_request", accountId: a._id, bookingId,
      title: "Renter requested a human", body: "A renter is waiting for your team in the rental inbox." });
    await ctx.scheduler.runAfter(0, internal.chat._escalationAlert, { accountId: a._id, bookingId });
    return { ok: true };
  },
});

export const resumeGaffer = mutation({
  args: { token: v.string(), bookingId: v.optional(v.id("bookings")) },
  handler: async (ctx, { token, bookingId }) => {
    const account: any = await acctByToken(ctx, token);
    if (!account || account.blockedAt != null) throw Error("Sign in to return to Gaffer.");
    if (bookingId) await ownedBooking(ctx, account, bookingId);
    const thread = await rentalThread(ctx, account._id, bookingId);
    if (!thread?.escalated) return { ok: true };
    await ctx.db.patch(thread._id, { escalated: false, gafferGeneration: (thread.gafferGeneration ?? 0) + 1, updatedAt: Date.now() });
    const id = await postRentalMessage(ctx, { accountId: account._id, bookingId, sender: "system", text: "Gaffer is available again. Your conversation and team request history are kept here." });
    await queueOwnerNotification(ctx, { eventKey: `gaffer-resumed:${id}`, kind: "gaffer_resumed", accountId: account._id, bookingId,
      title: "Renter returned to Gaffer", body: "The renter resumed AI help in their existing conversation." });
    return { ok: true };
  },
});

/** Telegram alert to the team; stores the message id so an admin REPLY routes back to the thread. */
export const _escalationAlert = internalAction({
  args: { accountId: v.id("accounts"), bookingId:v.optional(v.id("bookings")) },
  handler: async (ctx, { accountId, bookingId }) => {
    // The manager queue owns channel preferences when the bridge is configured.
    if(process.env.RMV2_WEBHOOK_URL && process.env.RMV2_WEBHOOK_SECRET) return;
    const token = process.env.TELEGRAM_BOT_TOKEN;
    const chat = process.env.TELEGRAM_ADMIN_CHAT_ID;
    if (!token || !chat) return;
    const cx: any = await ctx.runQuery(internal.chat._gafferContext, { accountId, focusBookingId:bookingId });
    if (!cx || !cx.escalated) return;
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
      if (mid) await ctx.runMutation(internal.chat._setEscalated, { accountId, bookingId, escalated: true, expectedGeneration: cx.gafferGeneration, tgMessageId: mid });
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
    const account = await accountForRental(ctx,b);
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
