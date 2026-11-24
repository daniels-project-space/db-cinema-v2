"use node";

import { createHash } from "node:crypto";
import { internal } from "../_generated/api";

/**
 * The one place email leaves this app.
 *
 * All site mail uses the connected business Gmail account. The credentials and
 * Google API calls live behind gmailTransport; callers never receive a token.
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
  replyTo?: string | string[];
  inReplyTo?: string;
  references?: string[];
  attachments?: MailAttachment[];
  /** Gmail's thread handle, required for replies to appear in the same Gmail conversation. */
  providerThreadId?: string;
};

/** Shared customer-support sender for Gaffer email replies. */
export const supportEmailFrom = () =>
  process.env.SUPPORT_EMAIL_FROM?.trim() || "Bookings <bookings@dbcinemarentals.com>";

export function deliveryMessageId(deliveryKey: string): string {
  return `<rental-${createHash("sha256").update(deliveryKey).digest("hex")}@dbcinemarentals.com>`;
}

export const OWNER_EMAIL = () => process.env.OWNER_EMAIL ?? "info@dbcinemarentals.com";

export async function sendMail(
  ctx: any,
  m: MailInput,
  onReceipt?: (id: string) => void,
  onTransport?: (provider: "gmail") => void,
): Promise<boolean> {
  try {
    const mail = JSON.parse(JSON.stringify(m)) as MailInput;
    const result = await ctx.runAction(internal.gmailTransport.send, { mail });
    if (!result?.sent) return false;
    if (typeof result.providerId === "string") onReceipt?.(`gmail:${result.providerId}`);
    onTransport?.("gmail");
    return true;
  } catch (error) {
    console.error("[mail] Gmail delivery action failed:", String((error as any)?.message ?? error));
    return false;
  }
}
