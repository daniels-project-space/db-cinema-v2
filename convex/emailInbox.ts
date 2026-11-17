import { v } from "convex/values";
import { cartLine } from "./checkoutCartData";
import { action, internalAction, internalMutation, internalQuery, mutation, query } from "./_generated/server";
import { internal } from "./_generated/api";
import { assertAdmin, checkAdminToken } from "./adminAuth";
import { postRentalMessage, accountForToken, rentalThread } from "./lib/rentalChat";
import { BUSINESS_CONTACT_EMAIL, isBusinessSender } from "../shared/businessEmail";
import { mergeEmailRecipientDeliveryStatuses, type EmailRecipientDeliveryStatus, type ResendDeliveryStatus } from "../shared/emailDeliveryStatus";

const OWNER_EMAIL = BUSINESS_CONTACT_EMAIL;
const LEASE_MS = 2 * 60_000;
const HUMAN_ALERT_RETRY_DELAYS_MS = [15_000, 60_000] as const;
const UNMATCHED_DELIVERY_EVENT_TTL_MS = 24 * 60 * 60_000;
const EMAIL_ADDRESS_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

function makeReplyKey() {
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function gafferReplyAddress(replyKey: string, configuredAddress = process.env.INBOUND_REPLY_ADDRESS) {
  const address = configuredAddress?.trim().toLowerCase();
  if (!/^[a-f0-9]{24}$/i.test(replyKey) || !address || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(address)) return null;
  return address;
}

function assertInboundSecret(secret: string) {
  const expected = process.env.INBOUND_EMAIL_SECRET;
  if (!expected || secret !== expected) throw new Error("unauthorized");
}

function configuredBusinessSender() {
  const from = process.env.RESEND_FROM?.trim();
  if (!from) return null;
  const email = from.match(/<([^>]+)>/)?.[1]?.trim() ?? from;
  return isBusinessSender(email) ? email.toLowerCase() : null;
}

export function businessEmailReadiness() {
  if (!process.env.RESEND_API_KEY?.trim() || !configuredBusinessSender()) {
    return "missing_business_sender" as const;
  }
  if (!gafferReplyAddress("a".repeat(24))) return "missing_reply_route" as const;
  return "ready" as const;
}

function businessEmailReady() {
  return businessEmailReadiness() === "ready";
}

function configuredForwardingAddress() {
  const address = process.env.INBOUND_REPLY_ADDRESS?.trim().toLowerCase() ?? "";
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(address) ? address : null;
}

function subjectKey(subject: string) {
  return String(subject ?? "")
    .toLowerCase()
    .replace(/^(\s*(re|fw|fwd)\s*:\s*)+/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

async function historyFor(ctx: any, threadId: any) {
  const rows = await ctx.db.query("email_messages")
    .withIndex("by_thread_at", (q: any) => q.eq("threadId", threadId))
    .order("desc")
    .take(12);
  return rows.reverse().map((row: any) => ({
    role: row.direction === "in" ? "user" : "assistant",
    content: row.text,
  }));
}

function deliveryEventStatus(eventType: string): ResendDeliveryStatus | null {
  return ["delivered", "delivery_delayed", "bounced", "suppressed", "failed", "complained"].includes(eventType)
    ? eventType as ResendDeliveryStatus
    : null;
}

function recipientDeliveryUpdates(
  event: { webhookEventId: string; eventType: ResendDeliveryStatus; recipients: string[]; occurredAt: number; reason?: string },
  fallbackRecipient: string,
): EmailRecipientDeliveryStatus[] {
  const recipients = [...new Set((event.recipients.length ? event.recipients : [fallbackRecipient])
    .map(value => value.trim().toLowerCase())
    .filter(value => EMAIL_ADDRESS_RE.test(value)))];
  return recipients.map(recipient => ({
    recipient,
    status: event.eventType,
    at: event.occurredAt,
    eventId: event.webhookEventId,
    ...(event.reason ? { reason: event.reason.slice(0, 500) } : {}),
  }));
}

async function linkPendingDeliveryEvents(ctx: any, message: any, resendEmailId: string) {
  const pending = await ctx.db.query("email_delivery_events")
    .withIndex("by_resend_email_id", (q: any) => q.eq("resendEmailId", resendEmailId))
    .collect();
  let statuses = message.recipientDeliveryStatuses ?? [];
  for (const event of pending.sort((a: any, b: any) => a.occurredAt - b.occurredAt || a.webhookEventId.localeCompare(b.webhookEventId))) {
    const eventType = deliveryEventStatus(event.eventType);
    if (eventType) {
      statuses = mergeEmailRecipientDeliveryStatuses(statuses, recipientDeliveryUpdates({
        webhookEventId: event.webhookEventId,
        eventType,
        recipients: event.recipients,
        occurredAt: event.occurredAt,
        reason: event.reason,
      }, message.recipient));
    }
    await ctx.db.delete(event._id);
  }
  return statuses;
}

async function providerDeliveryFields(ctx: any, message: any, resendEmailId?: string) {
  if (!resendEmailId) return {};
  const normalizedId = resendEmailId.trim();
  if (!normalizedId || normalizedId.length > 200) throw new Error("Resend returned an invalid email ID");
  if (message.resendEmailId && message.resendEmailId !== normalizedId) throw new Error("Resend email ID does not match the existing delivery receipt");
  const statuses = await linkPendingDeliveryEvents(ctx, message, normalizedId);
  return {
    resendEmailId: normalizedId,
    ...(statuses.length ? { recipientDeliveryStatuses: statuses } : {}),
  };
}

export const recordResendDeliveryEvent = mutation({
  args: {
    secret: v.string(),
    webhookEventId: v.string(),
    resendEmailId: v.string(),
    eventType: v.union(
      v.literal("delivered"),
      v.literal("delivery_delayed"),
      v.literal("bounced"),
      v.literal("suppressed"),
      v.literal("failed"),
      v.literal("complained"),
    ),
    recipients: v.array(v.string()),
    from: v.string(),
    occurredAt: v.number(),
    reason: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    assertInboundSecret(args.secret);
    const webhookEventId = args.webhookEventId.trim();
    const resendEmailId = args.resendEmailId.trim();
    if (!webhookEventId || webhookEventId.length > 200 || !resendEmailId || resendEmailId.length > 200 || !Number.isFinite(args.occurredAt)) {
      throw new Error("invalid Resend delivery event");
    }
    const eventType = deliveryEventStatus(args.eventType);
    if (!eventType) return { ok: true as const, ignored: "unsupported status" };
    const recipients = [...new Set(args.recipients.map(value => value.trim().toLowerCase()).filter(value => EMAIL_ADDRESS_RE.test(value)))].slice(0, 25);
    const reason = args.reason?.replace(/[\r\n\t]+/g, " ").trim().slice(0, 500) || undefined;
    const existingPending = await ctx.db.query("email_delivery_events")
      .withIndex("by_webhook_event_id", (q) => q.eq("webhookEventId", webhookEventId))
      .first();
    if (existingPending) {
      if (existingPending.resendEmailId !== resendEmailId) throw new Error("Resend event ID was replayed for a different email");
      return { ok: true as const, duplicate: true as const, pending: true as const };
    }

    const message = await ctx.db.query("email_messages")
      .withIndex("by_resend_email_id", (q) => q.eq("resendEmailId", resendEmailId))
      .first();
    if (message) {
      if (message.direction !== "out") throw new Error("Resend delivery event matched a non-outbound email");
      const updates = recipientDeliveryUpdates({ webhookEventId, eventType, recipients, occurredAt: args.occurredAt, reason }, message.recipient);
      const merged = mergeEmailRecipientDeliveryStatuses(message.recipientDeliveryStatuses, updates);
      const updated = JSON.stringify(merged) !== JSON.stringify(message.recipientDeliveryStatuses ?? []);
      if (updated) await ctx.db.patch(message._id, { recipientDeliveryStatuses: merged });
      return { ok: true as const, matched: true as const, updated };
    }

    // Buffer only mail from this application's verified domain. The send
    // response can race this webhook before its email ID is saved on the
    // outbox row; unrelated Resend traffic must not become permanent orphans.
    if (!isBusinessSender(args.from)) return { ok: true as const, ignored: "unmatched email" };
    const pendingId = await ctx.db.insert("email_delivery_events", {
      webhookEventId,
      resendEmailId,
      eventType,
      recipients,
      occurredAt: args.occurredAt,
      ...(reason ? { reason } : {}),
    });
    await ctx.scheduler.runAfter(UNMATCHED_DELIVERY_EVENT_TTL_MS, internal.emailInbox.expirePendingDeliveryEvent, { pendingId });
    return { ok: true as const, pending: true as const };
  },
});

export const expirePendingDeliveryEvent = internalMutation({
  args: { pendingId: v.id("email_delivery_events") },
  handler: async (ctx, { pendingId }) => {
    const pending = await ctx.db.get(pendingId);
    if (!pending) return { ok: true as const, alreadyLinked: true as const };
    const message = await ctx.db.query("email_messages")
      .withIndex("by_resend_email_id", (q) => q.eq("resendEmailId", pending.resendEmailId))
      .first();
    if (!message || message.direction !== "out") {
      await ctx.db.delete(pendingId);
      return { ok: true as const, expired: true as const };
    }
    const statuses = await linkPendingDeliveryEvents(ctx, message, pending.resendEmailId);
    if (statuses.length) await ctx.db.patch(message._id, { recipientDeliveryStatuses: statuses });
    return { ok: true as const, reconciled: true as const };
  },
});

async function threadMessages(ctx: any, threadId: any, count = 40) {
  return await ctx.db.query("email_messages")
    .withIndex("by_thread_at", (q: any) => q.eq("threadId", threadId))
    .order("desc")
    .take(count);
}

export const ingest = mutation({
  args: {
    secret: v.string(),
    providerId: v.string(),
    messageId: v.optional(v.string()),
    inReplyTo: v.optional(v.string()),
    references: v.array(v.string()),
    replyThreadId: v.optional(v.id("email_threads")),
    priorMessage: v.optional(v.object({
      providerId: v.string(),
      subject: v.string(),
      text: v.string(),
      at: v.number(),
    })),
    from: v.string(),
    name: v.optional(v.string()),
    to: v.string(),
    subject: v.string(),
    text: v.string(),
  },
  handler: async (ctx, args) => {
    assertInboundSecret(args.secret);
    const email = args.from.trim().toLowerCase();
    const providerId = args.providerId.trim();
    const body = args.text.trim().slice(0, 12_000);
    if (!providerId || !email.includes("@") || !body) throw new Error("invalid inbound email");

    const duplicate = await ctx.db.query("email_messages")
      .withIndex("by_provider", (q) => q.eq("providerId", providerId))
      .first();
    if (duplicate) {
      const thread = await ctx.db.get(duplicate.threadId);
      return {
        ok: true,
        duplicate: true,
        threadId: duplicate.threadId,
        inboundId: duplicate._id,
        accountId: thread?.verifiedRenterEmail ? thread.accountId ?? null : null,
        blocked: false,
        history: await historyFor(ctx, duplicate.threadId),
      };
    }

    const accountCandidates = await ctx.db.query("accounts")
      .withIndex("by_email", (q: any) => q.eq("email", email))
      .order("desc")
      .take(20);
    const account = accountCandidates.find((candidate) =>
      candidate.email?.trim().toLowerCase() === email &&
      candidate.emailVerificationRequired !== true &&
      typeof candidate.emailVerifiedAt === "number" &&
      Number.isFinite(candidate.emailVerifiedAt) &&
      candidate.emailVerifiedAt > 0,
    ) ?? null;
    let thread: any = null;
    if (args.replyThreadId) {
      const replyThread = await ctx.db.get(args.replyThreadId);
      if (!replyThread || replyThread.email.trim().toLowerCase() !== email) {
        throw new Error("email reply address does not match the sender");
      }
      thread = replyThread;
    }
    const correlationIds = [...new Set([args.inReplyTo, ...args.references].filter(Boolean))];
    for (const messageId of thread ? [] : correlationIds) {
      const prior = await ctx.db.query("email_messages")
        .withIndex("by_message_id", (q) => q.eq("messageId", messageId))
        .first();
      if (prior) {
        const candidate = await ctx.db.get(prior.threadId);
        // RFC Message-ID headers are supplied by the sender and are not identity proof.
        // Only correlate a reply to the exact normalized sender address for this thread.
        if (candidate && candidate.email?.trim().toLowerCase() === email) {
          thread = candidate;
          break;
        }
      }
    }
    if (!thread) {
      const recent = await ctx.db.query("email_threads")
        .withIndex("by_email_updated", (q) => q.eq("email", email))
        .order("desc")
        .take(20);
      const now = Date.now();
      thread = recent.find((row) => subjectKey(row.subject) === subjectKey(args.subject) && now - row.updatedAt < 30 * 86_400_000) ?? null;
    }

    const now = Date.now();
    if (!thread) {
      const threadId = await ctx.db.insert("email_threads", {
        email,
        name: args.name?.trim() || account?.name || undefined,
        subject: args.subject.trim().slice(0, 500) || "Customer email",
        replyKey: makeReplyKey(),
        accountId: account?._id,
        verifiedRenterEmail: account ? email : undefined,
        status: "open",
        createdAt: now,
        updatedAt: now,
        lastAt: now,
        lastDirection: "in",
        lastText: body.slice(0, 280),
        unreadOwner: 1,
      });
      thread = await ctx.db.get(threadId);
    } else {
      await ctx.db.patch(thread._id, {
        accountId: account?._id,
        verifiedRenterEmail: account ? email : undefined,
        replyKey: thread.replyKey ?? makeReplyKey(),
        ...(args.name?.trim() && !thread.name ? { name: args.name.trim() } : {}),
        updatedAt: now,
        lastAt: now,
        lastDirection: "in",
        lastText: body.slice(0, 280),
        unreadOwner: (thread.unreadOwner ?? 0) + 1,
        status: thread.status === "closed" ? "open" : thread.status,
      });
      thread = await ctx.db.get(thread._id);
    }

    if (args.priorMessage) {
      const prior = await ctx.db.query("email_messages")
        .withIndex("by_provider", (q) => q.eq("providerId", args.priorMessage!.providerId))
        .first();
      if (!prior) {
        await ctx.db.insert("email_messages", {
          threadId: thread._id,
          direction: "out",
          sender: OWNER_EMAIL,
          recipient: email,
          subject: args.priorMessage.subject.trim().slice(0, 500) || thread.subject,
          text: args.priorMessage.text.trim().slice(0, 12_000),
          at: Math.min(Math.max(0, args.priorMessage.at), now - 1),
          providerId: args.priorMessage.providerId,
          state: "sent",
          humanRequested: false,
        });
      }
    }

    const inboundId = await ctx.db.insert("email_messages", {
      threadId: thread._id,
      direction: "in",
      sender: email,
      recipient: args.to.trim().toLowerCase(),
      subject: args.subject.trim().slice(0, 500) || thread.subject,
      text: body,
      at: now,
      providerId,
      messageId: args.messageId?.trim() || undefined,
      inReplyTo: args.inReplyTo?.trim() || undefined,
      references: args.references.slice(-20),
      state: "received",
      humanRequested: false,
    });

    if (account && account.blockedAt == null) {
      const profileMessageId = await postRentalMessage(ctx, {
        accountId: account._id,
        sender: "renter",
        text: body,
        meta: { channel: "email", emailThreadId: String(thread._id), emailMessageId: String(inboundId) },
      });
      await ctx.db.patch(inboundId, { profileMessageId });
    }

    return {
      ok: true,
      duplicate: false,
      threadId: thread._id,
      inboundId,
      accountId: account?._id ?? null,
      blocked: account?.blockedAt != null,
      history: await historyFor(ctx, thread._id),
    };
  },
});

export const claimInbound = mutation({
  args: { secret: v.string(), inboundId: v.id("email_messages"), humanRequested: v.boolean() },
  handler: async (ctx, { secret, inboundId, humanRequested }) => {
    assertInboundSecret(secret);
    const message = await ctx.db.get(inboundId);
    if (!message || message.direction !== "in") throw new Error("inbound message not found");
    if (message.state === "replied" || message.state === "handoff") return { state: "done" as const };
    const now = Date.now();
    if (message.state === "processing" && (message.leaseUntil ?? 0) > now) return { state: "busy" as const };
    await ctx.db.patch(inboundId, { state: "processing", leaseUntil: now + LEASE_MS, error: undefined, humanRequested });
    const thread = await ctx.db.get(message.threadId);
    if (!thread) throw new Error("email thread not found");
    return { state: "claimed" as const, threadId: message.threadId, inboundId, history: await historyFor(ctx, message.threadId), email: thread.email };
  },
});

async function markEmailHumanRequested(ctx: any, thread: any, message: any, inboundId: any, now: number) {
  await ctx.db.patch(inboundId, { humanRequested: true });
  if (thread.humanNotifiedMessageId === inboundId) return;
  await ctx.db.patch(thread._id, {
    status: "human_requested",
    humanNotifiedAt: now,
    humanNotifiedMessageId: inboundId,
  });
  await ctx.scheduler.runAfter(0, internal.notify.emailHumanRequestAlert, {
    email: thread.email,
    subject: thread.subject,
    body: message.text.slice(0, 3000),
    inboundId,
    attempt: 1,
  });
}

/** Apply Gaffer's semantic handoff signal after its reply has been generated. */
export const markHumanRequested = mutation({
  args: { secret: v.string(), inboundId: v.id("email_messages") },
  handler: async (ctx, { secret, inboundId }) => {
    assertInboundSecret(secret);
    const message = await ctx.db.get(inboundId);
    if (!message || message.direction !== "in") throw new Error("inbound message not found");
    if (message.state !== "processing" && message.state !== "handoff" && message.state !== "replied") {
      throw new Error("inbound message is not claimed for processing");
    }
    const thread = await ctx.db.get(message.threadId);
    if (!thread) throw new Error("email thread not found");
    const now = Date.now();
    const duplicate = thread.humanNotifiedMessageId === inboundId;
    await markEmailHumanRequested(ctx, thread, message, inboundId, now);
    return { ok: true, duplicate };
  },
});

export const resolveReplyKey = mutation({
  args: { secret: v.string(), replyKey: v.string(), email: v.string() },
  handler: async (ctx, { secret, replyKey, email }) => {
    assertInboundSecret(secret);
    const thread = await ctx.db.query("email_threads")
      .withIndex("by_reply_key", (q) => q.eq("replyKey", replyKey))
      .first();
    if (!thread || thread.email.trim().toLowerCase() !== email.trim().toLowerCase()) {
      return { ok: false as const };
    }
    return { ok: true as const, threadId: thread._id };
  },
});

export const failInbound = mutation({
  args: { secret: v.string(), inboundId: v.id("email_messages"), error: v.string() },
  handler: async (ctx, { secret, inboundId, error }) => {
    assertInboundSecret(secret);
    const message = await ctx.db.get(inboundId);
    if (!message || message.direction !== "in") return { ok: false };
    await ctx.db.patch(inboundId, { state: "failed", leaseUntil: undefined, error: error.slice(0, 500) });
    return { ok: true };
  },
});

export const scheduleHumanRequestAlertRetry = internalMutation({
  args: { email: v.string(), subject: v.string(), body: v.string(), inboundId: v.id("email_messages"), failedAttempt: v.number() },
  handler: async (ctx, args) => {
    if (!Number.isInteger(args.failedAttempt) || args.failedAttempt < 1 || args.failedAttempt >= 3) throw new Error("human alert retry limit reached");
    const nextAttempt = args.failedAttempt + 1;
    await ctx.scheduler.runAfter(HUMAN_ALERT_RETRY_DELAYS_MS[args.failedAttempt - 1], internal.notify.emailHumanRequestAlert, {
      email: args.email,
      subject: args.subject,
      body: args.body,
      inboundId: args.inboundId,
      attempt: nextAttempt,
    });
    return { scheduled: true, attempt: nextAttempt };
  },
});

export const claimAutomaticReply = internalMutation({
  args: { threadId: v.id("email_threads"), inboundId: v.id("email_messages"), text: v.string(), humanRequested: v.boolean() },
  handler: async (ctx, args) => {
    const thread = await ctx.db.get(args.threadId);
    const inbound = await ctx.db.get(args.inboundId);
    if (!thread || !inbound || inbound.threadId !== args.threadId || inbound.direction !== "in") throw new Error("email reply context not found");
    const deliveryKey = `email-auto:${inbound.providerId ?? inbound._id}`;
    const outboxKey = `out:${deliveryKey}`;
    const existing = await ctx.db.query("email_messages")
      .withIndex("by_provider", (q) => q.eq("providerId", outboxKey))
      .first();
    const now = Date.now();
    if (existing?.state === "sent") return { state: "sent" as const };
    if (existing?.state === "processing" && (existing.leaseUntil ?? 0) > now) return { state: "busy" as const };
    const replyKey = thread.replyKey ?? makeReplyKey();
    if (!thread.replyKey) await ctx.db.patch(args.threadId, { replyKey });
    const replyThread = { ...thread, replyKey };
    let outboundId = existing?._id;
    if (outboundId) {
      await ctx.db.patch(outboundId, { state: "processing", leaseUntil: now + LEASE_MS, text: args.text, humanRequested: args.humanRequested, error: undefined });
    } else {
      outboundId = await ctx.db.insert("email_messages", {
        threadId: args.threadId,
        direction: "out",
        sender: OWNER_EMAIL,
        recipient: thread.email,
        subject: thread.subject,
        text: args.text,
        at: now,
        providerId: outboxKey,
        state: "processing",
        leaseUntil: now + LEASE_MS,
        replyToProviderId: inbound.providerId ?? String(inbound._id),
        humanRequested: args.humanRequested,
      });
    }
    await ctx.db.patch(args.inboundId, { humanRequested: args.humanRequested });
    return { state: "claimed" as const, outboundId, deliveryKey, thread: replyThread, inbound };
  },
});

export const finishAutomaticReply = internalMutation({
  args: { threadId: v.id("email_threads"), inboundId: v.id("email_messages"), outboundId: v.id("email_messages"), text: v.string(), messageId: v.string(), resendEmailId: v.optional(v.string()), humanRequested: v.boolean() },
  handler: async (ctx, args) => {
    const thread = await ctx.db.get(args.threadId);
    const inbound = await ctx.db.get(args.inboundId);
    const outbound = await ctx.db.get(args.outboundId);
    if (!thread || !inbound || !outbound) throw new Error("email reply could not be recorded");
    if (outbound.state === "sent") return { ok: true, duplicate: true };
    const now = Date.now();
    const references = [...new Set([...(inbound.references ?? []), inbound.messageId].filter((value): value is string => typeof value === "string" && value.length > 0))].slice(-20);
    const providerFields = await providerDeliveryFields(ctx, outbound, args.resendEmailId);
    await ctx.db.patch(args.outboundId, { state: "sent", at: now, messageId: args.messageId, inReplyTo: inbound.messageId, references, leaseUntil: undefined, error: undefined, ...providerFields });
    await ctx.db.patch(args.inboundId, { state: args.humanRequested ? "handoff" : "replied", leaseUntil: undefined, error: undefined, humanRequested: args.humanRequested });
    await ctx.db.patch(args.threadId, {
      status: args.humanRequested ? "human_requested" : "open",
      updatedAt: now,
      lastAt: now,
      lastDirection: "out",
      lastText: args.text.slice(0, 280),
      ...(args.humanRequested ? { humanNotifiedAt: now } : {}),
    });
    if (thread.accountId) {
      const profileMessageId = await postRentalMessage(ctx, { accountId: thread.accountId, sender: "bot", text: args.text, meta: { channel: "email", emailThreadId: String(thread._id), emailMessageId: String(args.outboundId) } });
      await ctx.db.patch(args.outboundId, { profileMessageId });
    }
    return { ok: true };
  },
});

export const markSendFailed = internalMutation({
  args: { outboundId: v.id("email_messages"), inboundId: v.optional(v.id("email_messages")), error: v.string() },
  handler: async (ctx, args) => {
    const message = await ctx.db.get(args.outboundId);
    if (message && message.state !== "sent") await ctx.db.patch(args.outboundId, { state: "failed", leaseUntil: undefined, error: args.error.slice(0, 500) });
    if (args.inboundId) {
      const inbound = await ctx.db.get(args.inboundId);
      if (inbound && inbound.state !== "replied" && inbound.state !== "handoff") await ctx.db.patch(args.inboundId, { state: "failed", leaseUntil: undefined, error: args.error.slice(0, 500) });
    }
    return { ok: true };
  },
});

export const replyContext = internalQuery({
  args: { threadId: v.id("email_threads"), inboundId: v.optional(v.id("email_messages")) },
  handler: async (ctx, args) => {
    const thread = await ctx.db.get(args.threadId);
    if (!thread) return null;
    const inbound = args.inboundId ? await ctx.db.get(args.inboundId) : null;
    const recent = await threadMessages(ctx, args.threadId, 30);
    return { thread, inbound, recent };
  },
});

function safeHtml(text: string) {
  const escaped = text.replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]!));
  const inline = escaped
    .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+|mailto:[^\s)]+)\)/g, '<a href="$2">$1</a>')
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  const blocks = inline.split(/\n\s*\n/).map((block) => {
    const lines = block.split("\n");
    if (lines.length > 1 && lines.every((line) => /^\s*[-*]\s+/.test(line))) {
      return `<ul>${lines.map((line) => `<li>${line.replace(/^\s*[-*]\s+/, "")}</li>`).join("")}</ul>`;
    }
    return `<p>${lines.join("<br/>")}</p>`;
  });
  return `<div style="font:15px/1.55 Arial,sans-serif">${blocks.join("")}</div>`;
}

