import { internalAction } from "./_generated/server";
import { api, internal } from "./_generated/api";
import { v } from "convex/values";

const day = (ms: number) => new Date(ms).toISOString().slice(0, 10);

async function telegram(text: string) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chat = process.env.TELEGRAM_ADMIN_CHAT_ID;
  if (!token || !chat) return;
  try {
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chat_id: chat, text, parse_mode: "HTML" }),
    });
  } catch {
    /* best-effort */
  }
}

async function email(to: string, subject: string, html: string) {
  const key = process.env.RESEND_API_KEY;
  if (!key) return; // email disabled until a Resend key is set
  const from = process.env.RESEND_FROM ?? "Db Cinema <onboarding@resend.dev>";
  try {
    await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        authorization: `Bearer ${key}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ from, to, subject, html }),
    });
  } catch {
    /* best-effort */
  }
}

export const bookingAlert = internalAction({
  args: { bookingId: v.id("bookings") },
  handler: async (ctx, { bookingId }) => {
    const b: any = await ctx.runQuery(api.bookings.get, { bookingId });
    if (!b) return;
    const lines = b.lineItems
      .map(
        (li: any) =>
          `• ${li.title} (${day(li.start)}→${day(li.end)}) £${li.lineTotal}`,
      )
      .join("\n");
    await telegram(
      `🎬 <b>New booking</b>\n${b.guestEmail}\n${b.fulfilment}\n${lines}\n<b>£${b.total}</b> (incl £${b.depositAmount} deposit)`,
    );
    await email(
      b.guestEmail,
      "Your Db Cinema booking is confirmed",
      `<h2>Booking confirmed 🎬</h2><p>Thanks for renting with Db Cinema.</p>
       <pre>${lines}</pre>
       <p>Total paid: <b>£${b.total}</b> (incl. £${b.depositAmount} refundable deposit)</p>
       <p>Fulfilment: ${b.fulfilment}</p>`,
    );
  },
});

export const contactAlert = internalAction({
  args: { name: v.string(), email: v.string(), message: v.string() },
  handler: async (ctx, a) => {
    await telegram(
      `✉️ <b>New contact message</b>\nFrom: ${a.name} (${a.email})\n\n${a.message}`,
    );
  },
});

/** Daily-ish reminders: pickup tomorrow / return today (email + Telegram). */
export const sendReminders = internalAction({
  args: {},
  handler: async (ctx) => {
    const feed: any[] = await ctx.runQuery(internal.bookings.remindersFeed, {});
    const today = new Date().toISOString().slice(0, 10);
    const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
    let sent = 0;
    for (const b of feed) {
      const startDay = new Date(b.start).toISOString().slice(0, 10);
      const endDay = new Date(b.end).toISOString().slice(0, 10);
      if (startDay === tomorrow && !b.remindedPickup) {
        await email(
          b.guestEmail,
          "Your Db Cinema pickup is tomorrow 🎬",
          `<p>Quick reminder — your rental ${b.fulfilment === "delivery" ? "delivery" : "pickup"} is <b>tomorrow</b>${b.pickupTime ? " at " + b.pickupTime : ""}.</p><p>${b.summary}</p><p>Windows: 10:00–12:00 and 19:00–21:00.</p>`,
        );
        await telegram(`⏰ <b>Pickup tomorrow</b>\n${b.guestEmail} ${b.pickupTime ?? ""}\n${b.summary}`);
        await ctx.runMutation(internal.bookings.markReminded, { bookingId: b._id, which: "pickup" });
        sent++;
      }
      if (endDay === today && !b.remindedReturn) {
        await email(
          b.guestEmail,
          "Your Db Cinema return is due today",
          `<p>Reminder — your rental return is <b>due today</b>${b.returnTime ? " at " + b.returnTime : ""}. Late returns are charged per extra day.</p><p>${b.summary}</p>`,
        );
        await telegram(`⏰ <b>Return due today</b>\n${b.guestEmail} ${b.returnTime ?? ""}\n${b.summary}`);
        await ctx.runMutation(internal.bookings.markReminded, { bookingId: b._id, which: "return" });
        sent++;
      }
    }
    return { checked: feed.length, sent };
  },
});

/** Forward a renter chat message to the owner/bot via Telegram. */
export const renterChat = internalAction({
  args: { email: v.string(), text: v.string() },
  handler: async (_ctx, { email, text }) => {
    await telegram(`💬 <b>Renter message</b>\nFrom: ${email}\n\n${text}`);
  },
});
