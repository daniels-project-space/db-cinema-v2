import {bookingStockLines,rentalWindow} from "../shared/rentalWindow";
import {assertRentalInventory} from "./lib/rentalInventory";
import {assertRentalAllocation} from "./lib/rentalAllocation";
import { schedulePickupHold } from "./pickupSecurity";
import { assertRenterExposure } from "./lib/rentalExposure";
import { postRentalMessage } from "./lib/rentalChat";
import { belongsToRentalAccount } from "./lib/rentalAccount";
import { mutation, internalMutation, internalQuery, internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import { queueRmv2Sync } from "./lib/rmv2SyncQueue";
import { peak, type Iv } from "./availability";

const DAY = 86400000;
const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/** Is `listing` available over [start,end] EXCLUDING this booking's own reservations? */
async function listingFree(ctx: any, listingId: any, start: number, end: number, excludeBookingId: any): Promise<boolean> {
  try{await assertRentalInventory(ctx,[{listingId,start,end,qty:1}],excludeBookingId);return true;}catch{return false;}
}

/** Customer requests a reschedule (whole booking) or item-level extend. Gated. */
export const requestBookingChange = mutation({
  args: {
    token: v.string(),
    bookingId: v.id("bookings"),
    type: v.union(v.literal("reschedule"), v.literal("extend")),
    lineItemIndexes: v.optional(v.array(v.number())),
    requestedStart: v.optional(v.number()),
    requestedEnd: v.optional(v.number()),
    extraDays: v.optional(v.number()),
    note: v.optional(v.string()),
  },
  handler: async (ctx, a) => {
    if (process.env.CUSTOMER_BOOKING_ACTIONS !== "true")
      throw new Error("Changes aren't available online yet — please contact us.");
    const s = await ctx.db.query("sessions").withIndex("by_token", (q) => q.eq("token", a.token)).first();
    const acct: any = s ? await ctx.db.get(s.accountId) : null;
    const b = await ctx.db.get(a.bookingId);
    if(!s||(s.expiresAt??0)<=Date.now())throw Error("Please sign in again");
    if (!acct || !b || acct.blockedAt!=null || !belongsToRentalAccount(b,acct)) throw new Error("unauthorized");
    if(b.cancellationDecision)throw Error("Cancellation is in progress");
    if (!["confirmed", "active"].includes(b.status)) throw new Error("This booking can't be changed online.");
    if (a.type === "reschedule" && (a.requestedStart == null || a.requestedEnd == null)) throw new Error("Pick new dates.");
    if (a.type === "reschedule") {
      // an out-now rental can only be EXTENDED — moving its window would free the inventory while
      // the gear is still physically with the customer, opening a double-booking hole.
      if (b.status !== "confirmed") throw new Error("An active rental can only be extended — contact us to change a pickup that's already out.");
      const ns = a.requestedStart!, ne = a.requestedEnd!;
      if (ne <= ns) throw new Error("End date must be after the start date.");
      // a reschedule is a SHIFT, not a resize — extra days must go through Extend (which charges).
      const origStart = Math.min(...b.lineItems.map((li) => li.start));
      const origEnd = Math.max(...b.lineItems.map((li) => li.end));
      const newDays = Math.round((ne - ns) / DAY), origDays = Math.round((origEnd - origStart) / DAY);
      if (newDays !== origDays) throw new Error(`A reschedule keeps the same ${origDays}-day length — use "Add day" to extend.`);
      if (ns < Date.now() - DAY) throw new Error("Pick a start date in the future.");
    }
    if (a.type === "extend") throw new Error("Use Request extension in your rental chat to review the dates and price first.");
    // one open request at a time per booking
    const open = (await ctx.db.query("booking_change_requests").withIndex("by_booking", (q) => q.eq("bookingId", a.bookingId)).collect())
      .find((r) => r.status === "pending" || r.status === "awaiting_payment");
    if (open) throw new Error("You already have a pending change on this booking.");

    const requestId = await ctx.db.insert("booking_change_requests", {
      bookingId: a.bookingId, accountId: acct._id, type: a.type,
      lineItemIndexes: a.lineItemIndexes, requestedStart: a.requestedStart, requestedEnd: a.requestedEnd,
      extraDays: a.extraDays, note: a.note, status: "pending", createdAt: Date.now(),
    });
    const idxs = a.lineItemIndexes?.length ? a.lineItemIndexes : b.lineItems.map((_, i) => i);
    const names = idxs.map((i) => b.lineItems[i]?.title).filter(Boolean).join(", ");
    const msg = a.type === "reschedule"
      ? `You asked to reschedule your rental to ${iso(a.requestedStart!)} → ${iso(a.requestedEnd!)} — we'll confirm shortly.`
      : `You asked to extend ${names || "your rental"} by ${a.extraDays} day${a.extraDays! > 1 ? "s" : ""} — we'll confirm shortly.`;
    await postRentalMessage(ctx, { accountId: acct._id, bookingId: a.bookingId, sender: "system", text: msg, });
    await ctx.scheduler.runAfter(0, internal.changes._changeAlert, { requestId });
    return { ok: true, requestId };
  },
});

export const _getRequest = internalQuery({
  args: { requestId: v.id("booking_change_requests") },
  handler: async (ctx, { requestId }) => {
    const r = await ctx.db.get(requestId);
    if (!r) return null;
    const b = await ctx.db.get(r.bookingId);
    const idxs = r.lineItemIndexes?.length ? r.lineItemIndexes : (b?.lineItems ?? []).map((_, i) => i);
    const summary = idxs.map((i) => b?.lineItems[i]?.title).filter(Boolean).join(", ");
    return { ...r, guestEmail: b?.guestEmail ?? "", summary };
  },
});

/** Telegram alert to the admin with Approve/Decline inline buttons. */
export const _changeAlert = internalAction({
  args: { requestId: v.id("booking_change_requests") },
  handler: async (ctx, { requestId }) => {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    const chat = process.env.TELEGRAM_ADMIN_CHAT_ID;
    if (!token || !chat) return;
    const r: any = await ctx.runQuery(internal.changes._getRequest, { requestId });
    if (!r) return;
    const detail = r.type === "extend"
      ? `+${r.extraDays} day(s)`
      : `New dates: ${iso(r.requestedStart)} → ${iso(r.requestedEnd)}`;
    const text = `🔁 <b>${r.type === "extend" ? "Extend" : "Reschedule"} request</b>\n${r.guestEmail}\n${r.summary}\n${detail}`;
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({
        chat_id: chat, text, parse_mode: "HTML",
        reply_markup: { inline_keyboard: [[
          { text: "✅ Approve", callback_data: `chg:approve:${requestId}` },
          { text: "❌ Decline", callback_data: `chg:decline:${requestId}` },
        ]] },
      }),
    });
  },
});