function replySubject(subject: string) {
  const clean = String(subject ?? "").replace(/[\r\n\t]+/g, " ").trim().slice(0, 500) || "your rental enquiry";
  return /^re:/i.test(clean) ? clean : `Re: ${clean}`;
}

export const sendAssistantReply = action({
  args: { secret: v.string(), threadId: v.id("email_threads"), inboundId: v.id("email_messages"), text: v.string(), humanRequested: v.boolean() },
  handler: async (ctx, args) => {
    assertInboundSecret(args.secret);
    if (!businessEmailReady()) throw new Error("business email sender is not configured");
    const text = args.text.trim().slice(0, 12_000);
    if (!text) throw new Error("assistant returned an empty reply");
    const claim = await ctx.runMutation(internal.emailInbox.claimAutomaticReply, {
      threadId: args.threadId,
      inboundId: args.inboundId,
      text,
      humanRequested: args.humanRequested,
    });
    if (claim.state === "sent") return { ok: true, duplicate: true };
    if (claim.state === "busy") return { ok: false, busy: true };
    const { thread, inbound, outboundId, deliveryKey } = claim;
    // Replies go to the monitored business Gmail. Gmail's confirmed forwarding
    // route sends renter follow-ups back through the signed Resend inbound hook.
    const replyTo = OWNER_EMAIL;
    const references = [...new Set([...(inbound.references ?? []), inbound.messageId].filter((value): value is string => typeof value === "string" && value.length > 0))].slice(-20);
    const delivery = await ctx.runAction(internal.emailMailer.sendBusinessReply, {
      to: thread.email,
      subject: replySubject(thread.subject),
      html: safeHtml(text),
      replyTo,
      ...(args.humanRequested && thread.email !== OWNER_EMAIL ? { cc: [OWNER_EMAIL] } : {}),
      deliveryKey,
      inReplyTo: inbound.messageId,
      references,
    });
    if (!delivery.sent) {
      await ctx.runMutation(internal.emailInbox.markSendFailed, { outboundId, inboundId: args.inboundId, error: "business email provider rejected the reply" });
      throw new Error("business email reply could not be sent");
    }
    await ctx.runMutation(internal.emailInbox.finishAutomaticReply, {
      threadId: args.threadId,
      inboundId: args.inboundId,
      outboundId,
      text,
      messageId: delivery.messageId,
      ...(delivery.resendEmailId ? { resendEmailId: delivery.resendEmailId } : {}),
      humanRequested: args.humanRequested,
    });
    return { ok: true };
  },
});

