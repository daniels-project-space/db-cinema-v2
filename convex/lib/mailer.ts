"use node";

import nodemailer from "nodemailer";

/**
 * The one place email leaves this app.
 *
 * Two transports, because the "From" address decides which one can be used:
 *
 *  - GMAIL — sends through Google's own SMTP as dbcinemarentals@gmail.com, so
 *    that address is genuinely the sender rather than a reply-to bolted onto
 *    someone else's domain. Needs GMAIL_USER + GMAIL_APP_PASSWORD (a Google
 *    App Password, not the account password — Google rejects the real one for
 *    SMTP). Preferred whenever both are set.
 *  - RESEND — the previous transport, kept as the fallback. It can only send
 *    from a domain verified in the Resend dashboard; asking it for a gmail.com
 *    sender returns a hard 403 ("The gmail.com domain is not verified"), which
 *    is exactly why the Gmail path above exists.
 *
 * Both callers previously swallowed every failure in a bare catch, so a
 * rejected send was indistinguishable from a delivered one — the contact form
 * looked fine while nothing arrived. Failures now log loudly and the caller
 * gets a boolean, while still never throwing into a booking flow.
 */

export type MailAttachment = {
  filename: string;
  /** A URL the provider fetches (used for the invoice PDF route). */
  path?: string;
  /** Base64 payload, when the bytes are already in hand. */
  content?: string;
};

export type MailInput = {
  to: string;
  subject: string;
  html: string;
  /** Defaults to the owner address; set per-send to thread a reply elsewhere. */
  replyTo?: string;
  attachments?: MailAttachment[];
};

export const OWNER_EMAIL = () => process.env.OWNER_EMAIL ?? "dbcinemarentals@gmail.com";
const FROM_NAME = "Db Cinema Rentals";

/** Gmail SMTP. Created per send — Convex actions are short-lived, so a pooled
 * transport would be torn down before it paid for itself. */
async function viaGmail(m: MailInput, user: string, pass: string): Promise<boolean> {
  try {
    const transport = nodemailer.createTransport({
      host: "smtp.gmail.com",
      port: 465,
      secure: true,
      auth: { user, pass },
    });
    await transport.sendMail({
      from: `${FROM_NAME} <${user}>`,
      to: m.to,
      subject: m.subject,
      html: m.html,
      replyTo: m.replyTo ?? OWNER_EMAIL(),
      attachments: (m.attachments ?? []).map((a) =>
        a.content
          ? { filename: a.filename, content: a.content, encoding: "base64" as const }
          : { filename: a.filename, path: a.path },
      ),
    });
    return true;
  } catch (e) {
    console.error("[mail] gmail smtp send failed:", String((e as any)?.message ?? e));
    return false;
  }
}

async function viaResend(m: MailInput, key: string): Promise<boolean> {
  const from = process.env.RESEND_FROM ?? `${FROM_NAME} <onboarding@resend.dev>`;
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
      body: JSON.stringify({
        from,
        to: m.to,
        subject: m.subject,
        html: m.html,
        reply_to: m.replyTo ?? OWNER_EMAIL(),
        ...(m.attachments?.length ? { attachments: m.attachments } : {}),
      }),
    });
    if (!res.ok) {
      console.error(`[mail] resend rejected ${res.status}:`, (await res.text()).slice(0, 300));
      return false;
    }
    return true;
  } catch (e) {
    console.error("[mail] resend send failed:", String((e as any)?.message ?? e));
    return false;
  }
}

export async function sendMail(m: MailInput): Promise<boolean> {
  const user = process.env.GMAIL_USER;
  const pass = process.env.GMAIL_APP_PASSWORD;
  if (user && pass) {
    if (await viaGmail(m, user, pass)) return true;
    // Gmail is the intended sender, but a bounced credential must not silently
    // eat a booking confirmation — fall through to Resend if it is configured.
    console.error("[mail] falling back to resend after a gmail failure");
  }
  const key = process.env.RESEND_API_KEY;
  if (!key) {
    console.error("[mail] no transport configured — set GMAIL_APP_PASSWORD or RESEND_API_KEY");
    return false;
  }
  return viaResend(m, key);
}
