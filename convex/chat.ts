import { query, mutation, internalMutation, internalAction } from "./_generated/server";
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
  args: { token: v.string(), text: v.string() },
  handler: async (ctx, { token, text }) => {
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
      sender: "renter",
      text: t,
      at: Date.now(),
      readByOwner: false,
    });
    await ctx.scheduler.runAfter(0, internal.notify.renterChat, { email: a.email, text: t });
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