/** Create a Gaffer call follow-up in the same durable inbox before sending it. */
export const prepareGafferFollowUp = internalMutation({
  args: { email: v.string(), name: v.string(), subject: v.string(), text: v.string(), replyKey: v.string() },
  handler: async (ctx, args) => {
    const email = args.email.trim().toLowerCase();
    const replyKey = args.replyKey.trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || !/^[a-f0-9]{24}$/.test(replyKey)) {
      throw new Error("Invalid Gaffer follow-up recipient or thread key");
    }
    const deliveryKey = `gaffer-follow-up:${replyKey}`;
    const providerId = `out:${deliveryKey}`;
    const existing = await ctx.db.query("email_messages")
      .withIndex("by_provider", (q) => q.eq("providerId", providerId))
      .first();
    const now = Date.now();
    if (existing) {
      const thread = await ctx.db.get(existing.threadId);
      if (!thread || thread.email !== email || thread.replyKey !== replyKey) throw new Error("Gaffer follow-up outbox does not match its thread");
      if (existing.state === "sent") return { state: "sent" as const };
      if (existing.state === "processing" && (existing.leaseUntil ?? 0) > now) return { state: "busy" as const };
      await ctx.db.patch(existing._id, { state: "processing", leaseUntil: now + LEASE_MS, text: args.text, error: undefined });
      return { state: "claimed" as const, threadId: thread._id, outboundId: existing._id, deliveryKey };
    }

    const accountCandidates = await ctx.db.query("accounts")
      .withIndex("by_email", (q: any) => q.eq("email", email))
      .order("desc")
      .take(20);
    const account = accountCandidates.find((candidate) =>
      candidate.email?.trim().toLowerCase() === email &&
      candidate.emailVerificationRequired !== true &&
      candidate.blockedAt == null &&
      typeof candidate.emailVerifiedAt === "number" &&
      Number.isFinite(candidate.emailVerifiedAt) &&
      candidate.emailVerifiedAt > 0,
    ) ?? null;
    const subject = args.subject.trim().slice(0, 500) || "Following up on your call with DB Cinema Rentals";
    const text = args.text.trim().slice(0, 12_000);
    const threadId = await ctx.db.insert("email_threads", {
      email,
      name: args.name.trim().slice(0, 120) || account?.name || undefined,
      subject,
      replyKey,
      accountId: account?._id,
      verifiedRenterEmail: account ? email : undefined,
      status: "open",
      createdAt: now,
      updatedAt: now,
      lastAt: now,
      lastDirection: "out",
      lastText: text.slice(0, 280),
      unreadOwner: 0,
    });
    const outboundId = await ctx.db.insert("email_messages", {
      threadId,
      direction: "out",
      sender: OWNER_EMAIL,
      recipient: email,
      subject,
      text,
      at: now,
      providerId,
      state: "processing",
      leaseUntil: now + LEASE_MS,
      humanRequested: false,
    });
    return { state: "claimed" as const, threadId, outboundId, deliveryKey };
  },
});