export const _decline = internalMutation({
  args: { requestId: v.id("booking_change_requests") },
  handler: async (ctx, { requestId }) => {
    const r = await ctx.db.get(requestId);
    if (!r || r.status !== "pending") return { ok: false };
    await ctx.db.patch(requestId, { status: "declined", resolvedAt: Date.now() });
    await postRentalMessage(ctx, { accountId: r.accountId, bookingId: r.bookingId, sender: "system", text: "We couldn't make that change this time — your rental is unchanged. Reply here and we'll help find an option.", });
    return { ok: true };
  },
});

/** Reschedule = move the WHOLE booking to new dates (after availability re-check excluding self). */
export const _applyReschedule = internalMutation({
  args: { requestId: v.id("booking_change_requests") },
  handler: async (ctx, { requestId }) => {
    const r = await ctx.db.get(requestId);
    if (!r || r.status !== "pending" || r.type !== "reschedule") return { ok: false, reason: "gone" };
    const b = await ctx.db.get(r.bookingId);
    if (!b || r.requestedStart == null || r.requestedEnd == null) return { ok: false, reason: "gone" };
    if(b.cancellationDecision||b.returnDecision||b.activeAdditionId||b.activeExtensionId||b.status!=="confirmed")throw Error("This rental can no longer be rescheduled");
    const newStart = r.requestedStart, newEnd = r.requestedEnd;
    const lines=bookingStockLines(b).map(li=>({...li,start:newStart,end:newEnd}));
    try{await assertRentalInventory(ctx,lines,r.bookingId);}catch{
      await ctx.db.patch(requestId,{status:"declined",resolvedAt:Date.now(),note:"unavailable"});
      await postRentalMessage(ctx,{accountId:r.accountId,bookingId:r.bookingId,sender:"system",text:`Sorry — this complete kit is unavailable for ${iso(newStart)} → ${iso(newEnd)}. Your rental is unchanged; reply here and we'll find an option.`});
      return {ok:false,reason:"unavailable"};
    }
    await assertRenterExposure(ctx,b,lines);
    const reservations=await ctx.db.query("reservations").withIndex("by_booking",q=>q.eq("bookingId",r.bookingId)).collect();
    const mode=await assertRentalAllocation(ctx,b,reservations);
    await ctx.db.patch(r.bookingId,{lineItems:lines});
    await schedulePickupHold(ctx,{...b,lineItems:lines});
    for(const res of reservations)if(["confirmed","active","hold"].includes(res.status))await ctx.db.patch(res._id,{status:"cancelled"});
    for(const li of lines){const listing=await ctx.db.get(li.listingId);const window=mode==="legacy"?{start:li.start,end:li.end}:rentalWindow(li,mode==="precise");for(const comp of listing!.components)await ctx.db.insert("reservations",{inventoryUnitId:comp.inventoryUnitId,listingId:li.listingId,bookingId:r.bookingId,...window,qty:comp.qty*li.qty,source:"site",status:"confirmed"});}
    await ctx.db.patch(requestId, { status: "applied", resolvedAt: Date.now() });
    await postRentalMessage(ctx, { accountId: r.accountId, bookingId: r.bookingId, sender: "system", text: `Done — your rental is rescheduled to ${iso(newStart)} → ${iso(newEnd)}. ✓`, });
    await ctx.scheduler.runAfter(0, internal.notify.changeEmail, { bookingId: r.bookingId, kind: "rescheduled", detail: `${iso(newStart)} → ${iso(newEnd)}` });
    await queueRmv2Sync(ctx, r.bookingId);
    return { ok: true };
  },
});

