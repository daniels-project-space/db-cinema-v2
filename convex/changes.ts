import { mutation, internalMutation, internalQuery, internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import { peak, type Iv } from "./availability";

const DAY = 86400000;
const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/** Is `listing` available over [start,end] EXCLUDING this booking's own reservations? */
async function listingFree(ctx: any, listingId: any, start: number, end: number, excludeBookingId: any): Promise<boolean> {
  const l = await ctx.db.get(listingId);
  if (!l || !l.active) return false;
  const ACTIVE = new Set(["confirmed", "active", "hold"]);
  for (const comp of l.components) {
    const unit: any = await ctx.db.get(comp.inventoryUnitId);
    const owned = unit?.quantityOwned ?? 1;
    const existing: Iv[] = (
      await ctx.db.query("reservations").withIndex("by_unit", (q: any) => q.eq("inventoryUnitId", comp.inventoryUnitId)).collect()
    )
      .filter((r: any) => ACTIVE.has(r.status) && r.start <= end && r.end >= start && r.bookingId !== excludeBookingId)
      .map((r: any) => ({ start: r.start, end: r.end, qty: r.qty || 1 }));
    if (peak([...existing, { start, end, qty: comp.qty || 1 }]) > owned) return false;
  }
  return true;
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
    if (!acct || !b || (b.guestEmail ?? "").trim().toLowerCase() !== acct.email) throw new Error("unauthorized");
    if (!["confirmed", "active"].includes(b.status)) throw new Error("This booking can't be changed online.");
    if (a.type === "reschedule" && (a.requestedStart == null || a.requestedEnd == null)) throw new Error("Pick new dates.");
    if (a.type === "extend" && (!a.extraDays || a.extraDays < 1)) throw new Error("Pick how many extra days.");
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
    await ctx.db.insert("messages", { accountId: acct._id, bookingId: a.bookingId, sender: "system", text: msg, at: Date.now(), readByOwner: true });
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
    await ctx.db.insert("messages", { accountId: r.accountId, bookingId: r.bookingId, sender: "system", text: "We couldn't make that change this time — your rental is unchanged. Reply here and we'll help find an option.", at: Date.now(), readByOwner: true });
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
    const newStart = r.requestedStart, newEnd = r.requestedEnd;
    // every listing must be free over the new window (excluding this booking's own holds)
    for (const li of b.lineItems) {
      if (!(await listingFree(ctx, li.listingId, newStart, newEnd, r.bookingId))) {
        await ctx.db.patch(requestId, { status: "declined", resolvedAt: Date.now(), note: "unavailable" });
        await ctx.db.insert("messages", { accountId: r.accountId, bookingId: r.bookingId, sender: "system", text: `Sorry — ${li.title} isn't available for ${iso(newStart)} → ${iso(newEnd)}. Your rental is unchanged; reply here and we'll find an option.`, at: Date.now(), readByOwner: true });
        return { ok: false, reason: "unavailable" };
      }
    }
    await ctx.db.patch(r.bookingId, { lineItems: b.lineItems.map((li) => ({ ...li, start: newStart, end: newEnd })) });
    const reservations = await ctx.db.query("reservations").withIndex("by_booking", (q) => q.eq("bookingId", r.bookingId)).collect();
    for (const res of reservations) {
      if (res.status === "confirmed" || res.status === "active" || res.status === "hold") {
        await ctx.db.patch(res._id, { start: newStart, end: newEnd });
      }
    }
    await ctx.db.patch(requestId, { status: "applied", resolvedAt: Date.now() });
    await ctx.db.insert("messages", { accountId: r.accountId, bookingId: r.bookingId, sender: "system", text: `Done — your rental is rescheduled to ${iso(newStart)} → ${iso(newEnd)}. ✓`, at: Date.now(), readByOwner: true });
    await ctx.scheduler.runAfter(0, internal.notify.changeEmail, { bookingId: r.bookingId, kind: "rescheduled", detail: `${iso(newStart)} → ${iso(newEnd)}` });
    return { ok: true };
  },
});

/** Extend approval — the Stripe pay-link is built in the next slice; for now acknowledge. */
export const _approveExtendPending = internalMutation({
  args: { requestId: v.id("booking_change_requests") },
  handler: async (ctx, { requestId }) => {
    const r = await ctx.db.get(requestId);
    if (!r || r.status !== "pending") return { ok: false };
    await ctx.db.patch(requestId, { status: "approved", resolvedAt: Date.now() });
    await ctx.db.insert("messages", { accountId: r.accountId, bookingId: r.bookingId, sender: "system", text: `Your extension is approved — we'll send a secure payment link here for the extra day${(r.extraDays ?? 1) > 1 ? "s" : ""} shortly.`, at: Date.now(), readByOwner: true });
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
        await ctx.runMutation(internal.changes._approveExtendPending, { requestId });
        result = "Approved — pay link to follow";
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
