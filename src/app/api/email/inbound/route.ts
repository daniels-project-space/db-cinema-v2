import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { ConvexHttpClient } from "convex/browser";
import { api } from "@cvx/_generated/api";
import { handleChat } from "@/lib/gaffer";
import { CONTACT_EMAIL } from "@/lib/site";
import { formatGafferEmailReply, hasSpecificModelQuoteMismatch, isHumanHandoffRequested, newTextOnly, plainBody, recipientCandidates, replyKeyFrom, senderFrom } from "@/lib/inboundEmail";
import { minimumRentalBasketLines } from "../../../../../shared/gafferEmailQuote";

export const runtime = "nodejs";
export const maxDuration = 180;
export const dynamic = "force-dynamic";

const OWNER_EMAIL = "info@dbcinemarentals.com";

function headerValue(headers: any, key: string): string {
  if (!headers) return "";
  if (Array.isArray(headers)) {
    const match = headers.find((entry) => String(entry?.name ?? "").toLowerCase() === key.toLowerCase());
    return typeof match?.value === "string" ? match.value : "";
  }
  const value = headers[key] ?? headers[key.toLowerCase()] ?? headers[key.toUpperCase()];
  return Array.isArray(value) ? value.join(" ") : typeof value === "string" ? value : "";
}