/** Called by the Telegram webhook on an Approve/Decline button press. */
export const resolveChange = internalAction({
  args: {
    requestId: v.id("booking_change_requests"),
    action: v.string(),
    callbackQueryId: v.optional(v.string()),
    chatId: v.optional(v.number()),
    messageId: v.optional(v.number()),
  },
  handler: async (ctx, { requestId, action, callbackQueryId, chatId, messageId }) => {
    const r: any = await ctx.runQuery(internal.changes._getRequest, { requestId });
    let result = "Already handled";
    if (r && r.status === "pending") {
      if (action === "decline") {
        await ctx.runMutation(internal.changes._decline, { requestId });
        result = "Declined ❌";
      } else if (r.type === "reschedule") {
        const res: any = await ctx.runMutation(internal.changes._applyReschedule, { requestId });
        result = res?.ok ? "Rescheduled ✓" : "Unavailable — declined";
      } else {
        await ctx.runAction(internal.rentalExtensionPayments.approveFromOwnerWebhook, { requestId });
        result = "Approved — pay link sent to chat";
      }
    }
    const token = process.env.TELEGRAM_BOT_TOKEN;
    if (token && callbackQueryId) {
      await fetch(`https://api.telegram.org/bot${token}/answerCallbackQuery`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ callback_query_id: callbackQueryId, text: result }),
      }).catch(() => {});
    }
    if (token && chatId != null && messageId != null) {
      await fetch(`https://api.telegram.org/bot${token}/editMessageReplyMarkup`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ chat_id: chatId, message_id: messageId, reply_markup: { inline_keyboard: [[{ text: result, callback_data: "noop" }]] } }),
      }).catch(() => {});
    }
  },
});
