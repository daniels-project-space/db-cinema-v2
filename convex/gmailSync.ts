"use node";

import { v } from "convex/values";
import { internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { decryptGmailRefreshToken } from "../shared/gmailOAuth";

type GmailHistory = {
  id?: string;
  messagesAdded?: Array<{ message?: { id?: string; threadId?: string } }>;
};

async function refreshAccessToken(refreshToken: string) {
  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
  if (!clientId || !clientSecret) throw new Error("Gmail OAuth client is not configured");
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, refresh_token: refreshToken, grant_type: "refresh_token" }),
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw new Error(`Gmail access token refresh failed (${response.status})`);
  const body = await response.json() as { access_token?: unknown; token_type?: unknown };
  if (typeof body.access_token !== "string" || body.token_type !== "Bearer") throw new Error("Gmail access token response was invalid");
  return body.access_token;
}

async function gmailApi(token: string, path: string) {
  const response = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/${path}`, {
    headers: { authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(25_000),
  });
  if (!response.ok) {
    if (response.status === 404 && path.startsWith("history?")) throw new Error("History checkpoint expired; reconnect Gmail to resume syncing.");
    throw new Error(`Gmail API request failed (${response.status})`);
  }
  return response.json() as Promise<any>;
}

function decodeHeader(value: string) {
  return value.replace(/=\?([^?]+)\?([bq])\?([^?]+)\?=/gi, (_whole, _charset: string, encoding: string, data: string) => {
    try {
      if (encoding.toLowerCase() === "b") return Buffer.from(data, "base64").toString("utf8");
      return data.replace(/_/g, " ").replace(/=([0-9a-f]{2})/gi, (_m, hex: string) => String.fromCharCode(parseInt(hex, 16)));
    } catch { return ""; }
  });
}

function header(headers: Array<{ name?: string; value?: string }> | undefined, name: string) {
  return headers?.find((entry) => entry.name?.toLowerCase() === name.toLowerCase())?.value?.trim() ?? "";
}

function address(value: string) {
  return value.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0]?.toLowerCase() ?? "";
}

function displayName(value: string) {
  const before = value.match(/^\s*"?([^"<]+?)"?\s*<[^>]+>/)?.[1]?.trim();
  return before ? decodeHeader(before) : undefined;
}

function bodyParts(payload: any, output: { plain: string[]; html: string[] }) {
  if (payload?.mimeType === "text/plain" && payload.body?.data) output.plain.push(Buffer.from(payload.body.data, "base64url").toString("utf8"));
  if (payload?.mimeType === "text/html" && payload.body?.data) output.html.push(Buffer.from(payload.body.data, "base64url").toString("utf8"));
  for (const part of payload?.parts ?? []) bodyParts(part, output);
}

function htmlToText(html: string) {
  return html
    .replace(/<\s*(script|style)[^>]*>[\s\S]*?<\/\s*\1\s*>/gi, " ")
    .replace(/<\s*br\s*\/?\s*>|<\/\s*(?:p|div|li|tr|h[1-6])\s*>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;|&#160;/gi, " ").replace(/&amp;/gi, "&").replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">").replace(/&quot;/gi, '"').replace(/&#39;|&apos;/gi, "'")
    .replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

async function loadNextHistoryPage(token: string, startHistoryId: string, pageToken?: string) {
  const params = new URLSearchParams({ startHistoryId, historyTypes: "messageAdded", maxResults: "100" });
  if (pageToken) params.set("pageToken", pageToken);
  const result = await gmailApi(token, `history?${params}`) as { history?: GmailHistory[]; historyId?: string; nextPageToken?: string };
  const ids = [...new Set((result.history ?? []).flatMap((entry) => (entry.messagesAdded ?? []).map((added) => added.message?.id).filter((id): id is string => !!id)))];
  return { ids, pageToken: result.nextPageToken, targetHistoryId: result.historyId ?? startHistoryId };
}

async function processMessage(token: string, messageId: string) {
  const message = await gmailApi(token, `messages/${encodeURIComponent(messageId)}?format=full`) as any;
  if (!Array.isArray(message.labelIds) || !message.labelIds.includes("INBOX")) return;
  const headers = message.payload?.headers as Array<{ name?: string; value?: string }> | undefined;
  const autoSubmitted = header(headers, "auto-submitted").toLowerCase();
  const precedence = header(headers, "precedence").toLowerCase();
  if ((autoSubmitted && autoSubmitted !== "no") || /^(bulk|list|junk)$/.test(precedence)) return;

  const rawFrom = header(headers, "from");
  const from = address(rawFrom);
  const recipient = address(header(headers, "delivered-to")) || address(header(headers, "to"));
  const textParts = { plain: [] as string[], html: [] as string[] };
  bodyParts(message.payload, textParts);
  const text = textParts.plain.join("\n\n").trim() || htmlToText(textParts.html.join("\n"));
  const subject = decodeHeader(header(headers, "subject")).replace(/[\r\n\t]+/g, " ").trim().slice(0, 500) || "Customer rental enquiry";
  const inReplyTo = header(headers, "in-reply-to") || undefined;
  const references = (header(headers, "references").match(/<[^>]+>|[^\s,]+/g) ?? []).slice(-20);
  const messageIdHeader = header(headers, "message-id") || undefined;
  const name = displayName(rawFrom);
  if (!from || !recipient || !text) return;

  const inboundSecret = process.env.INBOUND_EMAIL_SECRET;
  const appUrl = process.env.APP_URL;
  if (!inboundSecret || !appUrl) throw new Error("Gmail inbound worker is not configured");
  const response = await fetch(new URL("/api/email/inbound", appUrl), {
    method: "POST",
    headers: { authorization: `Bearer ${inboundSecret}`, "content-type": "application/json" },
    body: JSON.stringify({
      source: "gmail",
      message: {
        providerId: `gmail:${message.id}`,
        providerThreadId: message.threadId,
        messageId: messageIdHeader,
        inReplyTo,
        references,
        from,
        name,
        to: recipient,
        subject,
        text,
      },
    }),
    signal: AbortSignal.timeout(190_000),
  });
  if (!response.ok) throw new Error(`Gaffer did not complete Gmail message ${messageId} (${response.status})`);
}

export const sync = internalAction({
  args: {},
  handler: async (ctx): Promise<{ synced: number; busy?: boolean }> => {
    const claim = await ctx.runMutation(internal.gmailConnection.claimSync, {});
    if (!claim) return { synced: 0, busy: true };
    let processed = 0;
    try {
      const connection = await ctx.runQuery(internal.gmailConnection.getForWorker, {});
      const encryptionKey = process.env.GMAIL_TOKEN_ENCRYPTION_KEY;
      if (!connection || !encryptionKey) throw new Error("Gmail connection is unavailable");
      const token = await refreshAccessToken(decryptGmailRefreshToken(connection.encryptedRefreshToken, encryptionKey));
      let startHistoryId = claim.syncStartHistoryId ?? claim.historyId;
      let pageToken = claim.syncPageToken;
      let pending = claim.syncPendingMessageIds ?? [];
      let targetHistoryId = claim.syncTargetHistoryId;

      while (processed < 1) {
        if (!pending.length && targetHistoryId && !pageToken) {
          await ctx.runMutation(internal.gmailConnection.finishSync, { historyId: targetHistoryId });
          return { synced: processed };
        }
        if (!pending.length) {
          const page = await loadNextHistoryPage(token, startHistoryId, pageToken);
          pending = page.ids;
          pageToken = page.pageToken;
          targetHistoryId = page.targetHistoryId;
          await ctx.runMutation(internal.gmailConnection.saveSyncBatch, {
            startHistoryId,
            pageToken,
            pendingMessageIds: pending,
            targetHistoryId,
          });
          if (!pending.length && !pageToken) {
            await ctx.runMutation(internal.gmailConnection.finishSync, { historyId: targetHistoryId });
            return { synced: processed };
          }
          if (!pending.length) continue;
        }
        const messageId = pending[0];
        await processMessage(token, messageId);
        await ctx.runMutation(internal.gmailConnection.acknowledgeSyncMessage, { messageId });
        pending = pending.slice(1);
        processed++;
      }
      if (!pending.length && !pageToken && targetHistoryId) {
        await ctx.runMutation(internal.gmailConnection.finishSync, { historyId: targetHistoryId });
      } else {
        await ctx.runMutation(internal.gmailConnection.finishSync, { keepPage: true });
      }
      return { synced: processed };
    } catch (error) {
      const message = String((error as any)?.message ?? error);
      console.error("[gmail sync] failed:", message);
      await ctx.runMutation(internal.gmailConnection.finishSync, { error: message });
      throw error;
    }
  },
});
