import { internalAction } from "./_generated/server";
import { api } from "./_generated/api";
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