export const finishGafferFollowUp = internalMutation({
  args: { threadId: v.id("email_threads"), outboundId: v.id("email_messages"), text: v.string(), messageId: v.string(), resendEmailId: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const thread = await ctx.db.get(args.threadId);
    const outbound = await ctx.db.get(args.outboundId);
    if (!thread || !outbound || outbound.threadId !== thread._id || outbound.direction !== "out") {
      throw new Error("Gaffer follow-up thread could not be finalized");
    }
    if (outbound.state === "sent") return { ok: true, duplicate: true };
    const now = Date.now();
    const providerFields = await providerDeliveryFields(ctx, outbound, args.resendEmailId);
    await ctx.db.patch(args.outboundId, { state: "sent", at: now, messageId: args.messageId, leaseUntil: undefined, error: undefined, ...providerFields });
    await ctx.db.patch(args.threadId, { updatedAt: now, lastAt: now, lastDirection: "out", lastText: args.text.slice(0, 280), status: "open" });
    if (thread.accountId) await ctx.scheduler.runAfter(0, internal.emailInbox.copyVerifiedHistory, { accountId: thread.accountId, threadId: thread._id, cursor: null });
    return { ok: true };
  },
});

export const failGafferFollowUp = internalMutation({
  args: { outboundId: v.id("email_messages"), error: v.string() },
  handler: async (ctx, args) => {
    const outbound = await ctx.db.get(args.outboundId);
    if (!outbound || outbound.direction !== "out" || outbound.state === "sent") return { ok: false };
    await ctx.db.patch(args.outboundId, { state: "failed", leaseUntil: undefined, error: args.error.slice(0, 500) });
    return { ok: true };
  },
});

