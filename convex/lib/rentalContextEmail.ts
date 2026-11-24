import { internal } from "../_generated/api";
import { sendBusinessMailTracked, type MailInput } from "./mailer";

type RentalContextEmailResult = {
  sent: boolean;
  state: "sent" | "failed" | "uncertain" | "busy" | "untracked";
};

export function auditMessageText(mail: MailInput) {
  const rendered = mail.text?.trim() || mail.html
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, " ")
    .replace(/<\/(p|div|li|h[1-6])\s*>/gi, "\n")
    .replace(/<br\s*\/?\s*>/gi, "\n")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return rendered
    .replace(/https?:\/\/[^\s<>"')\]]+/gi, "[link omitted]")
    .replace(/\b((?:(?:verification|sign[ -]?in|login|one[- ]time|access|recovery)\s+)?(?:code|token|key|secret)\s*[:#=]\s*)[A-Za-z0-9._~+-]{4,}\b/gi, "$1[redacted]")
    .replace(/\s+\n/g, "\n")
    .trim()
    .slice(0, 12_000);
}

/**
 * Sends a booking-bound transactional message only after the exact booking,
 * current renter address, reply capability and durable inbox row are claimed.
 * Never falls back to a sender-only support email when that association fails.
 */
export async function sendRentalContextEmail(
  ctx: any,
  bookingId: any,
  deliveryKey: string,
  mail: MailInput,
): Promise<RentalContextEmailResult> {
  const text = auditMessageText(mail);
  const prepared: any = await ctx.runMutation(internal.emailInbox.prepareRentalContextEmail, {
    bookingId,
    deliveryKey,
    recipientEmail: mail.to,
    subject: mail.subject,
    text,
  });
  if (!prepared?.ok) return { sent: false, state: "untracked" };
  if (prepared.state === "sent") return { sent: true, state: "sent" };
  if (prepared.state !== "claimed") return { sent: false, state: prepared.state };

  const sent = await sendBusinessMailTracked({
    ...mail,
    deliveryKey: prepared.providerId,
    replyTo: prepared.replyTo,
  });
  const result = sent.sent ? "sent" : sent.ambiguous ? "uncertain" : "failed";
  const recorded = await ctx.runMutation(internal.emailInbox.finishRentalContextEmail, {
    bookingId,
    providerId: prepared.providerId,
    result,
    ...(sent.resendEmailId ? { resendEmailId: sent.resendEmailId } : {}),
  });
  if (!recorded) return { sent: false, state: "uncertain" };
  return { sent: sent.sent, state: result };
}
