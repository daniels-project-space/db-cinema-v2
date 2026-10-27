import { createHmac, timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { ConvexHttpClient } from "convex/browser";
import { api } from "@cvx/_generated/api";
import { handleChat } from "@/lib/gaffer";
import { formatGafferEmailReply, isHumanHandoffRequested, newTextOnly, plainBody, recipientCandidates, replyKeyFrom, senderFrom } from "@/lib/inboundEmail";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const OWNER_EMAIL = "dbcinemarentals@gmail.com";

function verifyResendSignature(req: NextRequest, raw: string): boolean {
  const secret = process.env.RESEND_WEBHOOK_SECRET;
  const id = req.headers.get("svix-id");
  const timestamp = req.headers.get("svix-timestamp");
  const signature = req.headers.get("svix-signature");
  if (!secret || !id || !timestamp || !signature) return false;
  const seconds = Number(timestamp);
  if (!Number.isFinite(seconds) || Math.abs(Date.now() / 1000 - seconds) > 300) return false;
  try {
    const encodedSecret = secret.startsWith("whsec_") ? secret.slice(6) : secret;
    const key = Buffer.from(encodedSecret, "base64");
    const expected = createHmac("sha256", key).update(`${id}.${timestamp}.${raw}`).digest();
    return signature.split(/\s+/).some((part) => {
      const [version, value] = part.split(",", 2);
      if (version !== "v1" || !value) return false;
      const received = Buffer.from(value, "base64");
      return received.length === expected.length && timingSafeEqual(received, expected);
    });
  } catch {
    return false;
  }
}

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

async function processResendEmail(req: NextRequest, raw: string) {
  if (!process.env.INBOUND_EMAIL_SECRET || !process.env.NEXT_PUBLIC_CONVEX_URL) {
    return NextResponse.json({ error: "Inbound email storage is not configured." }, { status: 503 });
  }
  if (!verifyResendSignature(req, raw)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  let event: any;
  try { event = JSON.parse(raw); } catch { return NextResponse.json({ error: "bad payload" }, { status: 400 }); }
  if (event?.type !== "email.received") return NextResponse.json({ ok: true, ignored: "event type" });
  const emailId = String(event?.data?.email_id ?? "").trim();
  if (!emailId) return NextResponse.json({ error: "missing inbound email id" }, { status: 400 });
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return NextResponse.json({ error: "Inbound email content retrieval is not configured." }, { status: 503 });

  let received: any;
  try {
    const response = await fetch(`https://api.resend.com/emails/receiving/${encodeURIComponent(emailId)}`, {
      headers: { authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) throw new Error(`Resend retrieval failed (${response.status})`);
    received = await response.json();
  } catch (error) {
    console.error("[email/inbound] could not retrieve received email", String((error as any)?.message ?? error));
    return NextResponse.json({ error: "email content unavailable" }, { status: 502 });
  }

  const headers = received?.headers ?? {};
  const rawFrom = received?.from ?? headerValue(headers, "from");
  const email = senderFrom({ from: rawFrom, sender: rawFrom });
  const recipient = addressList(received?.received_for ?? received?.to ?? event?.data?.to)[0] ?? OWNER_EMAIL;
  const subject = String(received?.subject ?? event?.data?.subject ?? "Customer rental enquiry").trim().slice(0, 500);
  const body = newTextOnly(typeof received?.text === "string" && received.text.trim() ? received.text : htmlToText(received?.html ?? ""));
  if (!email || !body) return NextResponse.json({ ok: true, ignored: !email ? "no sender" : "empty body" });
  if (email === OWNER_EMAIL) return NextResponse.json({ ok: true, ignored: "self mail" });

  const client = new ConvexHttpClient(process.env.NEXT_PUBLIC_CONVEX_URL);
  let stored: any = null;
  try {
    stored = await client.mutation(api.emailInbox.ingest, {
      secret: process.env.INBOUND_EMAIL_SECRET,
      providerId: emailId,
      messageId: received?.message_id ?? (headerValue(headers, "message-id") || undefined),
      inReplyTo: headerValue(headers, "in-reply-to") || undefined,
      references: referencesFrom(headers, "references"),
      from: email,
      name: nameFrom(rawFrom),
      to: recipient,
      subject,
      text: body,
    });
    const humanRequested = isHumanHandoffRequested(subject, body);
    const claim: any = await client.mutation(api.emailInbox.claimInbound, {
      secret: process.env.INBOUND_EMAIL_SECRET,
      inboundId: stored.inboundId,
      humanRequested,
    });
    if (claim.state === "done") return NextResponse.json({ ok: true, duplicate: true });
    if (claim.state === "busy") return NextResponse.json({ ok: true, processing: true }, { status: 202 });

    const assistant = await handleChat({ messages: claim.history, channel: "email" });
    if (!assistant?.reply?.trim() || assistant.reply.includes("The assistant isn't configured yet.")) {
      throw new Error("Gaffer could not produce an email reply");
    }
    const delivered: any = await client.action(api.emailInbox.sendAssistantReply, {
      secret: process.env.INBOUND_EMAIL_SECRET,
      threadId: stored.threadId,
      inboundId: stored.inboundId,
      text: formatGafferEmailReply(assistant.reply, assistant.cards),
      humanRequested,
    });
    if (!delivered?.ok) return NextResponse.json({ ok: true, processing: true }, { status: 202 });
    return NextResponse.json({ ok: true, replied: true, humanRequested, linkedProfile: !!stored.accountId });
  } catch (error) {
    try {
      await client.mutation(api.emailInbox.failInbound, {
        secret: process.env.INBOUND_EMAIL_SECRET,
        inboundId: stored?.inboundId,
        error: String((error as any)?.message ?? error),
      });
    } catch { /* the provider retries if this request returns 5xx */ }
    console.error("[email/inbound] failed to process customer email", String((error as any)?.message ?? error));
    return NextResponse.json({ error: "email processing failed" }, { status: 500 });
  }
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
  const body = newTextOnly(plainBody(msg));
  if (!body) return NextResponse.json({ ok: true, ignored: "empty body" });
  const url = process.env.NEXT_PUBLIC_CONVEX_URL;
  if (!url) return NextResponse.json({ error: "not configured" }, { status: 503 });
  try {
    const result = await new ConvexHttpClient(url).mutation(api.followUp.inbound, {
      secret,
      replyKey,
      email,
      body,
      subject: msg?.subject ?? msg?.Subject ?? undefined,
    });
    return NextResponse.json({ ok: true, routed: (result as any)?.routed ?? "owner" });
  } catch (error) {
    console.error("[email/inbound] failed to route follow-up reply", String((error as any)?.message ?? error));
    return NextResponse.json({ error: "routing failed" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const raw = await req.text();
  if (raw.length > 1_000_000) return NextResponse.json({ error: "payload too large" }, { status: 413 });
  const legacySecret = process.env.INBOUND_EMAIL_SECRET;
  if (legacySecret) {
    const legacy = await processLegacyFollowUp(req, raw, legacySecret);
    if (legacy) return legacy;
  }
  return processResendEmail(req, raw);
}