export const sendGafferFollowUp = internalAction({
  args: { email: v.string(), name: v.string(), subject: v.string(), text: v.string(), replyKey: v.string() },
  handler: async (ctx, args) => {
    const replyTo = gafferReplyAddress(args.replyKey);
    if (!replyTo) throw new Error("Gaffer email reply route is not configured");
    const prepared = await ctx.runMutation(internal.emailInbox.prepareGafferFollowUp, args);
    if (prepared.state === "sent") return { ok: true, duplicate: true };
    if (prepared.state === "busy") return { ok: false, busy: true };
    try {
      const delivery = await ctx.runAction(internal.emailMailer.sendBusinessReply, {
        to: args.email.trim().toLowerCase(),
        subject: args.subject.trim().slice(0, 500) || "Following up on your call with DB Cinema Rentals",
        html: `<div style="font-family:system-ui,sans-serif;line-height:1.55;color:#111"><p>${args.name.trim() ? `Hi ${safeHtml(args.name.trim().slice(0, 120))},` : "Hi,"}</p><p>Following up on your call with DB Cinema Rentals:</p><div style="border-left:3px solid #e0992f;padding:2px 0 2px 14px;margin:16px 0">${safeHtml(args.text.trim().slice(0, 12_000))}</div><p>Reply to this email if you need anything else — it comes straight back to us.</p></div>`,
        replyTo,
        deliveryKey: prepared.deliveryKey,
        references: [],
      });
      if (!delivery.sent) throw new Error("DB Cinema email provider rejected the follow-up");
      await ctx.runMutation(internal.emailInbox.finishGafferFollowUp, {
        threadId: prepared.threadId,
        outboundId: prepared.outboundId,
        text: args.text.trim().slice(0, 12_000),
        messageId: delivery.messageId,
        ...(delivery.resendEmailId ? { resendEmailId: delivery.resendEmailId } : {}),
      });
      return { ok: true };
    } catch (error) {
      await ctx.runMutation(internal.emailInbox.failGafferFollowUp, {
        outboundId: prepared.outboundId,
        error: String((error as any)?.message ?? error),
      });
      throw error;
    }
  },
});

