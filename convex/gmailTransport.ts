"use node";

import { v } from "convex/values";
import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import nodemailer from "nodemailer";
import type { ActionCtx } from "./_generated/server";
import { action, internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { decryptGmailRefreshToken, BUSINESS_GMAIL_ADDRESS } from "../shared/gmailOAuth";
import { brandedEmailHtml } from "../shared/emailBrand";

function deliveryMessageId(deliveryKey: string): string {
  return `<rental-${createHash("sha256").update(deliveryKey).digest("hex")}@dbcinemarentals.com>`;
}

async function accessToken(ctx: ActionCtx): Promise<string> {
  const connection = await ctx.runQuery(internal.gmailConnection.getForWorker, {});
  if (!connection) throw new Error("Connect the DB Cinema business Gmail account first");
  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
  const encryptionKey = process.env.GMAIL_TOKEN_ENCRYPTION_KEY;
  if (!clientId || !clientSecret || !encryptionKey) throw new Error("Gmail OAuth is not configured on the server");
  const refreshToken = decryptGmailRefreshToken(connection.encryptedRefreshToken, encryptionKey);
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, refresh_token: refreshToken, grant_type: "refresh_token" }),
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw new Error(`Gmail access token refresh failed (${response.status})`);
  const tokens = await response.json() as { access_token?: unknown; token_type?: unknown };
  if (typeof tokens.access_token !== "string" || tokens.token_type !== "Bearer") throw new Error("Gmail access token response was invalid");
  return tokens.access_token;
}

async function gmailApi(token: string, path: string, init?: RequestInit) {
  const headers = new Headers(init?.headers);
  headers.set("authorization", `Bearer ${token}`);
  const response = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/${path}`, {
    ...init,
    headers,
    signal: init?.signal ?? AbortSignal.timeout(30_000),
  });
  return response;
}

function sendArgs() {
  return {
    mail: v.object({
      deliveryKey: v.optional(v.string()),
      promotional: v.optional(v.boolean()),
      cleanReturnRequired: v.optional(v.boolean()),
      from: v.optional(v.string()),
      to: v.string(),
      cc: v.optional(v.array(v.string())),
      subject: v.string(),
      html: v.string(),
      replyTo: v.optional(v.union(v.string(), v.array(v.string()))),
      inReplyTo: v.optional(v.string()),
      references: v.optional(v.array(v.string())),
      attachments: v.optional(v.array(v.object({ filename: v.string(), path: v.optional(v.string()), content: v.optional(v.string()) }))),
      providerThreadId: v.optional(v.string()),
    }),
  };
}

/** Single server-side send boundary for every customer and Gaffer email. */
export const send = internalAction({
  args: sendArgs(),
  handler: async (ctx, { mail }): Promise<{ sent: boolean; providerId?: string; messageId?: string }> => {
    try {
      const token = await accessToken(ctx);
      const messageId = mail.deliveryKey ? deliveryMessageId(mail.deliveryKey) : deliveryMessageId(randomUUID());

      // If a previous request reached Gmail but lost its response, check Sent
      // before retrying. Gmail does not provide a separate idempotency key.
      if (mail.deliveryKey) {
        const search = new URLSearchParams({ q: `in:sent rfc822msgid:${messageId}`, maxResults: "1" });
        const lookup = await gmailApi(token, `messages?${search}`);
        if (lookup.ok) {
          const found = await lookup.json() as { messages?: Array<{ id?: string }> };
          if (found.messages?.[0]?.id) return { sent: true, providerId: found.messages[0].id, messageId };
        }
      }

      const transport = nodemailer.createTransport({ streamTransport: true, buffer: true, newline: "unix" });
      const rendered = await transport.sendMail({
        messageId,
        from: `DB Cinema Rentals <${BUSINESS_GMAIL_ADDRESS}>`,
        to: mail.to,
        ...(mail.cc?.length ? { cc: mail.cc } : {}),
        subject: mail.subject,
        html: brandedEmailHtml(mail.html),
        replyTo: mail.replyTo ?? BUSINESS_GMAIL_ADDRESS,
        ...(mail.inReplyTo ? { inReplyTo: mail.inReplyTo } : {}),
        ...(mail.references?.length ? { references: mail.references } : {}),
        attachments: (mail.attachments ?? []).map((attachment) => attachment.content
          ? { filename: attachment.filename, content: attachment.content, encoding: "base64" as const }
          : { filename: attachment.filename, path: attachment.path }),
      });
      const rawMessage = (rendered as { message?: Buffer | string }).message;
      if (!rawMessage) throw new Error("MIME email could not be created");
      const raw = Buffer.from(rawMessage).toString("base64url");
      const response = await gmailApi(token, "messages/send", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ raw, ...(mail.providerThreadId ? { threadId: mail.providerThreadId } : {}) }),
      });
      if (!response.ok) {
        console.error(`[gmail] message send rejected (${response.status})`);
        return { sent: false };
      }
      const result = await response.json() as { id?: unknown };
      if (typeof result.id !== "string" || !result.id) return { sent: false };
      return { sent: true, providerId: result.id, messageId };
    } catch (error) {
      console.error("[gmail] message send failed:", String((error as any)?.message ?? error));
      return { sent: false };
    }
  },
});
/** Server-to-server send entry point for the Next voice worker. */
export const sendFromSite = action({
  args: { secret: v.string(), ...sendArgs() },
  handler: async (ctx, args): Promise<{ sent: boolean; providerId?: string; messageId?: string }> => {
    const expected = process.env.INBOUND_EMAIL_SECRET ?? "";
    const provided = Buffer.from(args.secret);
    const configured = Buffer.from(expected);
    if (!expected || provided.length !== configured.length || !timingSafeEqual(provided, configured)) throw new Error("unauthorized");
    return await ctx.runAction(internal.gmailTransport.send, { mail: args.mail });
  },
});

export const status = internalAction({
  args: { messageId: v.string() },
  handler: async (ctx, { messageId }) => {
    const token = await accessToken(ctx);
    const response = await gmailApi(token, `messages/${encodeURIComponent(messageId)}?format=minimal`);
    if (response.status === 404) return { status: "not_found" };
    if (!response.ok) return { status: "unknown" };
    const value = await response.json() as { labelIds?: string[] };
    return { status: value.labelIds?.includes("SENT") ? "sent" : "unknown" };
  },
});

export const revoke = internalAction({
  args: {},
  handler: async (ctx) => {
    const connection = await ctx.runQuery(internal.gmailConnection.getForWorker, {});
    const encryptionKey = process.env.GMAIL_TOKEN_ENCRYPTION_KEY;
    if (!connection || !encryptionKey) return { revoked: true };
    const refreshToken = decryptGmailRefreshToken(connection.encryptedRefreshToken, encryptionKey);
    const response = await fetch("https://oauth2.googleapis.com/revoke", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ token: refreshToken }),
      signal: AbortSignal.timeout(15_000),
    });
    return { revoked: response.ok || response.status === 400 };
  },
});
