"use node";

import { createHash } from "node:crypto";
import nodemailer from "nodemailer";
import { brandedEmailHtml } from "../../shared/emailBrand";

/**
 * The one place email leaves this app.
 *
 * Two transports, because the "From" address decides which one can be used:
 *
 *  - GMAIL — sends ordinary transactional mail through Google's SMTP when an
 *    app password is configured.
 *  - RESEND — the website's verified dbcinemarentals.com sender. It handles
 *    ordinary mail as a fallback and all admin/Gaffer replies, with the
 *    business Gmail mailbox as Reply-To.
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
  deliveryKey?: string;
  promotional?: boolean;
  cleanReturnRequired?: boolean;
  from?: string;
  to: string;
  cc?: string[];
  subject: string;
  html: string;
  /** Defaults to the owner address; set per-send to thread a reply elsewhere. */
  replyTo?: string;
  inReplyTo?: string;
  references?: string[];
  attachments?: MailAttachment[];
};

export function deliveryMessageId(deliveryKey: string): string {
  return `<rental-${createHash("sha256").update(deliveryKey).digest("hex")}@dbcinemarentals.com>`;
}

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
      connectionTimeout: 20_000, greetingTimeout: 20_000, socketTimeout: 60_000,
      auth: { user, pass },
    });
    const result = await transport.sendMail({
      ...(m.deliveryKey ? { messageId: deliveryMessageId(m.deliveryKey) } : {}),
      from: m.from?.trim() || `${FROM_NAME} <${user}>`,
      to: m.to,
      ...(m.cc?.length ? { cc: m.cc } : {}),
      subject: m.subject,
      html: brandedEmailHtml(m.html),
      replyTo: m.replyTo ?? OWNER_EMAIL(),
      ...(m.inReplyTo ? { inReplyTo: m.inReplyTo } : {}),
      ...(m.references?.length ? { references: m.references } : {}),
      attachments: (m.attachments ?? []).map((a) =>
        a.content
          ? { filename: a.filename, content: a.content, encoding: "base64" as const }
          : { filename: a.filename, path: a.path },
      ),
    });
    return result.accepted.length > 0;
  } catch (e) {
    console.error("[mail] gmail smtp send failed:", String((e as any)?.message ?? e));
    return false;
  }
}

async function viaResend(m: MailInput, key: string): Promise<boolean> {
  const from = m.from?.trim() || process.env.RESEND_FROM || `${FROM_NAME} <onboarding@resend.dev>`;
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { authorization: `Bearer ${key}`, "content-type": "application/json", ...(m.deliveryKey ? {"Idempotency-Key":m.deliveryKey} : {}) },
      signal: AbortSignal.timeout(60_000),
      body: JSON.stringify({
        from,
        to: m.to,
        ...(m.cc?.length ? { cc: m.cc } : {}),
        subject: m.subject,
        html: brandedEmailHtml(m.html),
        reply_to: m.replyTo ?? OWNER_EMAIL(),
        ...(m.inReplyTo || m.references?.length ? { headers: {
          ...(m.inReplyTo ? { "In-Reply-To": m.inReplyTo } : {}),
          ...(m.references?.length ? { References: m.references.join(" ") } : {}),
        } } : {}),
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
    console.error("[mail] no transport configured — set GMAIL_USER and GMAIL_APP_PASSWORD, or RESEND_API_KEY");
    return false;
  }
  return viaResend(m, key);
}

function configuredBusinessSender() {
  const from = process.env.RESEND_FROM?.trim();
  if (!from) return null;
  const email = from.match(/<([^>]+)>/)?.[1]?.trim() ?? from;
  if (!/^[^@\s]+@dbcinemarentals\.com$/i.test(email)) return null;
  return { from, email: email.toLowerCase() };
}

/**
 * Website replies use the verified DB Cinema domain through Resend. The Gmail
 * connection inside ChatGPT is not a backend credential, and SMTP app
 * passwords should not be required for Gaffer to answer customers.
 */
export async function sendBusinessMail(m: MailInput): Promise<boolean> {
  const key = process.env.RESEND_API_KEY?.trim();
  const sender = configuredBusinessSender();
  if (!key || !sender) {
    console.error("[mail] business Resend sender is not configured for dbcinemarentals.com");
    return false;
  }
  return viaResend({ ...m, from: sender.from, replyTo: m.replyTo ?? OWNER_EMAIL() }, key);
}