export const adminInbox = query({
  args: { token: v.string(), limit: v.optional(v.number()) },
  handler: async (ctx, { token, limit }) => {
    if (!checkAdminToken(token)) return { authorized: false as const, items: [] };
    const count = Math.min(100, Math.max(1, Math.floor(limit ?? 100)));
    const rows = await ctx.db.query("email_threads").withIndex("by_updated").order("desc").take(count);
    const replySetupStatus = businessEmailReadiness();
    return { authorized: true as const, items: rows, replyConfigured: replySetupStatus === "ready", replySetupStatus, outboundSenderAddress: configuredBusinessSender(), replyToAddress: OWNER_EMAIL, inboundForwardingAddress: configuredForwardingAddress() };
  },
});

export const adminThread = query({
  args: { token: v.string(), threadId: v.id("email_threads") },
  handler: async (ctx, { token, threadId }) => {
    if (!checkAdminToken(token)) return { authorized: false as const, thread: null, messages: [] };
    const thread = await ctx.db.get(threadId);
    const replySetupStatus = businessEmailReadiness();
    const replyConfigured = replySetupStatus === "ready";
    const outboundSenderAddress = configuredBusinessSender();
    const replyToAddress = OWNER_EMAIL;
    const inboundForwardingAddress = configuredForwardingAddress();
    if (!thread) return { authorized: true as const, thread: null, messages: [], replyConfigured, replySetupStatus, outboundSenderAddress, replyToAddress, inboundForwardingAddress };
    const messages = (await threadMessages(ctx, threadId, 40)).reverse();
    return { authorized: true as const, thread, messages, replyConfigured, replySetupStatus, outboundSenderAddress, replyToAddress, inboundForwardingAddress };
  },
});

