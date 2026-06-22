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
  const replyTo = process.env.OWNER_EMAIL ?? "dbcinemaproductions@gmail.com";
  try {
    await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        authorization: `Bearer ${key}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ from, to, subject, html, reply_to: replyTo }),
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

/** Emails the renter when their ID-verification status changes (verified / needs-retry). */
export const verificationEmail = internalAction({
  args: { bookingId: v.id("bookings"), status: v.string() },
  handler: async (ctx, { bookingId, status }) => {
    const b: any = await ctx.runQuery(api.bookings.get, { bookingId });
    if (!b || !b.guestEmail) return;
    const app = process.env.APP_URL ?? "https://dbcinemarentals.com";
    const items = (b.lineItems ?? []).map((li: any) => li.title).join(", ");
    if (status === "verified") {
      await email(
        b.guestEmail,
        "Your ID is verified ✓ — you're all set",
        `<h2>ID verified ✓</h2><p>Thanks — your identity check passed${items ? ` for <b>${items}</b>` : ""}. You're all set; we'll be in touch about handover.</p><p>View your booking any time in <a href="${app}/account">your account</a>.</p>`,
      );
    } else {
      const label: Record<string, string> = {
        requires_input: "needs another try",
        processing: "is still processing",
        canceled: "was cancelled",
      };
      await email(
        b.guestEmail,
        "Action needed: verify your ID for your Db Cinema rental",
        `<h2>ID verification ${label[status] ?? "update"}</h2><p>Your identity check ${label[status] ?? "needs attention"}. Please complete it so we can hand over your gear:</p><p><a href="${app}/account">Verify your ID →</a></p>${items ? `<p style="color:#888">Booking: ${items}</p>` : ""}`,
      );
    }
  },
});

/** Emails the renter when their booking is cancelled (refund or store-credit summary). */
export const cancellationEmail = internalAction({
  args: { bookingId: v.id("bookings"), mode: v.string(), refundAmount: v.number(), creditAmount: v.number() },
  handler: async (ctx, { bookingId, mode, refundAmount, creditAmount }) => {
    const b: any = await ctx.runQuery(api.bookings.get, { bookingId });
    if (!b || !b.guestEmail) return;
    const items = (b.lineItems ?? []).map((li: any) => li.title).join(", ");
    const detail =
      mode === "credit"
        ? `<p>Your deposit has been refunded to your card, and <b>£${creditAmount} store credit</b> (valid 90 days) has been added to your account.</p>`
        : mode === "refund"
          ? `<p><b>£${refundAmount}</b> has been refunded to your card.</p>`
          : `<p>No payment had been taken, so there's nothing to refund.</p>`;
    await email(
      b.guestEmail,
      "Your Db Cinema booking is cancelled",
      `<h2>Booking cancelled</h2><p>Your booking${items ? ` for <b>${items}</b>` : ""} has been cancelled.</p>${detail}<p style="color:#888">Questions? Just reply to this email.</p>`,
    );
  },
});

/** Emails the renter when a reschedule/extend is applied. */
export const changeEmail = internalAction({
  args: { bookingId: v.id("bookings"), kind: v.string(), detail: v.optional(v.string()) },
  handler: async (ctx, { bookingId, kind, detail }) => {
    const b: any = await ctx.runQuery(api.bookings.get, { bookingId });
    if (!b || !b.guestEmail) return;
    const app = process.env.APP_URL ?? "https://dbcinemarentals.com";
    const subj = kind === "rescheduled" ? "Your Db Cinema rental has been rescheduled" : "Your Db Cinema rental was updated";
    await email(
      b.guestEmail,
      subj,
      `<h2>Rental updated</h2><p>Your rental has been <b>${kind}</b>${detail ? ` — ${detail}` : ""}.</p><p>See it any time in <a href="${app}/account">your account</a>.</p>`,
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

/** A lead from the Gaffer voice agent — emailed to the owner + Telegram. */
export const ownerLead = internalAction({
  args: {
    kind: v.string(),
    name: v.string(),
    phone: v.optional(v.string()),
    email: v.optional(v.string()),
    message: v.string(),
  },
  handler: async (_ctx, a) => {
    const owner = process.env.OWNER_EMAIL ?? "dbcinemaproductions@gmail.com";
    const who = `${a.name}${a.phone ? ` · ${a.phone}` : ""}${a.email ? ` · ${a.email}` : ""}`;
    await email(
      owner,
      `📞 Gaffer voice — ${a.kind}: ${a.name}`,
      `<h2>New ${a.kind} from the Gaffer phone line 🎬</h2>
       <p><b>${who}</b></p>
       <pre style="white-space:pre-wrap;font-family:inherit;font-size:14px">${a.message}</pre>
       <p style="color:#888">Captured automatically by Gaffer (voice). Reply to follow up.</p>`,
    );
    await telegram(`📞 <b>Gaffer voice · ${a.kind}</b>\n${who}\n\n${a.message}`);
  },
});

/** Daily-ish reminders: pickup tomorrow / return today (email + Telegram). */
export const sendReminders = internalAction({
  args: {},
  handler: async (ctx) => {
    const feed: any[] = await ctx.runQuery(internal.bookings.remindersFeed, {});
    const cfg: any = await ctx.runQuery(api.settings.get, {});
    const today = new Date().toISOString().slice(0, 10);
    const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
    const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
    let sent = 0;
    for (const b of feed) {
      const startDay = new Date(b.start).toISOString().slice(0, 10);
      const endDay = new Date(b.end).toISOString().slice(0, 10);

      // day after return → ask for a Google review (drives local-SEO review velocity)
      if (endDay === yesterday && !b.remindedReview && cfg.googleReviewUrl) {
        await email(
          b.guestEmail,
          "How was your Db Cinema rental? ⭐",
          `<p>Thanks for renting with us! If it went well, a quick Google review really helps us out:</p><p><a href="${cfg.googleReviewUrl}">Leave a review →</a></p><p>${b.summary}</p>`,
        );
        if (b.accountId)
          await ctx.runMutation(internal.chat.postSystem, {
            accountId: b.accountId,
            bookingId: b._id,
            text: `Hope the shoot went well! 🎬 If you have a sec, we'd love a quick review: ${cfg.googleReviewUrl}`,
          });
        await ctx.runMutation(internal.bookings.markReminded, { bookingId: b._id, which: "review" });
        sent++;
      }
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
