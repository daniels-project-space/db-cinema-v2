import { query, mutation, internalQuery, internalMutation, internalAction } from "./_generated/server";
import { internal, api } from "./_generated/api";
import { v } from "convex/values";

const ADDON_CUTOFF_MS = 60 * 60 * 1000; // no add-ons within 1h of rental start

function botOk(token: string) {
  return !!process.env.BOT_TOKEN && token === process.env.BOT_TOKEN;
}
async function acctByToken(ctx: any, token: string) {
  const s = await ctx.db
    .query("sessions")
    .withIndex("by_token", (q: any) => q.eq("token", token))
    .first();
  return s ? await ctx.db.get(s.accountId) : null;
}

/** Renter's own message thread (reactive → live). */
export const myThread = query({
  args: { token: v.string() },
  handler: async (ctx, { token }) => {
    const a: any = await acctByToken(ctx, token);
    if (!a) return null;
    const msgs = await ctx.db
      .query("messages")
      .withIndex("by_account", (q) => q.eq("accountId", a._id))
      .collect();
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
    const t = text.trim();
    if (!t) return;
    if (t.length > 2000) throw new Error("That message is too long — please shorten it.");
    // rate limit: cap renter messages per account so a (leaked) token can't flood the owner's
    // Telegram. ~6 messages / 30s is plenty for a human conversation.
    const WINDOW_MS = 30_000, MAX_IN_WINDOW = 6;
    const recent = (
      await ctx.db.query("messages").withIndex("by_account", (q) => q.eq("accountId", a._id)).collect()
    ).filter((m) => m.sender === "renter" && m.at > Date.now() - WINDOW_MS);
    if (recent.length >= MAX_IN_WINDOW)
      throw new Error("You're sending messages a little too fast — give us a moment to catch up.");
    await ctx.db.insert("messages", {
      accountId: a._id,
      bookingId,
      sender: "renter",
      text: t,
      at: Date.now(),
      readByOwner: false,
    });
    const thread = await ctx.db.query("chat_threads").withIndex("by_account", (q) => q.eq("accountId", a._id)).first();
    if (thread?.escalated) {
      // a human is handling this thread → forward to Telegram so they see the new message
      await ctx.scheduler.runAfter(0, internal.notify.renterChat, { email: a.email, text: t });
    } else {
      // Gaffer (AI) handles it — scoped to the rental the customer is asking about, if any
      await ctx.scheduler.runAfter(0, internal.gaffer.gafferReply, { accountId: a._id, bookingId });
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
    await ctx.db.insert("messages", {
      accountId: a.accountId,
      bookingId: a.bookingId,
      sender: "system",
      text: a.text,
      meta: a.meta,
      at: Date.now(),
      readByOwner: true,
    });
  },
});

/** Context for Gaffer's reply: recent thread + the renter's most relevant booking + location/hours. */
export const _gafferContext = internalQuery({
  args: { accountId: v.id("accounts"), focusBookingId: v.optional(v.id("bookings")) },
  handler: async (ctx, { accountId, focusBookingId }) => {
    const acct: any = await ctx.db.get(accountId);
    if (!acct) return null;
    const thread = await ctx.db.query("chat_threads").withIndex("by_account", (q) => q.eq("accountId", accountId)).first();
    const msgs = (await ctx.db.query("messages").withIndex("by_account", (q) => q.eq("accountId", accountId)).collect())
      .sort((x, y) => x.at - y.at)
      .slice(-12)
      .map((m) => ({ sender: m.sender, text: m.text }));
    const bookings: any[] = await ctx.db.query("bookings").withIndex("by_guestEmail", (q: any) => q.eq("guestEmail", acct.email)).order("desc").take(10);
    const focused = focusBookingId ? bookings.find((b: any) => String(b._id) === String(focusBookingId)) : null;
    const pick: any = focused ?? bookings.find((b: any) => b.status === "active") ?? bookings.find((b: any) => b.status === "confirmed") ?? bookings[0] ?? null;
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
      booking = {
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
      booking,
      location: settings?.businessAddress || null,
      hours: settings?.openingHours || "10:00–12:00 & 19:00–21:00, daily",
    };
  },
});

export const _postBot = internalMutation({
  args: { accountId: v.id("accounts"), text: v.string() },
  handler: async (ctx, { accountId, text }) => {
    await ctx.db.insert("messages", { accountId, sender: "bot", text, at: Date.now(), readByOwner: true });
  },
});

export const _setEscalated = internalMutation({
  args: { accountId: v.id("accounts"), escalated: v.boolean(), tgMessageId: v.optional(v.number()) },
  handler: async (ctx, { accountId, escalated, tgMessageId }) => {
    const t = await ctx.db.query("chat_threads").withIndex("by_account", (q) => q.eq("accountId", accountId)).first();
    if (t) await ctx.db.patch(t._id, { escalated, ...(tgMessageId != null ? { tgMessageId } : {}), updatedAt: Date.now() });
    else await ctx.db.insert("chat_threads", { accountId, escalated, tgMessageId, updatedAt: Date.now() });
  },
});

/** Customer presses "Talk to a human" → escalate + alert the team on Telegram. */
export const requestHuman = mutation({
  args: { token: v.string() },
  handler: async (ctx, { token }) => {
    const a: any = await acctByToken(ctx, token);
    if (!a) throw new Error("unauthorized");
    const t = await ctx.db.query("chat_threads").withIndex("by_account", (q) => q.eq("accountId", a._id)).first();
    if (t) await ctx.db.patch(t._id, { escalated: true, updatedAt: Date.now() });
    else await ctx.db.insert("chat_threads", { accountId: a._id, escalated: true, updatedAt: Date.now() });
    await ctx.db.insert("messages", { accountId: a._id, sender: "system", text: "You're connected to the team — a human will reply here shortly. 👋", at: Date.now(), readByOwner: true });
    await ctx.scheduler.runAfter(0, internal.chat._escalationAlert, { accountId: a._id });
    return { ok: true };
  },
});

/** Telegram alert to the team; stores the message id so an admin REPLY routes back to the thread. */
export const _escalationAlert = internalAction({
  args: { accountId: v.id("accounts") },
  handler: async (ctx, { accountId }) => {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    const chat = process.env.TELEGRAM_ADMIN_CHAT_ID;
    if (!token || !chat) return;
    const cx: any = await ctx.runQuery(internal.chat._gafferContext, { accountId });
    if (!cx) return;
    const last = cx.messages.slice(-5).map((m: any) => `${m.sender === "renter" ? "👤" : m.sender === "bot" ? "🤖" : "•"} ${m.text}`).join("\n");
    const text = `🙋 <b>Human requested — rental chat</b>\n${cx.email}\n${cx.booking ? cx.booking.summary : "(no active rental)"}\n\n${last}\n\n<i>Reply to this message to answer the customer. Send "/gaffer" to hand back to the AI.</i>`;
    try {
      const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ chat_id: chat, text, parse_mode: "HTML" }),
      });
      const j = await res.json();
      const mid = j?.result?.message_id;
      if (mid) await ctx.runMutation(internal.chat._setEscalated, { accountId, escalated: true, tgMessageId: mid });
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
      await ctx.db.insert("messages", { accountId: t.accountId, sender: "system", text: "Gaffer (our assistant) is back on this chat — ask away!", at: Date.now(), readByOwner: true });
      return { ok: true };
    }
    await ctx.db.insert("messages", { accountId: t.accountId, sender: "bot", text, at: Date.now(), readByOwner: true });
    return { ok: true };
  },
});