export const markRead = mutation({
  args: { token: v.string(), threadId: v.id("email_threads") },
  handler: async (ctx, { token, threadId }) => {
    await assertAdmin(ctx, token, "emailInbox.markRead");
    const thread = await ctx.db.get(threadId);
    if (thread && (thread.unreadOwner ?? 0) !== 0) {
      await ctx.db.patch(threadId, { unreadOwner: 0 });
    }
    return { ok: true };
  },
});

export const reserveOwnerReply = internalMutation({
  args: { threadId: v.id("email_threads"), text: v.string(), deliveryKey: v.string(), inReplyTo: v.optional(v.string()), references: v.array(v.string()) },
  handler: async (ctx, args) => {
    const thread = await ctx.db.get(args.threadId);
    if (!thread) throw new Error("email thread not found");
    const outboxKey = `out:${args.deliveryKey}`;
    const existing = await ctx.db.query("email_messages").withIndex("by_provider", (q) => q.eq("providerId", outboxKey)).first();
    const now = Date.now();
    if (existing?.state === "sent") return { state: "sent" as const };
    if (existing?.state === "processing" && (existing.leaseUntil ?? 0) > now) return { state: "busy" as const };
    const outboundId = existing?._id ?? await ctx.db.insert("email_messages", {
      threadId: args.threadId,
      direction: "out",
      sender: OWNER_EMAIL,
      recipient: thread.email,
      subject: thread.subject,
      text: args.text,
      at: now,
      providerId: outboxKey,
      state: "processing",
      leaseUntil: now + LEASE_MS,
      inReplyTo: args.inReplyTo,
      references: args.references,
      humanRequested: true,
    });
    if (existing) await ctx.db.patch(existing._id, { state: "processing", leaseUntil: now + LEASE_MS, text: args.text, error: undefined });
    return { state: "claimed" as const, thread, outboundId };
  },
});

export const finishOwnerReply = internalMutation({
  args: { threadId: v.id("email_threads"), outboundId: v.id("email_messages"), text: v.string(), messageId: v.string(), resendEmailId: v.optional(v.string()), inReplyTo: v.optional(v.string()), references: v.array(v.string()) },
  handler: async (ctx, args) => {
    const thread = await ctx.db.get(args.threadId);
    const out = await ctx.db.get(args.outboundId);
    if (!thread || !out) throw new Error("owner reply context not found");
    if (out.state === "sent") return { ok: true, duplicate: true };
    const now = Date.now();
    const providerFields = await providerDeliveryFields(ctx, out, args.resendEmailId);
    await ctx.db.patch(args.outboundId, { state: "sent", at: now, messageId: args.messageId, inReplyTo: args.inReplyTo, references: args.references, leaseUntil: undefined, ...providerFields });
    await ctx.db.patch(args.threadId, { updatedAt: now, lastAt: now, lastDirection: "out", lastText: args.text.slice(0, 280), unreadOwner: 0, status: "open" });
    if (thread.accountId) await postRentalMessage(ctx, { accountId: thread.accountId, sender: "owner", text: args.text, meta: { channel: "email", emailThreadId: String(thread._id), emailMessageId: String(args.outboundId) } });
    return { ok: true };
  },
});

export const sendOwnerReply = action({
  args: { token: v.string(), threadId: v.id("email_threads"), text: v.string() },
  handler: async (ctx, args) => {
    if (!checkAdminToken(args.token)) throw new Error("unauthorized");
    const text = args.text.trim().slice(0, 12_000);
    if (!text) throw new Error("Write a reply first.");
    const data = await ctx.runQuery(internal.emailInbox.replyContext, { threadId: args.threadId });
    if (!data?.thread) throw new Error("email thread not found");
    const latest = data.recent[0];
    const inReplyTo = latest?.messageId;
    const references = [...new Set([...(latest?.references ?? []), inReplyTo].filter((value): value is string => typeof value === "string" && value.length > 0))].slice(-20);
    const deliveryKey = `email-owner:${args.threadId}:${Date.now()}`;
    const claim = await ctx.runMutation(internal.emailInbox.reserveOwnerReply, { threadId: args.threadId, text, deliveryKey, inReplyTo, references });
    if (claim.state === "sent") return { ok: true, duplicate: true };
    if (claim.state === "busy") return { ok: false, busy: true };
    const delivery = await ctx.runAction(internal.emailMailer.sendBusinessReply, {
      to: data.thread.email,
      subject: replySubject(data.thread.subject),
      html: safeHtml(text),
      replyTo: OWNER_EMAIL,
      deliveryKey,
      inReplyTo,
      references,
    });
    if (!delivery.sent) {
      await ctx.runMutation(internal.emailInbox.markSendFailed, { outboundId: claim.outboundId, error: "business email provider rejected the reply" });
      throw new Error("business email reply could not be sent");
    }
    await ctx.runMutation(internal.emailInbox.finishOwnerReply, { threadId: args.threadId, outboundId: claim.outboundId, text, messageId: delivery.messageId, ...(delivery.resendEmailId ? { resendEmailId: delivery.resendEmailId } : {}), inReplyTo, references });
    return { ok: true };
  },
});