function htmlToText(html: string): string {
  return String(html ?? "")
    .replace(/<\s*(script|style)[^>]*>[\s\S]*?<\/\s*\1\s*>/gi, " ")
    .replace(/<\s*br\s*\/?>|<\/(?:p|div|li|tr|h[1-6])\s*>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function nameFrom(rawFrom: unknown): string | undefined {
  if (typeof rawFrom !== "string") return undefined;
  const match = rawFrom.match(/^\s*([^<]+?)\s*<[^>]+>\s*$/);
  return match?.[1]?.replace(/^"|"$/g, "").trim() || undefined;
}

function addressList(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(addressList);
  if (typeof value !== "string") return [];
  return value.split(/[;,]/).map((part) => {
    const match = part.match(/<([^>]+)>/);
    return (match?.[1] ?? part).trim().toLowerCase();
  }).filter((part) => part.includes("@"));
}

function referencesFrom(headers: any, field: string): string[] {
  return headerValue(headers, field).match(/<[^>]+>|[^\s,]+/g)?.filter(Boolean).slice(-20) ?? [];
}

type PriorEmailMessage = { providerId: string; subject: string; text: string; at: number };
type InboundEmail = {
  providerId: string;
  providerThreadId?: string;
  messageId?: string;
  inReplyTo?: string;
  references: string[];
  from: string;
  name?: string;
  to: string;
  subject: string;
  text: string;
  replyThreadId?: any;
  priorMessage?: PriorEmailMessage;
};

async function processGafferInboundEmail(message: InboundEmail) {
  const secret = process.env.INBOUND_EMAIL_SECRET;
  const url = process.env.NEXT_PUBLIC_CONVEX_URL;
  if (!secret || !url) return NextResponse.json({ error: "Inbound email storage is not configured." }, { status: 503 });
  if (!message.from || !message.text) return NextResponse.json({ ok: true, ignored: !message.from ? "no sender" : "empty body" });
  if (message.from === OWNER_EMAIL && !message.providerId.startsWith("contact-form:")) {
    return NextResponse.json({ ok: true, ignored: "self mail" });
  }

  const client = new ConvexHttpClient(url);
  let stored: any = null;
  let explicitlyRequestedHuman = false;
  try {
    stored = await client.mutation(api.emailInbox.ingest, {
      secret,
      providerId: message.providerId,
      ...(message.providerThreadId ? { providerThreadId: message.providerThreadId } : {}),
      references: message.references,
      from: message.from,
      to: message.to,
      subject: message.subject,
      text: message.text,
      ...(message.messageId ? { messageId: message.messageId } : {}),
      ...(message.inReplyTo ? { inReplyTo: message.inReplyTo } : {}),
      ...(message.replyThreadId ? { replyThreadId: message.replyThreadId } : {}),
      ...(message.priorMessage ? { priorMessage: message.priorMessage } : {}),
    });
    explicitlyRequestedHuman = isHumanHandoffRequested(message.subject, message.text);
    const claim: any = await client.mutation(api.emailInbox.claimInbound, {
      secret,
      inboundId: stored.inboundId,
      humanRequested: explicitlyRequestedHuman,
    });
    if (claim.state === "done") return NextResponse.json({ ok: true, duplicate: true });
    if (claim.state === "human_waiting") return NextResponse.json({ ok: true, humanRequested: true });
    // A 2xx acknowledges the provider event permanently. Keep it retryable
    // while another delivery owns the lease so a crashed worker cannot strand
    // this message in `processing` forever.
    if (claim.state === "busy") {
      return NextResponse.json(
        { error: "Email is still processing; retry this delivery." },
        { status: 503, headers: { "Retry-After": "120" } },
      );
    }

    const assistant = await handleChat({ messages: claim.history, channel: "email", emailSubject: message.subject });
    if (!assistant?.reply?.trim() || assistant.reply.includes("The assistant isn't configured yet.")) {
      throw new Error("Gaffer could not produce an email reply");
    }
    const customerEmailText = `${message.subject}\n${message.text}`;
    const humanRequested = explicitlyRequestedHuman || assistant.humanRequested === true ||
      hasSpecificModelQuoteMismatch(customerEmailText, assistant.enquiry);
    const quote = assistant.enquiry;
    const completeQuoteResolved = Boolean(quote?.timed && quote.start && quote.end && quote.complete && quote.stockVerified);
    const resolvedInquiry = !humanRequested && (assistant.resolvedInquiry === true || completeQuoteResolved);
    if (humanRequested) {
      await client.mutation(api.emailInbox.markHumanRequested, { secret, inboundId: stored.inboundId });
    }
    let preparedBasketUrl: string | undefined;
    const proposedLines = quote ? minimumRentalBasketLines(quote) : null;
    if (quote?.timed && quote.start && quote.end && ((quote.complete && quote.stockVerified) || proposedLines)) {
      const lines = proposedLines ?? quote.requests.flatMap(request => request.lines.flatMap(line =>
        Array.from({ length: Math.min(100, line.quantity) }, () => ({ listingId: line.listingId as any, start: Date.parse(quote.start + "T00:00:00Z"), end: Date.parse(quote.end + "T00:00:00Z"), pickupTime: quote.pickupTime, returnTime: quote.returnTime }))));
      if (lines.length && lines.length <= 100) {
        const shareKey = createHmac("sha256", secret).update(`email-cart:${stored.inboundId}`).digest("base64url");
        await client.mutation(api.emailInbox.prepareQuotedCart, { secret, inboundId: stored.inboundId, shareKey, lines: lines.map(line => ({ ...line, listingId: line.listingId as any })) });
        preparedBasketUrl = `https://dbcinemarentals.com/cart/quote/${shareKey}`;
      }
    }
    const replyText = formatGafferEmailReply(assistant.reply, assistant.cards, assistant.enquiry, preparedBasketUrl, assistant.additionalAnswer, message.name, customerEmailText);
    const delivered: any = await client.action(api.emailInbox.sendAssistantReply, {
      secret,
      threadId: stored.threadId,
      inboundId: stored.inboundId,
      text: replyText,
      humanRequested,
      resolvedInquiry,
    });
    if (!delivered?.ok) {
      return NextResponse.json(
        { error: "Email reply is not complete; retry this delivery." },
        { status: 503, headers: { "Retry-After": "120" } },
      );
    }
    return NextResponse.json({ ok: true, replied: true, humanRequested, resolvedInquiry, linkedProfile: !!stored.accountId });
  } catch (error) {
    if (stored?.inboundId) {
      // A failed answer needs visible human attention as well as a retry.
      {
        try {
          await client.mutation(api.emailInbox.markHumanRequested, { secret, inboundId: stored.inboundId });
        } catch { /* don't replace the original delivery error */ }
      }
      try {
        await client.mutation(api.emailInbox.failInbound, {
          secret,
          inboundId: stored.inboundId,
          error: String((error as any)?.message ?? error),
        });
      } catch { /* the provider retries if this request returns 5xx */ }
    }
    console.error("[email/inbound] failed to process customer email", String((error as any)?.message ?? error));
    return NextResponse.json({ error: "email processing failed" }, { status: 500 });
  }
}

async function processResendEmail(_req: NextRequest, _raw: string) {
  return NextResponse.json({ error: "Resend inbound email is disabled. Gmail sync is the active mailbox connection." }, { status: 410 });
}

async function processLegacyFollowUp(req: NextRequest, raw: string, secret: string) {
  if (req.nextUrl.searchParams.get("key") !== secret) return null;
  let payload: any;
  try { payload = JSON.parse(raw); } catch { return NextResponse.json({ error: "bad payload" }, { status: 400 }); }
  const msg = payload?.data ?? payload;
  const replyKey = replyKeyFrom(...recipientCandidates(msg));
  if (!replyKey) return NextResponse.json({ ok: true, ignored: "no reply key" });
  const email = senderFrom(msg);
  if (!email) return NextResponse.json({ ok: true, ignored: "no sender" });
  const body = newTextOnly(plainBody(msg) || htmlToText(msg?.html ?? msg?.HtmlBody ?? msg?.["body-html"] ?? ""));
  if (!body) return NextResponse.json({ ok: true, ignored: "empty body" });
  const url = process.env.NEXT_PUBLIC_CONVEX_URL;
  if (!url) return NextResponse.json({ error: "not configured" }, { status: 503 });

  const headers = msg?.headers ?? msg?.Headers ?? {};
  const messageId = headerValue(headers, "message-id") || String(msg?.message_id ?? msg?.MessageId ?? "").trim();
  const subject = String(msg?.subject ?? msg?.Subject ?? "Customer email reply").trim().slice(0, 500);
  const providerHash = messageId || createHash("sha256").update(`${email}\0${replyKey}\0${subject}\0${body}`).digest("hex");
  const providerId = `gaffer-reply:${replyKey}:${providerHash}`;
  const client = new ConvexHttpClient(url);
  try {
    const resolved: any = await client.mutation(api.emailInbox.resolveReplyKey, { secret, replyKey, email });
    if (resolved.ok) {
      const recipient = addressList(msg?.to ?? msg?.To ?? msg?.envelope?.to)[0] ?? `gaffer+${replyKey}@${process.env.INBOUND_EMAIL_DOMAIN ?? "dbcinemarentals.com"}`;
      return processGafferInboundEmail({
        providerId,
        messageId: messageId || undefined,
        inReplyTo: headerValue(headers, "in-reply-to") || undefined,
        references: referencesFrom(headers, "references"),
        from: email,
        name: nameFrom(msg?.from ?? msg?.From ?? msg?.sender ?? email),
        to: recipient,
        subject,
        text: body,
        replyThreadId: resolved.threadId,
      });
    }

    const followUp: any = await client.mutation(api.followUp.resolveInbound, { secret, replyKey, email });
    if (!followUp.ok) return NextResponse.json({ ok: true, ignored: "unknown reply address" });
    const recipient = addressList(msg?.to ?? msg?.To ?? msg?.envelope?.to)[0] ?? `gaffer+${replyKey}@${process.env.INBOUND_EMAIL_DOMAIN ?? "dbcinemarentals.com"}`;
    return processGafferInboundEmail({
      providerId,
      messageId: messageId || undefined,
      inReplyTo: headerValue(headers, "in-reply-to") || undefined,
      references: referencesFrom(headers, "references"),
      from: email,
      name: nameFrom(msg?.from ?? msg?.From ?? msg?.sender ?? email) || followUp.original.name,
      to: recipient,
      subject: subject === "Customer email reply" ? `Re: ${followUp.original.subject}` : subject,
      text: body,
      priorMessage: {
        providerId: `gaffer-follow-up:${replyKey}`,
        subject: followUp.original.subject,
        text: followUp.original.body,
        at: followUp.original.at,
      },
    });
  } catch (error) {
    console.error("[email/inbound] failed to resolve Gaffer reply address", String((error as any)?.message ?? error));
    return NextResponse.json({ error: "routing failed" }, { status: 500 });
  }
}

async function processContactFormReply(raw: string) {
  let payload: any;
  try {
    payload = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "bad contact form payload" }, { status: 400 });
  }

  const contactId = typeof payload?.contactId === "string" ? payload.contactId.trim() : "";
  const name = typeof payload?.name === "string" ? payload.name.trim().slice(0, 120) : "";
  const from = typeof payload?.email === "string" ? payload.email.trim().toLowerCase().slice(0, 200) : "";
  const text = typeof payload?.message === "string" ? payload.message.trim().slice(0, 4000) : "";
  if (payload?.source !== "contact-form" || !contactId || contactId.length > 128 || !name || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(from) || text.length < 2) {
    return NextResponse.json({ error: "invalid contact form payload" }, { status: 400 });
  }

  return processGafferInboundEmail({
    providerId: `contact-form:${contactId}`,
    from,
    name,
    to: CONTACT_EMAIL,
    subject: `Website contact: ${name}`,
    text,
    references: [],
  });
}