/** After a booking confirms: post a welcome + summary, then contextual upsells. */
export const postBookingMessages = internalAction({
  args: { bookingId: v.id("bookings") },
  handler: async (ctx, { bookingId }) => {
    const b: any = await ctx.runQuery(internal.bookings.getForChat, { bookingId });
    if (!b || !b.accountId) return; // guest checkout → no account thread

    const day = (ms: number) => new Date(ms).toISOString().slice(0, 10);
    const start = Math.min(...b.lineItems.map((li: any) => li.start));
    const end = Math.max(...b.lineItems.map((li: any) => li.end));
    const where =
      b.fulfilment === "delivery"
        ? `Delivery to ${b.address ?? "your address"}${b.pickupTime ? " around " + b.pickupTime : ""}`
        : `Pickup in central London${b.pickupTime ? " at " + b.pickupTime : ""}`;
    const items = b.lineItems.map((li: any) => `• ${li.title}`).join("\n");

    await ctx.runMutation(internal.chat.postSystem, {
      accountId: b.accountId,
      bookingId,
      text: `Booking confirmed 🎬\n${items}\n\n${day(start)} → ${day(end)}\n${where}\n\nReply here any time — we're happy to help.`,
    });

    // contextual upsells (reuse the offers engine), gated client-side by the 1h rule
    const offers: any[] = await ctx.runQuery(api.offers.forCart, {
      items: b.lineItems.map((li: any) => ({
        listingId: li.listingId,
        start: li.start,
        end: li.end,
        total: li.lineTotal,
      })),
    });
    if (offers && offers.length) {
      await ctx.runMutation(internal.chat.postSystem, {
        accountId: b.accountId,
        bookingId,
        text: "Want to round out your kit? A few add-ons that pair well — tap to add to this rental:",
        meta: { kind: "upsell", bookingId, start, end, offers },
      });
    }
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
      // most recent booking for context
      const booking = acct
        ? await ctx.db
            .query("bookings")
            .withIndex("by_guestEmail", (q) => q.eq("guestEmail", acct.email))
            .order("desc")
            .first()
        : null;
      out.push({
        messageId: m._id,
        accountId: m.accountId,
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
              address: booking.address ?? null,
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
    await ctx.db.insert("messages", {
      accountId,
      sender: "bot",
      text: text.trim(),
      at: Date.now(),
      readByOwner: true,
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
