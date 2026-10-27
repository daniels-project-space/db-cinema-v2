import { v } from "convex/values";
import { action, internalMutation, internalQuery, mutation, query } from "./_generated/server";
import { internal } from "./_generated/api";
import { assertAdmin, checkAdminToken } from "./adminAuth";
import { postRentalMessage } from "./lib/rentalChat";

const OWNER_EMAIL = "dbcinemarentals@gmail.com";
const LEASE_MS = 2 * 60_000;
const HUMAN_ALERT_RETRY_DELAYS_MS = [15_000, 60_000] as const;

function assertInboundSecret(secret: string) {
  const expected = process.env.INBOUND_EMAIL_SECRET;
  if (!expected || secret !== expected) throw new Error("unauthorized");
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

    const accountCandidate = await ctx.db.query("accounts")
      .withIndex("by_email", (q: any) => q.eq("email", email))
      .first();
    const account = accountCandidate &&
      accountCandidate.email?.trim().toLowerCase() === email &&
      accountCandidate.emailVerificationRequired !== true &&
      typeof accountCandidate.emailVerifiedAt === "number" &&
      Number.isFinite(accountCandidate.emailVerifiedAt) &&
      accountCandidate.emailVerifiedAt > 0
      ? accountCandidate
      : null;
    let thread: any = null;
    const correlationIds = [...new Set([args.inReplyTo, ...args.references].filter(Boolean))];
    for (const messageId of correlationIds) {
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
      await postRentalMessage(ctx, {
        accountId: account._id,
        sender: "renter",
        text: body,
        meta: { channel: "email", emailThreadId: String(thread._id), emailMessageId: String(inboundId) },
      });
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
    if (humanRequested && thread.humanNotifiedMessageId !== inboundId) {
      await ctx.db.patch(thread._id, { status: "human_requested", humanNotifiedAt: now, humanNotifiedMessageId: inboundId });
      await ctx.scheduler.runAfter(0, internal.notify.emailHumanRequestAlert, {
        email: thread.email,
        subject: thread.subject,
        body: message.text.slice(0, 3000),
        inboundId,
        attempt: 1,
      });
    }
    return { state: "claimed" as const, threadId: message.threadId, inboundId, history: await historyFor(ctx, message.threadId), email: thread.email };
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
    return { state: "claimed" as const, outboundId, deliveryKey, thread, inbound };
  },
});

export const finishAutomaticReply = internalMutation({
  args: { threadId: v.id("email_threads"), inboundId: v.id("email_messages"), outboundId: v.id("email_messages"), text: v.string(), messageId: v.string(), humanRequested: v.boolean() },
  handler: async (ctx, args) => {
    const thread = await ctx.db.get(args.threadId);
    const inbound = await ctx.db.get(args.inboundId);
    const outbound = await ctx.db.get(args.outboundId);
    if (!thread || !inbound || !outbound) throw new Error("email reply could not be recorded");
    if (outbound.state === "sent") return { ok: true, duplicate: true };
    const now = Date.now();
    const references = [...new Set([...(inbound.references ?? []), inbound.messageId].filter((value): value is string => typeof value === "string" && value.length > 0))].slice(-20);
    await ctx.db.patch(args.outboundId, { state: "sent", at: now, messageId: args.messageId, inReplyTo: inbound.messageId, references, leaseUntil: undefined, error: undefined });
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
      await postRentalMessage(ctx, { accountId: thread.accountId, sender: "bot", text: args.text, meta: { channel: "email", emailThreadId: String(thread._id), emailMessageId: String(args.outboundId) } });
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
    const references = [...new Set([...(inbound.references ?? []), inbound.messageId].filter((value): value is string => typeof value === "string" && value.length > 0))].slice(-20);
    const delivery = await ctx.runAction(internal.emailMailer.sendBusinessReply, {
      to: thread.email,
      subject: replySubject(thread.subject),
      html: safeHtml(text),
      replyTo: OWNER_EMAIL,
      deliveryKey,
      inReplyTo: inbound.messageId,
      references,
    });
    if (!delivery.sent) {
      await ctx.runMutation(internal.emailInbox.markSendFailed, { outboundId, inboundId: args.inboundId, error: "business Gmail SMTP rejected the reply" });
      throw new Error("business email reply could not be sent");
    }
    await ctx.runMutation(internal.emailInbox.finishAutomaticReply, {
      threadId: args.threadId,
      inboundId: args.inboundId,
      outboundId,
      text,
      messageId: delivery.messageId,
      humanRequested: args.humanRequested,
    });
    return { ok: true };
  },
});

export const adminInbox = query({
  args: { token: v.string(), limit: v.optional(v.number()) },
  handler: async (ctx, { token, limit }) => {
    if (!checkAdminToken(token)) return { authorized: false as const, items: [] };
    const count = Math.min(100, Math.max(1, Math.floor(limit ?? 100)));
    const rows = await ctx.db.query("email_threads").withIndex("by_updated").order("desc").take(count);
    return { authorized: true as const, items: rows };
  },
});

export const adminThread = query({
  args: { token: v.string(), threadId: v.id("email_threads") },
  handler: async (ctx, { token, threadId }) => {
    if (!checkAdminToken(token)) return { authorized: false as const, thread: null, messages: [] };
    const thread = await ctx.db.get(threadId);
    if (!thread) return { authorized: true as const, thread: null, messages: [] };
    const messages = (await threadMessages(ctx, threadId, 40)).reverse();
    return { authorized: true as const, thread, messages };
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
  args: { threadId: v.id("email_threads"), outboundId: v.id("email_messages"), text: v.string(), messageId: v.string(), inReplyTo: v.optional(v.string()), references: v.array(v.string()) },
  handler: async (ctx, args) => {
    const thread = await ctx.db.get(args.threadId);
    const out = await ctx.db.get(args.outboundId);
    if (!thread || !out) throw new Error("owner reply context not found");
    if (out.state === "sent") return { ok: true, duplicate: true };
    const now = Date.now();
    await ctx.db.patch(args.outboundId, { state: "sent", at: now, messageId: args.messageId, inReplyTo: args.inReplyTo, references: args.references, leaseUntil: undefined });
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
      await ctx.runMutation(internal.emailInbox.markSendFailed, { outboundId: claim.outboundId, error: "business Gmail SMTP rejected the reply" });
      throw new Error("business email reply could not be sent");
    }
    await ctx.runMutation(internal.emailInbox.finishOwnerReply, { threadId: args.threadId, outboundId: claim.outboundId, text, messageId: delivery.messageId, inReplyTo, references });
    return { ok: true };
  },
});