async function processGmailWorkerMessage(raw: string) {
  let payload: any;
  try { payload = JSON.parse(raw); } catch { return NextResponse.json({ error: "bad Gmail worker payload" }, { status: 400 }); }
  const message = payload?.message;
  const emailPattern = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
  const header = (value: unknown) => typeof value === "string" && value.length <= 512 && !/[\r\n]/.test(value) ? value : undefined;
  if (payload?.source !== "gmail" || !message || typeof message !== "object" ||
      typeof message.providerId !== "string" || !/^gmail:[A-Za-z0-9_-]{1,200}$/.test(message.providerId) ||
      typeof message.providerThreadId !== "string" || !/^[A-Za-z0-9_-]{1,200}$/.test(message.providerThreadId) ||
      typeof message.from !== "string" || !emailPattern.test(message.from) ||
      typeof message.to !== "string" || !emailPattern.test(message.to) ||
      typeof message.subject !== "string" || message.subject.length > 500 ||
      typeof message.text !== "string" || message.text.length > 50_000 ||
      !Array.isArray(message.references) || message.references.length > 20 ||
      message.references.some((item: unknown) => !header(item))) {
    return NextResponse.json({ error: "invalid Gmail worker payload" }, { status: 400 });
  }
  return processGafferInboundEmail({
    providerId: message.providerId,
    providerThreadId: message.providerThreadId,
    ...(header(message.messageId) ? { messageId: message.messageId } : {}),
    ...(header(message.inReplyTo) ? { inReplyTo: message.inReplyTo } : {}),
    references: message.references,
    from: message.from.trim().toLowerCase(),
    ...(typeof message.name === "string" && message.name.length <= 120 ? { name: message.name } : {}),
    to: message.to.trim().toLowerCase(),
    subject: message.subject.trim(),
    text: newTextOnly(message.text),
  });
}

function hasContactWorkerAuthorization(req: NextRequest, secret: string) {
  const provided = req.headers.get("authorization") ?? "";
  const expected = `Bearer ${secret}`;
  const providedBytes = Buffer.from(provided);
  const expectedBytes = Buffer.from(expected);
  return providedBytes.length === expectedBytes.length && timingSafeEqual(providedBytes, expectedBytes);
}

export async function POST(req: NextRequest) {
  const raw = await req.text();
  if (raw.length > 1_000_000) return NextResponse.json({ error: "payload too large" }, { status: 413 });
  const legacySecret = process.env.INBOUND_EMAIL_SECRET;
  if (legacySecret) {
    if (hasContactWorkerAuthorization(req, legacySecret)) {
      if (req.nextUrl.pathname === "/api/email/inbound" && req.headers.get("content-type")?.includes("application/json")) {
        try { if (JSON.parse(raw)?.source === "gmail") return processGmailWorkerMessage(raw); } catch { /* contact form validation returns a bad payload response */ }
      }
      return processContactFormReply(raw);
    }
    const legacy = await processLegacyFollowUp(req, raw, legacySecret);
    if (legacy) return legacy;
  }
  return processResendEmail(req, raw);
}
