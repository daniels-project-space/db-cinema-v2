"use node";

import { createHash } from "node:crypto";
import { brandedEmailHtml } from "../../shared/emailBrand";
import { BUSINESS_CONTACT_EMAIL, isBusinessSender } from "../../shared/businessEmail";

/**
 * The one place email leaves this app.
 *
 * Every customer and operator message uses the verified DB Cinema sender on
 * Resend. Replies go to the monitored business Gmail mailbox unless a message
 * is explicitly threaded to a customer or Gaffer reply address. A ChatGPT
 * Gmail connection or SMTP password is never treated as a website credential.
 *
 * Callers previously swallowed every failure in a bare catch, so a
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
  text?: string;
  /** Defaults to the owner address; set per-send to thread a reply elsewhere. */
  replyTo?: string;
  inReplyTo?: string;
  references?: string[];
  attachments?: MailAttachment[];
};

export function deliveryMessageId(deliveryKey: string): string {
  return `<rental-${createHash("sha256").update(deliveryKey).digest("hex")}@dbcinemarentals.com>`;
}

export const OWNER_EMAIL = () => BUSINESS_CONTACT_EMAIL;

async function viaResend(m: MailInput, key: string): Promise<{ sent: boolean; resendEmailId?: string; ambiguous?: boolean }> {
  const from = m.from?.trim() || process.env.RESEND_FROM?.trim();
  if (!from || !isBusinessSender(from)) {
    console.error("[mail] refusing customer mail without the verified DB Cinema sender");
    return { sent: false };
  }
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
        ...(m.text ? { text: m.text } : {}),
        reply_to: m.replyTo ?? OWNER_EMAIL(),
        ...(m.inReplyTo || m.references?.length ? { headers: {
          ...(m.inReplyTo ? { "In-Reply-To": m.inReplyTo } : {}),
          ...(m.references?.length ? { References: m.references.join(" ") } : {}),
        } } : {}),
        ...(m.attachments?.length ? { attachments: m.attachments } : {}),
      }),
    });
    if (!res.ok) {
      let detail = "";
      try { detail = (await res.text()).slice(0, 300); } catch { /* response status still classifies the outcome */ }
      console.error(`[mail] resend rejected ${res.status}:`, detail);
      // A received 4xx is a definite rejection except an in-flight duplicate
      // request; 408 and 5xx can arrive after the provider accepted the send.
      return { sent: false, ambiguous: res.status === 408 || res.status === 409 || res.status >= 500 };
    }
    let result: any = null;
    try { result = await res.json(); } catch { /* a successful API status still means Resend accepted it */ }
    return { sent: true, ambiguous: false, ...(typeof result?.id === "string" && result.id.trim() ? { resendEmailId: result.id.trim() } : {}) };
  } catch (e) {
    console.error("[mail] resend send failed:", String((e as any)?.message ?? e));
    return { sent: false, ambiguous: true };
  }
}

export async function sendMail(m: MailInput): Promise<boolean> {
  return sendBusinessMail(m);
}

function configuredBusinessSender() {
  const from = process.env.RESEND_FROM?.trim();
  if (!from) return null;
  const email = from.match(/<([^>]+)>/)?.[1]?.trim() ?? from;
  if (!isBusinessSender(email)) return null;
  return { from, email: email.toLowerCase() };
}

/**
 * All website messages use the verified DB Cinema domain through Resend.
 * ChatGPT's Gmail connection is not a backend credential.
 */
export async function sendBusinessMailTracked(m: MailInput): Promise<{ sent: boolean; resendEmailId?: string; ambiguous?: boolean }> {
  const key = process.env.RESEND_API_KEY?.trim();
  const sender = configuredBusinessSender();
  if (!key || !sender) {
    console.error("[mail] business Resend sender is not configured for dbcinemarentals.com");
    return { sent: false, ambiguous: false };
  }
  return viaResend({ ...m, from: sender.from, replyTo: m.replyTo ?? OWNER_EMAIL() }, key);
}

export async function sendBusinessMail(m: MailInput): Promise<boolean> {
  return (await sendBusinessMailTracked(m)).sent;
}