/** Only authenticated, verified ownership can attach pre-signup email history. */
export const claimForAccount = mutation({
  args: { token: v.string() },
  handler: async (ctx, { token }) => {
    const account = await accountForToken(ctx, token);
    if (!account || !account.emailVerifiedAt || account.emailVerificationRequired || account.blockedAt != null) return { ok: false };
    await ctx.scheduler.runAfter(0, internal.emailInbox.linkVerifiedHistory, { accountId: account._id, cursor: null });
    return { ok: true };
  },
});

export const linkVerifiedHistory = internalMutation({
  args: { accountId: v.id("accounts"), cursor: v.union(v.string(), v.null()) },
  handler: async (ctx, { accountId, cursor }) => {
    const account = await ctx.db.get(accountId);
    if (!account || !account.emailVerifiedAt || account.emailVerificationRequired || account.blockedAt != null) return;
    const page = await ctx.db.query("email_threads").withIndex("by_email_updated", q => q.eq("email", account.email.trim().toLowerCase())).paginate({ cursor, numItems: 10 });
    for (const thread of page.page) {
      if (thread.accountId) continue;
      await ctx.db.patch(thread._id, { accountId, verifiedRenterEmail: account.email });
      await ctx.scheduler.runAfter(0, internal.emailInbox.copyVerifiedHistory, { accountId, threadId: thread._id, cursor: null });
    }
    if (!page.isDone) await ctx.scheduler.runAfter(0, internal.emailInbox.linkVerifiedHistory, { accountId, cursor: page.continueCursor });
  },
});

export const copyVerifiedHistory = internalMutation({
  args: { accountId: v.id("accounts"), threadId: v.id("email_threads"), cursor: v.union(v.string(), v.null()) },
  handler: async (ctx, { accountId, threadId, cursor }) => {
    const account = await ctx.db.get(accountId), thread = await ctx.db.get(threadId);
    if (!account || !thread || thread.accountId !== accountId || thread.email !== account.email || !account.emailVerifiedAt || account.emailVerificationRequired || account.blockedAt != null) return;
    const page = await ctx.db.query("email_messages").withIndex("by_thread_at", q => q.eq("threadId", threadId)).order("asc").paginate({ cursor, numItems: 40 });
    for (const message of page.page) {
      if (message.profileMessageId || (message.direction === "out" && message.state !== "sent")) continue;
      // Preserve original timestamps; backfill must not emit a new renter message or alert.
      const id = await ctx.db.insert("messages", { accountId, sender: message.direction === "in" ? "renter" : "bot", text: message.text, at: message.at, readByOwner: true, threadCounted: true, meta: { channel: "email", emailThreadId: String(threadId), emailMessageId: String(message._id) } });
      await ctx.db.patch(message._id, { profileMessageId: id });
      const general = await rentalThread(ctx, accountId);
      if (!general) await ctx.db.insert("chat_threads", { accountId, escalated: thread.status === "human_requested", updatedAt: message.at, lastMessage: message.text.slice(0, 160), lastSender: message.direction === "in" ? "renter" : "bot", unreadOwner: 0, unreadRenter: 0 });
      else if (message.at > general.updatedAt) await ctx.db.patch(general._id, { updatedAt: message.at, lastMessage: message.text.slice(0, 160), lastSender: message.direction === "in" ? "renter" : "bot" });
    }
    if (!page.isDone) await ctx.scheduler.runAfter(0, internal.emailInbox.copyVerifiedHistory, { accountId, threadId, cursor: page.continueCursor });
  },
});

/** Prepare a private, expiring rental basket without sending another email. */
export const prepareQuotedCart = mutation({
  args: { secret: v.string(), inboundId: v.id("email_messages"), shareKey: v.string(), lines: v.array(cartLine) },
  handler: async (ctx, a) => {
    assertInboundSecret(a.secret);
    if (!/^[A-Za-z0-9_-]{43}$/.test(a.shareKey) || !a.lines.length || a.lines.length > 100) throw new Error("Invalid proposed basket");
    const inbound = await ctx.db.get(a.inboundId);
    const thread = inbound && await ctx.db.get(inbound.threadId);
    if (!inbound || inbound.direction !== "in" || !thread || inbound.state !== "processing") throw new Error("Email is not claimed");
    const existing = await ctx.db.query("checkout_carts").withIndex("by_share", q => q.eq("shareKey", a.shareKey)).unique();
    if (existing) return { ok: true };
    for (const line of a.lines) if (!Number.isSafeInteger(line.start) || !Number.isSafeInteger(line.end) || line.end < line.start || line.end - line.start > 365 * 86400000 || !line.pickupTime || !line.returnTime || !await ctx.db.get(line.listingId)) throw new Error("Invalid proposed item");
    await ctx.db.insert("checkout_carts", { email: thread.email, accountId: thread.accountId, shareKey: a.shareKey, lines: a.lines, createdAt: Date.now(), expiresAt: Date.now() + 7 * 86400000 });
    return { ok: true };
  },
});
