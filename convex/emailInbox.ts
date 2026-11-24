import { v } from "convex/values";
import { paginationOptsValidator } from "convex/server";
import { queueOwnerNotification } from "./lib/adminPush";
import { cartLine } from "./checkoutCartData";
import { action, internalAction, internalMutation, internalQuery, mutation, query } from "./_generated/server";
import { internal } from "./_generated/api";
import { assertAdmin, checkAdminToken } from "./adminAuth";
import { postRentalMessage, accountForToken, rentalThread } from "./lib/rentalChat";
import { accountForRental, belongsToRentalAccount } from "./lib/rentalAccount";
import { BUSINESS_CONTACT_EMAIL, isBusinessSender } from "../shared/businessEmail";
import { mergeEmailRecipientDeliveryStatuses, type EmailRecipientDeliveryStatus, type ResendDeliveryStatus } from "../shared/emailDeliveryStatus";
import { checkoutCartUrl } from "../shared/checkoutCartUrl";
import { archiveCaseConversation } from "./lib/chatCaseArchive";
import { renterHandoverDetailsReady } from "./lib/renterRentalActionGate";
import { gafferCancellationFacts } from "./lib/gafferCancellationFacts";
import { verificationValidUntil } from "../shared/verificationProgress";
import { LEO_SUPPORT_PHONE, TRAFALGAR_PICKUP_ADDRESS, TRAFALGAR_PICKUP_INSTRUCTIONS } from "../shared/pickupLocation";

const OWNER_EMAIL = BUSINESS_CONTACT_EMAIL;
const LEASE_MS = 2 * 60_000;
const HUMAN_ALERT_RETRY_DELAYS_MS = [15_000, 60_000] as const;
const UNMATCHED_DELIVERY_EVENT_TTL_MS = 24 * 60 * 60_000;
const EMAIL_ADDRESS_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const DEFINITE_GAFFER_REJECTION = "Definite provider rejection: ";
const DEFINITE_EMAIL_REPLY_REJECTION = "Definite provider rejection: ";
const SAFE_EMAIL_REPLY_PREFLIGHT_FAILURE = "Safe retry before provider handoff: ";

function emailReplyFailureIsRetryable(message: any) {
  return typeof message?.error === "string" && (
    message.error.startsWith(DEFINITE_EMAIL_REPLY_REJECTION) ||
    message.error.startsWith(SAFE_EMAIL_REPLY_PREFLIGHT_FAILURE)
  );
}

function makeReplyKey() {
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function bookingReferences(...values: Array<string | undefined>) {
  const references = new Set<string>();
  for (const value of values) {
    if (typeof value !== "string") continue;
    for (const match of value.matchAll(/(?:^|[^A-Z0-9])DBC-([A-Z0-9]{8})(?![A-Z0-9])/gi)) {
      references.add(match[1].toUpperCase());
    }
  }
  return [...references];
}

async function verifiedAccountForEmail(ctx: any, email: string) {
  const result = await ctx.db.query("accounts")
    .withIndex("by_email", (q: any) => q.eq("email", email))
    .order("desc")
    .take(21);
  if (result.length > 20) return null;
  const matches = result.filter((candidate: any) =>
    candidate.email?.trim().toLowerCase() === email &&
    candidate.emailVerificationRequired !== true &&
    typeof candidate.emailVerifiedAt === "number" &&
    Number.isFinite(candidate.emailVerifiedAt) &&
    candidate.emailVerifiedAt > 0 &&
    candidate.blockedAt == null,
  );
  return matches.length === 1 ? matches[0] : null;
}

async function ownedBookingForReference(ctx: any, account: any, reference: string) {
  if (!account) return null;
  const email = account.email.trim().toLowerCase();
  const [linked, legacy] = await Promise.all([
    ctx.db.query("bookings").withIndex("by_account", (q: any) => q.eq("accountId", account._id)).take(1001),
    ctx.db.query("bookings").withIndex("by_guestEmail", (q: any) => q.eq("guestEmail", email)).take(1001),
  ]);
  if (linked.length > 1000 || legacy.length > 1000) return null;
  const matching = new Map<string, any>();
  for (const booking of [...linked, ...legacy]) {
    if (!belongsToRentalAccount(booking, account)) continue;
    if (String(booking._id).slice(-8).toUpperCase() === reference) matching.set(String(booking._id), booking);
  }
  return matching.size === 1 ? [...matching.values()][0] : null;
}

function threadOwnershipMatches(thread: any, account: any, email: string) {
  if (thread.accountId && (!account || thread.accountId !== account._id)) return false;
  if (thread.verifiedRenterEmail && thread.verifiedRenterEmail.trim().toLowerCase() !== email) return false;
  return true;
}

function threadBookingMatches(thread: any, bookingId: any, hasReference: boolean, privateReply: boolean) {
  if (thread.bookingId) return hasReference ? !!bookingId && thread.bookingId === bookingId : privateReply || !!bookingId && thread.bookingId === bookingId;
  if (hasReference) return !!bookingId;
  return privateReply || !bookingId;
}

function chatSenderForEmailMessage(message: any) {
  if (message.direction === "in") return "renter" as const;
  if (message.chatSender === "owner" || message.chatSender === "bot") return message.chatSender;
  if (/^out:email-(owner|chat):/.test(String(message.providerId ?? ""))) return "owner" as const;
  return "bot" as const;
}

async function verifiedEmailBookingId(ctx: any, thread: any, bookingId: any, account?: any) {
  if (!thread?.accountId || !bookingId) return null;
  const linkedAccount = account ?? await ctx.db.get(thread.accountId);
  const email = linkedAccount?.email?.trim().toLowerCase();
  if (
    !linkedAccount || linkedAccount._id !== thread.accountId || linkedAccount.blockedAt != null ||
    !linkedAccount.emailVerifiedAt || linkedAccount.emailVerificationRequired === true ||
    !email || thread.email.trim().toLowerCase() !== email ||
    thread.verifiedRenterEmail?.trim().toLowerCase() !== email
  ) return null;
  const booking = await ctx.db.get(bookingId);
  return belongsToRentalAccount(booking, linkedAccount) ? booking._id : null;
}

async function verifiedThreadBooking(ctx: any, thread: any, account: any) {
  const bookingId = await verifiedEmailBookingId(ctx, thread, thread?.bookingId, account);
  return bookingId ? await ctx.db.get(bookingId) : null;
}

async function historyBookingId(ctx: any, account: any, message: any) {
  if (message.bookingId) {
    const booking = await ctx.db.get(message.bookingId);
    return belongsToRentalAccount(booking, account) ? booking._id : null;
  }
  const references = bookingReferences(message.subject, message.text);
  if (references.length !== 1) return null;
  const booking = await ownedBookingForReference(ctx, account, references[0]);
  return booking?._id ?? null;
}

async function upsertBackfilledChatThread(ctx: any, accountId: any, bookingId: any, message: any, emailThread: any) {
  const threadBookingId = bookingId ?? undefined;
  const chatThread = await rentalThread(ctx, accountId, threadBookingId);
  let threadId = chatThread?._id;
  let caseArchivedAt = chatThread?.caseArchivedAt;
  if (!chatThread) {
    threadId = await ctx.db.insert("chat_threads", {
      accountId,
      ...(threadBookingId ? { bookingId: threadBookingId } : {}),
      escalated: !threadBookingId && emailThread.status === "human_requested",
      updatedAt: message.at,
      lastMessage: message.text.slice(0, 160),
      lastSender: chatSenderForEmailMessage(message),
      unreadOwner: 0,
      unreadRenter: 0,
    });
  } else if (message.at > chatThread.updatedAt) {
    await ctx.db.patch(chatThread._id, {
      updatedAt: message.at,
      lastMessage: message.text.slice(0, 160),
      lastSender: chatSenderForEmailMessage(message),
      ...(chatThread.closedAt !== undefined && message.at > chatThread.closedAt ? { closedAt: undefined } : {}),
    });
  }
  if (threadBookingId && threadId && caseArchivedAt === undefined) {
    const cases = await ctx.db.query("rental_damage_cases")
      .withIndex("by_booking", (q: any) => q.eq("bookingId", threadBookingId))
      .collect();
    for (const caseRecord of cases) {
      const archive = await archiveCaseConversation(ctx, caseRecord);
      caseArchivedAt = caseArchivedAt === undefined ? archive?.archivedAt : Math.min(caseArchivedAt, archive?.archivedAt ?? caseArchivedAt);
    }
  }
}

function isOwnerReplyId(replyId: string) {
  return /^[a-z0-9_-]{16,80}$/i.test(replyId);
}

export function gafferReplyAddress(replyKey: string, configuredAddress = process.env.INBOUND_REPLY_ADDRESS) {
  const address = configuredAddress?.trim().toLowerCase();
  if (!/^[a-f0-9]{24}$/i.test(replyKey) || !address || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(address)) return null;
  const domain = address.slice(address.lastIndexOf("@") + 1);
  return `gaffer+${replyKey.toLowerCase()}@${domain}`;
}

export const prepareRentalEmailThread = internalMutation({
  args: {
    deliveryId: v.id("rental_email_deliveries"),
    generation: v.number(),
    recipientEmail: v.string(),
    subject: v.string(),
    text: v.string(),
  },
  handler: async (ctx, args) => {
    const delivery = await ctx.db.get(args.deliveryId);
    if (!delivery || delivery.state !== "sending" || delivery.generation !== args.generation || delivery.dueAt <= Date.now()) {
      return { ok: false as const };
    }
    const booking = await ctx.db.get(delivery.bookingId);
    const rentalAccount = await accountForRental(ctx, booking);
    const currentRecipient = rentalAccount?.email ?? (booking?.accountId ? null : booking?.guestEmail);
    const recipient = args.recipientEmail.trim().toLowerCase();
    if (!booking || !EMAIL_ADDRESS_RE.test(recipient) || !currentRecipient ||
      currentRecipient.trim().toLowerCase() !== recipient ||
      delivery.recipientEmail?.trim().toLowerCase() !== recipient) {
      return { ok: false as const };
    }

    const providerId = `rental-email:${String(delivery._id)}`;
    const existing = await ctx.db.query("email_messages")
      .withIndex("by_provider", (q: any) => q.eq("providerId", providerId))
      .first();
    const now = Date.now();
    if (existing) {
      const thread = await ctx.db.get(existing.threadId);
      if (!thread || existing.direction !== "out" || thread.email !== recipient ||
        thread.bookingId !== delivery.bookingId || !thread.replyKey) {
        throw new Error("Rental email outbox does not match its delivery thread");
      }
      const replyTo = gafferReplyAddress(thread.replyKey);
      if (!replyTo) throw new Error("Gaffer email reply route is not configured");
      if (existing.state === "sent") {
        return { ok: true as const, tracked: true as const, alreadySent: true as const, replyTo: gafferReplyAddress(thread.replyKey)!, ...(existing.resendEmailId ? { resendEmailId: existing.resendEmailId } : {}) };
      }
      if (existing.state === "uncertain") {
        return { ok: true as const, tracked: true as const, uncertain: true as const, replyTo: gafferReplyAddress(thread.replyKey)! };
      }
      if (existing.state === "processing" && (existing.leaseUntil ?? 0) > now) {
        return { ok: true as const, tracked: true as const, busy: true as const, replyTo: gafferReplyAddress(thread.replyKey)! };
      }
      await ctx.db.patch(existing._id, {
        state: "processing",
        leaseUntil: delivery.dueAt,
        error: undefined,
      });
      return { ok: true as const, tracked: true as const, replyTo: gafferReplyAddress(thread.replyKey)! };
    }

    const verifiedAccount = await verifiedAccountForEmail(ctx, recipient);
    const linkedAccount = booking.accountId && verifiedAccount?._id === booking.accountId &&
      belongsToRentalAccount(booking, verifiedAccount) ? verifiedAccount : null;
    const subject = args.subject.trim().slice(0, 500) || "Rental email";
    const text = args.text.trim().slice(0, 12_000) || subject;
    const recent = await ctx.db.query("email_threads").withIndex("by_email_updated", (q: any) => q.eq("email", recipient)).order("desc").take(20);
    const candidates = recent.filter((thread: any) => thread.bookingId === booking._id &&
      (!thread.accountId || thread.accountId === booking.accountId) && !!thread.replyKey);
    const prior = candidates.length === 1 ? candidates[0] : null;
    const replyKey = prior?.replyKey ?? makeReplyKey();
    const replyTo = gafferReplyAddress(replyKey);
    if (!replyTo) throw new Error("Gaffer email reply route is not configured");
    const threadId = prior?._id ?? await ctx.db.insert("email_threads", {
      email: recipient,
      name: linkedAccount?.name,
      subject,
      replyKey,
      ...(linkedAccount ? { accountId: linkedAccount._id, verifiedRenterEmail: recipient } : {}),
      bookingId: booking._id,
      status: "open",
      createdAt: now,
      updatedAt: now,
      lastAt: now,
      lastDirection: "out",
      lastText: text.slice(0, 280),
      unreadOwner: 0,
    });
    await ctx.db.insert("email_messages", {
      threadId,
      bookingId: booking._id,
      direction: "out",
      chatSender: "bot",
      sender: OWNER_EMAIL,
      recipient,
      subject,
      text,
      at: now,
      providerId,
      state: "processing",
      leaseUntil: delivery.dueAt,
      humanRequested: false,
    });
    return { ok: true as const, tracked: true as const, replyTo };
  },
});

export const finishRentalEmailThread = internalMutation({
  args: {
    deliveryId: v.id("rental_email_deliveries"),
    generation: v.number(),
    result: v.union(v.literal("sent"), v.literal("failed"), v.literal("uncertain")),
    resendEmailId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const delivery = await ctx.db.get(args.deliveryId);
    if (!delivery || delivery.state !== "sending" || delivery.generation !== args.generation) return false;
    const providerId = `rental-email:${String(delivery._id)}`;
    const outbound = await ctx.db.query("email_messages")
      .withIndex("by_provider", (q: any) => q.eq("providerId", providerId))
      .first();
    if (!outbound || outbound.direction !== "out") return false;
    if (outbound.state === "sent") return true;
    const now = Date.now();
    await ctx.db.patch(outbound._id, {
      state: args.result,
      ...(args.result === "sent" ? { at: now } : {}),
      resendEmailId: args.resendEmailId,
      leaseUntil: undefined,
      error: args.result === "failed" ? "Transport did not accept email" : args.result === "uncertain" ? "Resend may have accepted this email; check delivery before retrying." : undefined,
    });
    await ctx.db.patch(outbound.threadId, {
      updatedAt: now,
      ...(args.result === "sent" ? { lastAt: now } : {}),
    });
    return true;
  },
});

export const prepareReturnStatementEmail = internalMutation({
  args: {
    bookingId: v.id("bookings"),
    recipientEmail: v.string(),
    subject: v.string(),
    text: v.string(),
  },
  handler: async (ctx, args) => {
    const booking = await ctx.db.get(args.bookingId);
    if (!booking || booking.status !== "returned" || booking.returnStatementEmailStatus !== "sending" || !booking.returnStatement) {
      return { ok: false as const };
    }
    const account = await accountForRental(ctx, booking);
    const currentRecipient = account?.email ?? (booking.accountId ? null : booking.guestEmail);
    const recipient = args.recipientEmail.trim().toLowerCase();
    const statementRecipient = booking.returnStatement.customerEmail?.trim().toLowerCase();
    if (!currentRecipient || !EMAIL_ADDRESS_RE.test(recipient) ||
      currentRecipient.trim().toLowerCase() !== recipient || statementRecipient !== recipient) {
      return { ok: false as const, recipientChanged: true as const };
    }

    const deliveryKey = `return-statement:${String(booking._id)}`;
    const existing = await ctx.db.query("email_messages")
      .withIndex("by_provider", (q: any) => q.eq("providerId", deliveryKey))
      .first();
    const now = Date.now();
    if (existing) {
      const thread = await ctx.db.get(existing.threadId);
      if (!thread || existing.direction !== "out" || existing.recipient?.trim().toLowerCase() !== recipient ||
        thread.email.trim().toLowerCase() !== recipient || thread.bookingId !== booking._id || !thread.replyKey ||
        existing.subject !== args.subject || existing.text !== args.text) {
        return { ok: false as const, recipientChanged: true as const };
      }
      const replyTo = gafferReplyAddress(thread.replyKey);
      if (!replyTo) throw new Error("Gaffer email reply route is not configured");
      if (existing.state === "sent") return { ok: true as const, state: "sent" as const, deliveryKey, replyTo };
      if (existing.state === "processing" && (existing.leaseUntil ?? 0) > now) {
        return { ok: true as const, state: "busy" as const, deliveryKey, replyTo };
      }
      await ctx.db.patch(existing._id, {
        state: "processing",
        leaseUntil: now + LEASE_MS,
        error: undefined,
      });
      return { ok: true as const, state: "claimed" as const, deliveryKey, replyTo };
    }

    const replyKey = makeReplyKey();
    const replyTo = gafferReplyAddress(replyKey);
    if (!replyTo) throw new Error("Gaffer email reply route is not configured");
    const linkedAccount = account && account.email.trim().toLowerCase() === recipient &&
      belongsToRentalAccount(booking, account) && typeof account.emailVerifiedAt === "number" &&
      account.emailVerificationRequired !== true ? account : null;
    const subject = args.subject.trim().slice(0, 500) || "Rental return statement";
    const text = args.text.trim().slice(0, 12_000) || subject;
    const threadId = await ctx.db.insert("email_threads", {
      email: recipient,
      name: linkedAccount?.name ?? booking.guestName ?? undefined,
      subject,
      replyKey,
      ...(linkedAccount ? { accountId: linkedAccount._id, verifiedRenterEmail: recipient } : {}),
      bookingId: booking._id,
      status: "open",
      createdAt: now,
      updatedAt: now,
      lastAt: now,
      lastDirection: "out",
      lastText: text.slice(0, 280),
      unreadOwner: 0,
    });
    await ctx.db.insert("email_messages", {
      threadId,
      bookingId: booking._id,
      direction: "out",
      chatSender: "bot",
      sender: OWNER_EMAIL,
      recipient,
      subject,
      text,
      at: now,
      providerId: deliveryKey,
      state: "processing",
      leaseUntil: now + LEASE_MS,
      humanRequested: false,
    });
    return { ok: true as const, state: "claimed" as const, deliveryKey, replyTo };
  },
});

export const finishReturnStatementEmail = internalMutation({
  args: {
    bookingId: v.id("bookings"),
    result: v.union(v.literal("sent"), v.literal("failed"), v.literal("uncertain")),
    resendEmailId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const deliveryKey = `return-statement:${String(args.bookingId)}`;
    const outbound = await ctx.db.query("email_messages")
      .withIndex("by_provider", (q: any) => q.eq("providerId", deliveryKey))
      .first();
    if (!outbound || outbound.direction !== "out" || outbound.bookingId !== args.bookingId) return false;
    if (outbound.state === "sent") return true;
    if (outbound.state !== "processing") return false;
    const thread = await ctx.db.get(outbound.threadId);
    if (!thread || thread.bookingId !== args.bookingId || thread.email.trim().toLowerCase() !== outbound.recipient?.trim().toLowerCase()) return false;
    const now = Date.now();
    const providerFields = args.result === "sent" ? await providerDeliveryFields(ctx, outbound, args.resendEmailId) : {};
    await ctx.db.patch(outbound._id, {
      state: args.result,
      ...(args.result === "sent" ? { at: now } : {}),
      leaseUntil: undefined,
      error: args.result === "failed" ? "Transport did not accept email" : undefined,
      ...providerFields,
    });
    await ctx.db.patch(thread._id, {
      updatedAt: now,
      ...(args.result === "sent" ? { lastAt: now } : {}),
    });
    return true;
  },
});

const RENTAL_CONTEXT_EMAIL_KEY = /^rental-(?:security|late|return|hold|change|invoice):[A-Za-z0-9:_-]{1,180}$/;

function plainRentalEmailText(value: string) {
  return value
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
    .replace(/\n[ \t]+/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, 12_000);
}

/**
 * Durable reply routing for booking-bound notices which are still assembled
 * by a domain action rather than the rental-email queue (for example saved-
 * card assessment notices and return receipts). The booking and its current
 * canonical renter email are checked before an email thread or outbox row is
 * created. The reply address is an unguessable, per-thread capability; sender
 * address alone is never used to infer the rental.
 */
export const prepareRentalContextEmail = internalMutation({
  args: {
    bookingId: v.id("bookings"),
    deliveryKey: v.string(),
    recipientEmail: v.string(),
    subject: v.string(),
    text: v.string(),
  },
  handler: async (ctx, args) => {
    const booking = await ctx.db.get(args.bookingId);
    if (!booking || !RENTAL_CONTEXT_EMAIL_KEY.test(args.deliveryKey)) return { ok: false as const };
    const recipient = args.recipientEmail.trim().toLowerCase();
    const rentalAccount = await accountForRental(ctx, booking);
    const verifiedAccount = await verifiedAccountForEmail(ctx, recipient);
    if (!rentalAccount || !verifiedAccount || verifiedAccount._id !== rentalAccount._id ||
      !belongsToRentalAccount(booking, rentalAccount) ||
      !EMAIL_ADDRESS_RE.test(recipient) || !rentalAccount.email ||
      typeof rentalAccount.emailVerifiedAt !== "number" || rentalAccount.emailVerificationRequired === true ||
      rentalAccount.blockedAt != null ||
      rentalAccount.email.trim().toLowerCase() !== recipient ||
      verifiedAccount.email.trim().toLowerCase() !== recipient ||
      !belongsToRentalAccount(booking, verifiedAccount)) return { ok: false as const };
    const canonicalRecipient = rentalAccount.email;
    if (!canonicalRecipient ||
      canonicalRecipient.trim().toLowerCase() !== recipient ||
      !belongsToRentalAccount(booking, rentalAccount)) return { ok: false as const };

    const providerId = `rental-context:${args.deliveryKey}`;
    const subject = args.subject.trim().slice(0, 500) || "Rental update";
    const text = args.text.trim().slice(0, 12_000) || subject;
    const existing = await ctx.db.query("email_messages")
      .withIndex("by_provider", (q: any) => q.eq("providerId", providerId))
      .first();
    const now = Date.now();
    if (existing) {
      const thread = await ctx.db.get(existing.threadId);
      if (!thread || existing.direction !== "out" || existing.bookingId !== booking._id ||
        thread.bookingId !== booking._id || existing.recipient?.trim().toLowerCase() !== recipient ||
        thread.email.trim().toLowerCase() !== recipient || existing.subject !== subject || existing.text !== text ||
        !thread.replyKey) throw new Error("Rental transactional email key does not match its original booking message");
      const replyTo = gafferReplyAddress(thread.replyKey);
      if (!replyTo) throw new Error("Gaffer email reply route is not configured");
      if (existing.state === "sent") return { ok: true as const, state: "sent" as const, providerId, replyTo };
      if (existing.state === "uncertain") return { ok: true as const, state: "uncertain" as const, providerId, replyTo };
      if (existing.state === "processing" && (existing.leaseUntil ?? 0) > now)
        return { ok: true as const, state: "busy" as const, providerId, replyTo };
      await ctx.db.patch(existing._id, { state: "processing", leaseUntil: now + LEASE_MS, error: undefined });
      return { ok: true as const, state: "claimed" as const, providerId, replyTo };
    }

    const linkedAccount = verifiedAccount;
    const replyKey = makeReplyKey();
    const replyTo = gafferReplyAddress(replyKey);
    if (!replyTo) throw new Error("Gaffer email reply route is not configured");
    const threadId = await ctx.db.insert("email_threads", {
      email: recipient,
      name: linkedAccount?.name ?? booking.guestName ?? undefined,
      subject,
      replyKey,
      ...(linkedAccount ? { accountId: linkedAccount._id, verifiedRenterEmail: recipient } : {}),
      bookingId: booking._id,
      status: "open",
      createdAt: now,
      updatedAt: now,
      lastAt: now,
      lastDirection: "out",
      lastText: text.slice(0, 280),
      unreadOwner: 0,
    });
    await ctx.db.insert("email_messages", {
      threadId,
      bookingId: booking._id,
      direction: "out",
      chatSender: "bot",
      sender: OWNER_EMAIL,
      recipient,
      subject,
      text,
      at: now,
      providerId,
      state: "processing",
      leaseUntil: now + LEASE_MS,
      humanRequested: false,
    });
    return { ok: true as const, state: "claimed" as const, providerId, replyTo };
  },
});

export const finishRentalContextEmail = internalMutation({
  args: {
    bookingId: v.id("bookings"),
    providerId: v.string(),
    result: v.union(v.literal("sent"), v.literal("failed"), v.literal("uncertain")),
    resendEmailId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    if (!args.providerId.startsWith("rental-context:rental-")) return false;
    const outbound = await ctx.db.query("email_messages")
      .withIndex("by_provider", (q: any) => q.eq("providerId", args.providerId))
      .first();
    if (!outbound || outbound.direction !== "out" || outbound.bookingId !== args.bookingId) return false;
    const thread = await ctx.db.get(outbound.threadId);
    if (!thread || thread.bookingId !== args.bookingId ||
      thread.email.trim().toLowerCase() !== outbound.recipient?.trim().toLowerCase()) return false;
    if (outbound.state === "sent") return true;
    if (outbound.state !== "processing") return false;
    const now = Date.now();
    const providerFields = args.result === "sent"
      ? await providerDeliveryFields(ctx, outbound, args.resendEmailId)
      : {};
    await ctx.db.patch(outbound._id, {
      state: args.result,
      ...(args.result === "sent" ? { at: now } : {}),
      leaseUntil: undefined,
      ...(args.result === "failed" ? { error: "Transport did not accept email" } : {}),
      ...(args.result === "uncertain" ? { error: "The provider may have accepted this email; check this booking thread before retrying." } : {}),
      ...providerFields,
    });
    await ctx.db.patch(thread._id, {
      updatedAt: now,
      ...(args.result === "sent" ? { lastAt: now } : {}),
    });
    return true;
  },
});

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
    .replace(/^(?:payment received — complete your rental checks|reminder: complete your rental checks|your rental verification is still being checked)(?=\s*·\s*dbc-)/, "rental verification")
    .replace(/\s+/g, " ")
    .trim();
}

function escapeRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function redactHandoverDetails(text: string, booking?: any) {
  let safeText = text
    .replace(/https:\/\/www\.google\.com\/maps\/search\/[^\s)]+/gi, "[pickup map hidden until rental is ready]")
    .replace(/\+\s*44[\s().-]*7933[\s().-]*019849/g, "[support phone hidden until rental is ready]")
    .replace(/(?:pickup|return|delivery)\s+(?:address|location)\s*:\s*[^\n\r]+/gi, "[handover address hidden until rental is ready]");
  const sensitiveValues = [
    TRAFALGAR_PICKUP_ADDRESS,
    TRAFALGAR_PICKUP_INSTRUCTIONS,
    booking?.address,
  ].filter((value): value is string => typeof value === "string" && value.trim().length > 0);
  for (const value of sensitiveValues) {
    safeText = safeText.replace(new RegExp(escapeRegex(value).replace(/\s+/g, "\\s+"), "gi"), "[handover details hidden until rental is ready]");
  }
  return safeText;
}

async function emailHistoryHandoverReady(ctx: any, thread: any, bookingId: any) {
  if (
    !thread?.accountId || !bookingId || thread.bookingId !== bookingId ||
    !thread.verifiedRenterEmail || !thread.email
  ) return false;
  const account = await ctx.db.get(thread.accountId);
  const email = account?.email?.trim().toLowerCase();
  if (
    !account || account.blockedAt != null || account.emailVerificationRequired === true || !account.emailVerifiedAt ||
    !email || thread.email.trim().toLowerCase() !== email || thread.verifiedRenterEmail.trim().toLowerCase() !== email
  ) return false;
  const booking = await ctx.db.get(bookingId);
  return belongsToRentalAccount(booking, account) && renterHandoverDetailsReady(booking);
}

async function historyFor(ctx: any, thread: any, bookingId?: any, allowHandoverDetails = false) {
  const threadId = typeof thread === "string" ? thread : thread?._id;
  const rows = await ctx.db.query("email_messages")
    .withIndex("by_thread_at", (q: any) => q.eq("threadId", threadId))
    .order("desc")
    .take(12);
  const booking = bookingId ? await ctx.db.get(bookingId) : null;
  const revealHandover = allowHandoverDetails && await emailHistoryHandoverReady(ctx, thread, bookingId);
  return rows.reverse().map((row: any) => ({
    role: row.direction === "in" ? "user" : "assistant",
    content: revealHandover ? row.text : redactHandoverDetails(row.text, booking),
  }));
}

function deliveryEventStatus(eventType: string): ResendDeliveryStatus | null {
  return ["delivered", "delivery_delayed", "bounced", "suppressed", "failed", "complained"].includes(eventType)
    ? eventType as ResendDeliveryStatus
    : null;
}

function isSyntheticDeliveryMessageId(messageId: string) {
  return /^<rental-[a-f0-9]{64}@dbcinemarentals\.com>$/i.test(messageId);
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
  let messageId = message.messageId;
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
    if (event.messageId) {
      if (messageId && messageId !== event.messageId && !isSyntheticDeliveryMessageId(messageId)) {
        throw new Error("Resend Message-ID does not match the existing delivery receipt");
      }
      messageId = event.messageId;
    }
    await ctx.db.delete(event._id);
  }
  return { statuses, ...(messageId && messageId !== message.messageId ? { messageId } : {}) };
}

async function providerDeliveryFields(ctx: any, message: any, resendEmailId?: string) {
  if (!resendEmailId) return {};
  const normalizedId = resendEmailId.trim();
  if (!normalizedId || normalizedId.length > 200) throw new Error("Resend returned an invalid email ID");
  if (message.resendEmailId && message.resendEmailId !== normalizedId) throw new Error("Resend email ID does not match the existing delivery receipt");
  const linked = await linkPendingDeliveryEvents(ctx, message, normalizedId);
  return {
    resendEmailId: normalizedId,
    ...(linked.statuses.length ? { recipientDeliveryStatuses: linked.statuses } : {}),
    ...(linked.messageId ? { messageId: linked.messageId } : {}),
  };
}

export const recordResendDeliveryEvent = mutation({
  args: {
    secret: v.string(),
    webhookEventId: v.string(),
    resendEmailId: v.string(),
    eventType: v.union(
      v.literal("sent"),
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
    messageId: v.optional(v.string()),
    reason: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    assertInboundSecret(args.secret);
    const webhookEventId = args.webhookEventId.trim();
    const resendEmailId = args.resendEmailId.trim();
    const messageId = args.messageId?.trim();
    if (!webhookEventId || webhookEventId.length > 200 || !resendEmailId || resendEmailId.length > 200 || !Number.isFinite(args.occurredAt) ||
      (messageId !== undefined && (messageId.length > 998 || !/^<[^<>\r\n\s]+@[^<>\r\n\s]+>$/.test(messageId)))) {
      throw new Error("invalid Resend delivery event");
    }
    const eventType = deliveryEventStatus(args.eventType);
    if (!eventType && !(args.eventType === "sent" && messageId)) return { ok: true as const, ignored: "unsupported status" };
    const recipients = [...new Set(args.recipients.map(value => value.trim().toLowerCase()).filter(value => EMAIL_ADDRESS_RE.test(value)))].slice(0, 25);
    const reason = args.reason?.replace(/[\r\n\t]+/g, " ").trim().slice(0, 500) || undefined;
    const existingPending = await ctx.db.query("email_delivery_events")
      .withIndex("by_webhook_event_id", (q) => q.eq("webhookEventId", webhookEventId))
      .first();
    if (existingPending) {
      if (existingPending.resendEmailId !== resendEmailId) throw new Error("Resend event ID was replayed for a different email");
      if (messageId && existingPending.messageId && messageId !== existingPending.messageId) throw new Error("Resend event Message-ID changed on replay");
      if (messageId && !existingPending.messageId) await ctx.db.patch(existingPending._id, { messageId });
      return { ok: true as const, duplicate: true as const, pending: true as const };
    }

    const message = await ctx.db.query("email_messages")
      .withIndex("by_resend_email_id", (q) => q.eq("resendEmailId", resendEmailId))
      .first();
    if (message) {
      if (message.direction !== "out") throw new Error("Resend delivery event matched a non-outbound email");
      const updates = eventType ? recipientDeliveryUpdates({ webhookEventId, eventType, recipients, occurredAt: args.occurredAt, reason }, message.recipient) : [];
      const merged = updates.length
        ? mergeEmailRecipientDeliveryStatuses(message.recipientDeliveryStatuses, updates)
        : message.recipientDeliveryStatuses ?? [];
      if (messageId && message.messageId && message.messageId !== messageId && !isSyntheticDeliveryMessageId(message.messageId)) {
        throw new Error("Resend Message-ID does not match the existing delivery receipt");
      }
      const providerMessageId = messageId && message.messageId !== messageId ? messageId : undefined;
      const statusesUpdated = eventType !== null && JSON.stringify(merged) !== JSON.stringify(message.recipientDeliveryStatuses ?? []);
      const updated = statusesUpdated || !!providerMessageId;
      if (updated) await ctx.db.patch(message._id, {
        ...(statusesUpdated ? { recipientDeliveryStatuses: merged } : {}),
        ...(providerMessageId ? { messageId: providerMessageId } : {}),
      });
      return { ok: true as const, matched: true as const, updated };
    }

    // Buffer only mail from this application's verified domain. The send
    // response can race this webhook before its email ID is saved on the
    // outbox row; unrelated Resend traffic must not become permanent orphans.
    if (!isBusinessSender(args.from)) return { ok: true as const, ignored: "unmatched email" };
    const pendingId = await ctx.db.insert("email_delivery_events", {
      webhookEventId,
      resendEmailId,
      ...(eventType ? { eventType } : {}),
      recipients,
      occurredAt: args.occurredAt,
      ...(messageId ? { messageId } : {}),
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
    const linked = await linkPendingDeliveryEvents(ctx, message, pending.resendEmailId);
    if (linked.statuses.length || linked.messageId) await ctx.db.patch(message._id, {
      ...(linked.statuses.length ? { recipientDeliveryStatuses: linked.statuses } : {}),
      ...(linked.messageId ? { messageId: linked.messageId } : {}),
    });
    return { ok: true as const, reconciled: true as const };
  },
});

async function threadMessages(ctx: any, threadId: any, count = 40) {
  return await ctx.db.query("email_messages")
    .withIndex("by_thread_at", (q: any) => q.eq("threadId", threadId))
    .order("desc")
    .take(count);
}

async function latestInboundMessage(ctx: any, thread: any) {
  if (thread.latestInboundMessageId) {
    const latest = await ctx.db.get(thread.latestInboundMessageId);
    if (latest?.threadId === thread._id && latest.direction === "in") return latest;
  }
  return (await threadMessages(ctx, thread._id, 100)).find((message: any) => message.direction === "in") ?? null;
}

async function makeReplyDeliveryUncertain(ctx: any, thread: any, outbound: any, error = "The previous email may have reached the renter; check delivery before sending again.") {
  if (outbound.state === "sent") return "sent" as const;
  if (outbound.state !== "uncertain") {
    await ctx.db.patch(outbound._id, { state: "uncertain", leaseUntil: undefined, error: error.slice(0, 500) });
  }
  await ctx.db.patch(thread._id, { updatedAt: Date.now(), lastAt: Date.now() });
  return "uncertain" as const;
}

async function unresolvedReplyDelivery(ctx: any, thread: any, inbound: any, now = Date.now(), persistExpired = false) {
  const [uncertain, processing] = await Promise.all([
    ctx.db.query("email_messages").withIndex("by_thread_state", (q: any) => q.eq("threadId", thread._id).eq("state", "uncertain")).collect(),
    ctx.db.query("email_messages").withIndex("by_thread_state", (q: any) => q.eq("threadId", thread._id).eq("state", "processing")).collect(),
  ]);
  const candidates = [...uncertain, ...processing].filter((message: any) => message.direction === "out");
  for (const message of candidates) {
    const sameInbound = !inbound || inbound.at <= message.at ||
      (message.replyToProviderId != null && message.replyToProviderId === (inbound.providerId ?? String(inbound._id))) ||
      (message.inReplyTo != null && inbound.messageId != null && message.inReplyTo === inbound.messageId);
    if (!sameInbound) continue;
    if (message.state === "uncertain") return "uncertain" as const;
    if ((message.leaseUntil ?? 0) > now) return "sending" as const;
    if (persistExpired) {
      await makeReplyDeliveryUncertain(ctx, thread, message);
    }
    return "uncertain" as const;
  }
  return null;
}

async function generalThreadForReplyHeaders(ctx: any, email: string, inReplyTo?: string, references: string[] = []) {
  const candidates = [...new Set([inReplyTo, ...references.slice().reverse()].map((value) => value?.trim()).filter((value): value is string => !!value && value.length <= 500))];
  for (const messageId of candidates) {
    const matches = await ctx.db.query("email_messages")
      .withIndex("by_message_id", (q: any) => q.eq("messageId", messageId))
      .take(2);
    if (!matches.length) continue;
    if (matches.length !== 1) return null;
    const outbound = matches[0];
    if (outbound.direction !== "out" || outbound.state !== "sent" || outbound.recipient?.trim().toLowerCase() !== email) return null;
    const thread = await ctx.db.get(outbound.threadId);
    if (!thread || thread.email.trim().toLowerCase() !== email || thread.accountId || thread.bookingId) return null;
    return thread;
  }
  return null;
}

/** Mirror the accepted verification notice without storing its private sign-in link. */
export const recordVerificationNotice=internalMutation({args:{deliveryId:v.id("rental_email_deliveries"),subject:v.string(),messageId:v.optional(v.string()),transport:v.optional(v.union(v.literal("gmail"),v.literal("resend")))},handler:async(ctx,a)=>{
 const delivery=await ctx.db.get(a.deliveryId);
 if(!delivery||delivery.state!=="sent"||!["paid_verification","verification_reminder"].includes(delivery.kind)||!delivery.recipientEmail)return false;
 const central=await ctx.db.query("email_messages").withIndex("by_provider",q=>q.eq("providerId",`rental-email:${delivery._id}`)).first();
 if(central)return true;
 const providerId=`rental-notice:${delivery._id}`;
 if(await ctx.db.query("email_messages").withIndex("by_provider",q=>q.eq("providerId",providerId)).first())return true;
 const email=delivery.recipientEmail.trim().toLowerCase(),subject=a.subject.trim().slice(0,500);
 if(!email||!subject)return false;
 const booking=await ctx.db.get(delivery.bookingId),account=booking?.accountId?await ctx.db.get(booking.accountId):null;
 const verifiedAccount=account&&belongsToRentalAccount(booking,account)&&account.blockedAt==null&&account.emailVerificationRequired!==true&&typeof account.emailVerifiedAt==="number"&&Number.isFinite(account.emailVerifiedAt)&&account.emailVerifiedAt>0&&account.email.trim().toLowerCase()===email?account:null;
 const now=Date.now(),sentAt=delivery.sentAt??now,text="Payment was received. The renter was sent a private link to complete identity verification; approval is required before handover.";
 const recent=await ctx.db.query("email_threads").withIndex("by_email_updated",q=>q.eq("email",email)).order("desc").take(20);
 const matches=recent.filter(t=>subjectKey(t.subject)===subjectKey(subject)&&now-t.updatedAt<30*86_400_000);
 let thread=matches.find(t=>t.bookingId===delivery.bookingId);
 if(!thread&&matches.length===1&&!matches[0].bookingId){thread=matches[0];await ctx.db.patch(thread._id,{bookingId:delivery.bookingId});}
 if(!thread){
  const id=await ctx.db.insert("email_threads",{email,bookingId:delivery.bookingId,subject,replyKey:makeReplyKey(),...(verifiedAccount?{accountId:verifiedAccount._id,verifiedRenterEmail:email}:{}),status:"open",createdAt:now,updatedAt:now,lastAt:sentAt,lastDirection:"out",lastText:text,unreadOwner:0});
  thread=(await ctx.db.get(id))!;
 }else if(sentAt>thread.lastAt)await ctx.db.patch(thread._id,{updatedAt:now,lastAt:sentAt,lastDirection:"out",lastText:text});
 const from=a.transport==="gmail"?(process.env.GMAIL_USER??OWNER_EMAIL):a.transport==="resend"?(process.env.RESEND_FROM?.match(/<([^>]+)>/)?.[1]??"bookings@dbcinemarentals.com"):"DB Cinema Rentals";
 const messageId=delivery.providerRfcMessageId??a.messageId;
 await ctx.db.insert("email_messages",{threadId:thread._id,direction:"out",sender:from,recipient:email,subject,text,at:sentAt,providerId,...(messageId?{messageId}:{}),state:"sent",humanRequested:false});
 if(verifiedAccount&&(!thread.accountId||thread.accountId===verifiedAccount._id)){
  if(!thread.accountId)await ctx.db.patch(thread._id,{accountId:verifiedAccount._id,verifiedRenterEmail:email});
  await ctx.scheduler.runAfter(0,internal.emailInbox.copyVerifiedHistory,{accountId:verifiedAccount._id,threadId:thread._id,cursor:null});
 }
 return true;
}});


export const ingest = mutation({
  args: {
    secret: v.string(),
    providerId: v.string(),
    messageId: v.optional(v.string()),
    inReplyTo: v.optional(v.string()),
    references: v.array(v.string()),
    replyThreadId: v.optional(v.id("email_threads")),
    replyCapabilityKey: v.optional(v.string()),
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
      const duplicateBookingId = duplicate.bookingId ?? thread?.bookingId;
      return {
        ok: true,
        duplicate: true,
        threadId: duplicate.threadId,
        inboundId: duplicate._id,
        accountId: thread?.verifiedRenterEmail ? thread.accountId ?? null : null,
        blocked: false,
        history: await historyFor(ctx, thread, duplicateBookingId, duplicate.replyCapabilityVerified === true),
      };
    }

    const referencesInMessage = bookingReferences(args.subject, body);
    const hasBookingReference = referencesInMessage.length > 0;
    let account: any = null;
    let messageBookingId: any = null;
    let thread: any = null;
    let privateReplyThread = false;
    let rejectedReplyThreadId: any = null;
    if (args.replyThreadId) {
      const replyThread = await ctx.db.get(args.replyThreadId);
      if (!replyThread || replyThread.email.trim().toLowerCase() !== email) {
        throw new Error("email reply address does not match the sender");
      }
      const capabilityKey = args.replyCapabilityKey?.trim().toLowerCase() ?? "";
      if (!/^[a-f0-9]{24}$/.test(capabilityKey) || capabilityKey !== replyThread.replyKey) {
        rejectedReplyThreadId = replyThread._id;
      } else {
        const verifiedAccount = await verifiedAccountForEmail(ctx, email);
        if (threadOwnershipMatches(replyThread, verifiedAccount, email)) account = verifiedAccount;
        const matchedBooking = referencesInMessage.length === 1
          ? await ownedBookingForReference(ctx, account, referencesInMessage[0])
          : null;
        const inferredBooking = hasBookingReference || !replyThread.bookingId
          ? null
          : await verifiedThreadBooking(ctx, replyThread, account);
        messageBookingId = matchedBooking?._id ?? inferredBooking?._id ?? null;
      }
      const capabilityMatchesReference = hasBookingReference && referencesInMessage.length === 1 && replyThread.bookingId &&
        String(replyThread.bookingId).slice(-8).toUpperCase() === referencesInMessage[0];
      if (rejectedReplyThreadId == null && threadOwnershipMatches(replyThread, account, email) &&
        (threadBookingMatches(replyThread, messageBookingId, hasBookingReference, true) || capabilityMatchesReference)) {
        thread = replyThread;
        privateReplyThread = true;
      } else if (rejectedReplyThreadId == null) {
        rejectedReplyThreadId = replyThread._id;
      }
    }
    if (thread && !hasBookingReference && privateReplyThread) {
      const inheritedBooking = await verifiedThreadBooking(ctx, thread, account);
      messageBookingId = inheritedBooking?._id ?? null;
    }
    if (!thread && !args.replyThreadId) {
      thread = await generalThreadForReplyHeaders(ctx, email, args.inReplyTo, args.references);
    }

    const now = Date.now();
    if (!thread) {
      const threadId = await ctx.db.insert("email_threads", {
        email,
        name: args.name?.trim() || account?.name || undefined,
        subject: args.subject.trim().slice(0, 500) || "Customer email",
        replyKey: makeReplyKey(),
        ...(privateReplyThread && account ? { accountId: account._id, verifiedRenterEmail: email } : {}),
        ...(messageBookingId ? { bookingId: messageBookingId } : {}),
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
        ...(privateReplyThread && account ? { accountId: account._id, verifiedRenterEmail: email } : {}),
        ...(messageBookingId && !thread.bookingId ? { bookingId: messageBookingId } : {}),
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
          chatSender: "bot",
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
      ...(privateReplyThread ? { replyCapabilityVerified: true } : {}),
      ...(messageBookingId ? { bookingId: messageBookingId } : {}),
      state: "received",
      humanRequested: false,
    });
    await ctx.db.patch(thread._id, { latestInboundMessageId: inboundId });

    if (privateReplyThread && account && account.blockedAt == null) {
      const profileMessageId = await postRentalMessage(ctx, {
        accountId: account._id,
        ...(messageBookingId ? { bookingId: messageBookingId } : {}),
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
      accountId: privateReplyThread ? account?._id ?? null : null,
      bookingId: privateReplyThread ? messageBookingId : null,
      blocked: account?.blockedAt != null,
      history: await historyFor(ctx, thread, messageBookingId, privateReplyThread),
    };
  },
});

export const claimInbound = mutation({
  args: { secret: v.string(), inboundId: v.id("email_messages"), humanRequested: v.boolean() },
  handler: async (ctx, { secret, inboundId, humanRequested }) => {
    assertInboundSecret(secret);
    const message = await ctx.db.get(inboundId);
    if (!message || message.direction !== "in") throw new Error("inbound message not found");
    if (message.state === "replied" || message.state === "handoff" || message.state === "uncertain") return { state: "done" as const };
    const now = Date.now();
    if (message.state === "processing" && (message.leaseUntil ?? 0) > now) return { state: "busy" as const };
    const thread = await ctx.db.get(message.threadId);
    if (!thread) throw new Error("email thread not found");
    if (thread.status === "human_requested") {
      await ctx.db.patch(inboundId, { state: "handoff", leaseUntil: undefined, error: undefined, humanRequested: true });
      await markEmailHumanRequested(ctx, thread, message, inboundId, now);
      return { state: "human_waiting" as const };
    }
    if (!["received", "processing", "failed"].includes(message.state)) throw new Error("inbound message cannot be claimed");
    await ctx.db.patch(inboundId, { state: "processing", leaseUntil: now + LEASE_MS, error: undefined, humanRequested });
    const claimed = await ctx.db.get(inboundId);
    if (!claimed || claimed.state !== "processing" || (claimed.leaseUntil ?? 0) <= now) throw new Error("inbound message claim expired");
    const rentalContext = await rentalContextForClaim(ctx, claimed, thread, now);
    return {
      state: "claimed" as const,
      threadId: message.threadId,
      inboundId,
      history: await historyFor(ctx, thread, claimed.bookingId, !!rentalContext?.booking?.handoverDetails),
      email: thread.email,
      rentalContext,
    };
  },
});

async function rentalContextForClaim(ctx: any, message: any, thread: any, now: number) {
  if (
    message.state !== "processing" || (message.leaseUntil ?? 0) <= now ||
    message.threadId !== thread._id || message.replyCapabilityVerified !== true || !message.bookingId || thread.bookingId !== message.bookingId
  ) return null;
  const email = typeof message.sender === "string" ? message.sender.trim().toLowerCase() : "";
  if (!EMAIL_ADDRESS_RE.test(email) || thread.email?.trim().toLowerCase() !== email) return null;

  const account = await verifiedAccountForEmail(ctx, email);
  if (
    !account || account.blockedAt != null || thread.accountId !== account._id ||
    thread.verifiedRenterEmail?.trim().toLowerCase() !== email
  ) return null;
  const booking = await ctx.db.get(message.bookingId);
  if (!belongsToRentalAccount(booking, account) || !Array.isArray(booking.lineItems) || !booking.lineItems.length) return null;

  const lineItems = booking.lineItems.slice(0, 100).flatMap((line: any) => {
    if (!line || typeof line.title !== "string" || !Number.isSafeInteger(line.start) || !Number.isSafeInteger(line.end)) return [];
    return [{
      title: line.title.replace(/[\r\n\u0000-\u001f]+/g, " ").trim().slice(0, 200),
      qty: Number.isSafeInteger(line.qty) && line.qty > 0 ? line.qty : 1,
      start: line.start,
      end: line.end,
      ...(typeof line.returnTime === "string" ? { returnTime: line.returnTime.slice(0, 16) } : {}),
    }];
  });
  if (!lineItems.length) return null;

  const verificationExpiresAt = verificationValidUntil(booking);
  const handoverReady = renterHandoverDetailsReady(booking);
  const pickupAddress = booking.fulfilment === "delivery"
    ? (typeof booking.address === "string" ? booking.address.replace(/[\r\n\u0000-\u001f]+/g, " ").trim().slice(0, 500) : null)
    : TRAFALGAR_PICKUP_ADDRESS;
  const handoverDetails = handoverReady ? {
    phone: LEO_SUPPORT_PHONE,
    pickupAddress,
    returnAddress: booking.fulfilment === "delivery" && booking.deliveryLegs !== "one_way"
      ? pickupAddress
      : TRAFALGAR_PICKUP_ADDRESS,
    pickupInstructions: booking.fulfilment === "pickup" || booking.deliveryLegs === "one_way"
      ? TRAFALGAR_PICKUP_INSTRUCTIONS
      : null,
    fulfilment: booking.fulfilment,
  } : undefined;

  return {
    customerName: typeof account.name === "string" ? account.name.trim().slice(0, 120) : undefined,
    booking: {
      _id: booking._id,
      at: typeof booking.at === "number" ? booking.at : booking._creationTime,
      status: booking.status,
      idVerifyStatus: booking.idVerifyStatus ?? "required",
      idVerificationSource: booking.idVerificationSource ?? null,
      verificationProvider: booking.verificationProvider ?? null,
      verificationExpiresAt,
      verificationLateApprovalBlocked: booking.verificationLateBlockedProviderStatus === "Approved" && !!booking.verificationLateBlockedAt,
      verificationChecks: booking.verificationChecks ?? null,
      lineItems,
      fulfilment: booking.fulfilment === "pickup" || booking.fulfilment === "delivery" ? booking.fulfilment : null,
      deliveryLegs: booking.fulfilment === "delivery" && (booking.deliveryLegs === "one_way" || booking.deliveryLegs === "round_trip") ? booking.deliveryLegs : null,
      deliveryFee: typeof booking.deliveryFee === "number" && Number.isFinite(booking.deliveryFee) && booking.deliveryFee >= 0 ? booking.deliveryFee : null,
      pickupTime: typeof booking.pickupTime === "string" ? booking.pickupTime.slice(0, 16) : undefined,
      returnTime: typeof booking.returnTime === "string" ? booking.returnTime.slice(0, 16) : undefined,
      cancellation: gafferCancellationFacts(booking, now),
      paidConfirmedAt: Number.isSafeInteger(booking.paidConfirmedAt) && booking.paidConfirmedAt > 0 ? booking.paidConfirmedAt : null,
      ...(handoverDetails ? { handoverDetails } : {}),
    },
  };
}

async function markEmailHumanRequested(ctx: any, thread: any, message: any, inboundId: any, now: number) {
  await ctx.db.patch(inboundId, { humanRequested: true });
  if (thread.humanNotifiedMessageId === inboundId) return;
  await ctx.db.patch(thread._id, {
    status: "human_requested",
    humanNotifiedAt: now,
    humanNotifiedMessageId: inboundId,
  });
  await queueOwnerNotification(ctx, { eventKey: `email-human-request:${inboundId}`, kind: "human_request", emailThreadId: thread._id, title: "A customer needs your help by email", body: "Open the email conversation to read their message and reply." });
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
    const bookingId = await verifiedEmailBookingId(ctx, thread, inbound.bookingId);
    const deliveryKey = `email-auto:${inbound.providerId ?? inbound._id}`;
    const outboxKey = `out:${deliveryKey}`;
    const existing = await ctx.db.query("email_messages")
      .withIndex("by_provider", (q) => q.eq("providerId", outboxKey))
      .first();
    const now = Date.now();
    if (existing?.state === "sent") return { state: "sent" as const };
    if (existing?.state === "uncertain") {
      await ctx.db.patch(args.inboundId, { state: "uncertain", leaseUntil: undefined, error: "The automatic email reply may have reached the renter; delivery must be checked before retrying." });
      return { state: "uncertain" as const };
    }
    if (existing?.state === "processing" && (existing.leaseUntil ?? 0) > now) return { state: "busy" as const };
    if (existing?.state === "processing" || (existing && existing.state !== "failed") || (existing?.state === "failed" && !emailReplyFailureIsRetryable(existing))) {
      await makeReplyDeliveryUncertain(ctx, thread, existing);
      await ctx.db.patch(args.inboundId, { state: "uncertain", leaseUntil: undefined, error: "The automatic email reply may have reached the renter; delivery must be checked before retrying." });
      return { state: "uncertain" as const };
    }
    const replyKey = thread.replyKey ?? makeReplyKey();
    if (!thread.replyKey) await ctx.db.patch(args.threadId, { replyKey });
    const replyThread = { ...thread, replyKey };
    let outboundId = existing?._id;
    const replyText = existing?.text ?? args.text;
    const replyHumanRequested = existing?.humanRequested ?? args.humanRequested;
    if (outboundId) {
      // A retry can happen after Resend accepted the message but before the
      // outbox was finalized. Keep the original payload bound to its stable
      // provider idempotency key; a newly generated Gaffer answer must not
      // turn an ambiguous retry into a conflicting request.
      await ctx.db.patch(outboundId, { state: "processing", leaseUntil: now + LEASE_MS, chatSender: "bot", humanRequested: replyHumanRequested, ...(bookingId ? { bookingId } : {}), error: undefined });
    } else {
      outboundId = await ctx.db.insert("email_messages", {
        threadId: args.threadId,
        ...(bookingId ? { bookingId } : {}),
        direction: "out",
        chatSender: "bot",
        sender: OWNER_EMAIL,
        recipient: thread.email,
        subject: thread.subject,
        text: replyText,
        at: now,
        providerId: outboxKey,
        state: "processing",
        leaseUntil: now + LEASE_MS,
        replyToProviderId: inbound.providerId ?? String(inbound._id),
        humanRequested: args.humanRequested,
      });
    }
    await ctx.db.patch(args.inboundId, { humanRequested: replyHumanRequested });
    return { state: "claimed" as const, outboundId, deliveryKey, text: replyText, humanRequested: replyHumanRequested, thread: replyThread, inbound };
  },
});

export const finishAutomaticReply = internalMutation({
  args: { threadId: v.id("email_threads"), inboundId: v.id("email_messages"), outboundId: v.id("email_messages"), text: v.string(), messageId: v.optional(v.string()), resendEmailId: v.optional(v.string()), humanRequested: v.boolean() },
  handler: async (ctx, args) => {
    const thread = await ctx.db.get(args.threadId);
    const inbound = await ctx.db.get(args.inboundId);
    const outbound = await ctx.db.get(args.outboundId);
    if (!thread || !inbound || !outbound) throw new Error("email reply could not be recorded");
    if (outbound.state === "sent") return { ok: true, duplicate: true };
    const now = Date.now();
    const references = [...new Set([...(inbound.references ?? []), inbound.messageId].filter((value): value is string => typeof value === "string" && value.length > 0))].slice(-20);
    const providerFields = await providerDeliveryFields(ctx, outbound, args.resendEmailId);
    await ctx.db.patch(args.outboundId, { state: "sent", at: now, ...(args.messageId ? { messageId: args.messageId } : {}), inReplyTo: inbound.messageId, references, leaseUntil: undefined, error: undefined, ...providerFields });
    await ctx.db.patch(args.inboundId, { state: args.humanRequested ? "handoff" : "replied", leaseUntil: undefined, error: undefined, humanRequested: args.humanRequested });
    await ctx.db.patch(args.threadId, {
      status: args.humanRequested ? "human_requested" : "open",
      updatedAt: now,
      lastAt: now,
      lastDirection: "out",
      lastText: args.text.slice(0, 280),
      ...(args.humanRequested ? { humanNotifiedAt: now } : {}),
    });
    const bookingId = await verifiedEmailBookingId(ctx, thread, outbound.bookingId ?? inbound.bookingId);
    if (thread.accountId) {
      const profileMessageId = await postRentalMessage(ctx, { accountId: thread.accountId, ...(bookingId ? { bookingId } : {}), sender: "bot", text: args.text, meta: { channel: "email", emailThreadId: String(thread._id), emailMessageId: String(args.outboundId) } });
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

export const markEmailReplyRetryable = internalMutation({
  args: {
    threadId: v.id("email_threads"),
    outboundId: v.id("email_messages"),
    inboundId: v.optional(v.id("email_messages")),
    kind: v.union(v.literal("preflight"), v.literal("provider_rejected")),
    error: v.string(),
  },
  handler: async (ctx, args) => {
    const thread = await ctx.db.get(args.threadId);
    const outbound = await ctx.db.get(args.outboundId);
    if (!thread || !outbound || outbound.threadId !== thread._id || outbound.direction !== "out") {
      throw new Error("email reply failure could not be recorded");
    }
    if (outbound.state === "sent") return { state: "sent" as const };
    if (outbound.state === "uncertain") return { state: "uncertain" as const };
    const prefix = args.kind === "provider_rejected" ? DEFINITE_EMAIL_REPLY_REJECTION : SAFE_EMAIL_REPLY_PREFLIGHT_FAILURE;
    await ctx.db.patch(outbound._id, {
      state: "failed",
      leaseUntil: undefined,
      error: `${prefix}${args.error}`.slice(0, 500),
    });
    if (args.inboundId) {
      const inbound = await ctx.db.get(args.inboundId);
      if (!inbound || inbound.threadId !== thread._id || inbound.direction !== "in") throw new Error("email reply request no longer matches its inbound message");
      if (inbound.state !== "replied" && inbound.state !== "handoff" && inbound.state !== "uncertain") {
        await ctx.db.patch(inbound._id, { state: "failed", leaseUntil: undefined, error: `${prefix}${args.error}`.slice(0, 500) });
      }
    }
    await ctx.db.patch(thread._id, { updatedAt: Date.now(), lastAt: Date.now() });
    return { state: "failed" as const };
  },
});

export const markAutomaticReplyUncertain = internalMutation({
  args: { threadId: v.id("email_threads"), inboundId: v.id("email_messages"), outboundId: v.id("email_messages"), error: v.string() },
  handler: async (ctx, args) => {
    const thread = await ctx.db.get(args.threadId);
    const inbound = await ctx.db.get(args.inboundId);
    const outbound = await ctx.db.get(args.outboundId);
    if (!thread || !inbound || !outbound || inbound.threadId !== thread._id || outbound.threadId !== thread._id || inbound.direction !== "in" || outbound.direction !== "out" || outbound.chatSender !== "bot") {
      throw new Error("automatic email reply could not be reconciled");
    }
    const state = await makeReplyDeliveryUncertain(ctx, thread, outbound, args.error);
    if (state !== "sent" && inbound.state !== "replied" && inbound.state !== "handoff") {
      await ctx.db.patch(inbound._id, { state: "uncertain", leaseUntil: undefined, error: args.error.slice(0, 500) });
    }
    return { state };
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
    .replace(/\[([^\]]+)\]\(((?:https?:\/\/(?:www\.)?dbcinemarentals\.com)?\/contact\/?(?:\?[^\s)]*)?)\)/gi, (_match, label: string, url: string) => {
      const href = /^https?:\/\//i.test(url) ? url : `https://dbcinemarentals.com${url}`;
      return `<a href="${href}" style="display:inline-block;background:#c18c62;color:#17120f;text-decoration:none;font-weight:600;padding:11px 16px;border-radius:8px;border:1px solid #d5a878;margin:4px 0">${label}</a>`;
    })
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
    if (claim.state === "uncertain") return { ok: false, uncertain: true };
    const { thread, inbound, outboundId, deliveryKey } = claim;
    const replyText = claim.text;
    const humanRequested = claim.humanRequested;
    const replyTo = gafferReplyAddress(thread.replyKey);
    if (!replyTo) {
      await ctx.runMutation(internal.emailInbox.markEmailReplyRetryable, { threadId: args.threadId, outboundId, inboundId: args.inboundId, kind: "preflight", error: "Gaffer email reply route is not configured" });
      throw new Error("Gaffer email reply route is not configured");
    }
    const references = [...new Set([...(inbound.references ?? []), inbound.messageId].filter((value): value is string => typeof value === "string" && value.length > 0))].slice(-20);
    let delivery: { sent: boolean; ambiguous?: boolean; messageId?: string; resendEmailId?: string };
    try {
      delivery = await ctx.runAction(internal.emailMailer.sendBusinessReply, {
        to: thread.email,
        subject: replySubject(thread.subject),
        html: safeHtml(replyText),
        replyTo,
        ...(humanRequested && thread.email !== OWNER_EMAIL ? { cc: [OWNER_EMAIL] } : {}),
        deliveryKey,
        inReplyTo: inbound.messageId,
        references,
      });
    } catch (error) {
      await ctx.runMutation(internal.emailInbox.markAutomaticReplyUncertain, {
        threadId: args.threadId,
        inboundId: args.inboundId,
        outboundId,
        error: `The automatic reply may have reached the renter: ${String((error as any)?.message ?? error)}`,
      });
      return { ok: false, uncertain: true };
    }
    if (!delivery.sent) {
      if (delivery.ambiguous) {
        await ctx.runMutation(internal.emailInbox.markAutomaticReplyUncertain, {
          threadId: args.threadId,
          inboundId: args.inboundId,
          outboundId,
          error: "Resend may have accepted the automatic reply; check delivery before retrying.",
        });
        return { ok: false, uncertain: true };
      }
      await ctx.runMutation(internal.emailInbox.markEmailReplyRetryable, {
        threadId: args.threadId,
        inboundId: args.inboundId,
        outboundId,
        kind: "provider_rejected",
        error: "Resend definitively rejected the automatic reply.",
      });
      return { ok: false, rejected: true };
    }
    try {
      await ctx.runMutation(internal.emailInbox.finishAutomaticReply, {
        threadId: args.threadId,
        inboundId: args.inboundId,
        outboundId,
        text: replyText,
        ...(delivery.messageId ? { messageId: delivery.messageId } : {}),
        ...(delivery.resendEmailId ? { resendEmailId: delivery.resendEmailId } : {}),
        humanRequested,
      });
    } catch (error) {
      await ctx.runMutation(internal.emailInbox.markAutomaticReplyUncertain, {
        threadId: args.threadId,
        inboundId: args.inboundId,
        outboundId,
        error: `Resend accepted the automatic reply but inbox finalization failed: ${String((error as any)?.message ?? error)}`,
      });
      return { ok: false, uncertain: true };
    }
    return { ok: true };
  },
});

/** Create a Gaffer call follow-up in the same durable inbox before sending it. */
export const prepareGafferFollowUp = internalMutation({
  args: { email: v.string(), name: v.string(), subject: v.string(), text: v.string(), replyKey: v.string() },
  handler: async (ctx, args) => {
    const email = args.email.trim().toLowerCase();
    const requestedName = args.name.trim().slice(0, 120);
    const subject = args.subject.trim().slice(0, 500) || "Following up on your call with DB Cinema Rentals";
    const text = args.text.trim().slice(0, 12_000);
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
      if (!thread || existing.direction !== "out" || existing.recipient !== email || thread.email !== email || thread.replyKey !== replyKey) {
        throw new Error("Gaffer follow-up outbox does not match its thread");
      }
      if (thread.subject !== subject || existing.subject !== thread.subject || existing.text !== text || (requestedName && requestedName !== thread.name)) {
        throw new Error("Gaffer follow-up key cannot be reused with different content");
      }
      if (existing.state === "sent") return { state: "sent" as const };
      if (existing.state === "uncertain") return { state: "uncertain" as const };
      if (existing.state === "processing" && (existing.leaseUntil ?? 0) > now) return { state: "busy" as const };
      if (existing.state === "processing" || (existing.state === "failed" && !existing.error?.startsWith(DEFINITE_GAFFER_REJECTION))) {
        await ctx.db.patch(existing._id, {
          state: "uncertain",
          leaseUntil: undefined,
          error: "The previous email may have reached the renter; check delivery before sending again.",
        });
        await ctx.db.patch(thread._id, { updatedAt: now, lastAt: now });
        return { state: "uncertain" as const };
      }
      if (existing.state !== "failed") return { state: "uncertain" as const };
      await ctx.db.patch(existing._id, { state: "processing", leaseUntil: now + LEASE_MS, chatSender: existing.chatSender ?? "bot", error: undefined });
      return {
        state: "claimed" as const,
        threadId: thread._id,
        outboundId: existing._id,
        deliveryKey,
        to: thread.email,
        name: thread.name ?? "",
        subject: thread.subject,
        text: existing.text,
      };
    }

    const account = await verifiedAccountForEmail(ctx, email);
    const name = requestedName || account?.name || undefined;
    const threadId = await ctx.db.insert("email_threads", {
      email,
      name,
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
      chatSender: "bot",
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
    return { state: "claimed" as const, threadId, outboundId, deliveryKey, to: email, name: name ?? "", subject, text };
  },
});

export const finishGafferFollowUp = internalMutation({
  args: { threadId: v.id("email_threads"), outboundId: v.id("email_messages"), text: v.string(), messageId: v.optional(v.string()), resendEmailId: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const thread = await ctx.db.get(args.threadId);
    const outbound = await ctx.db.get(args.outboundId);
    if (!thread || !outbound || outbound.threadId !== thread._id || outbound.direction !== "out") {
      throw new Error("Gaffer follow-up thread could not be finalized");
    }
    if (outbound.state === "sent") return { ok: true, duplicate: true };
    const now = Date.now();
    const providerFields = await providerDeliveryFields(ctx, outbound, args.resendEmailId);
    await ctx.db.patch(args.outboundId, { state: "sent", at: now, ...(args.messageId ? { messageId: args.messageId } : {}), leaseUntil: undefined, error: undefined, ...providerFields });
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
    await ctx.db.patch(args.outboundId, { state: "failed", leaseUntil: undefined, error: `${DEFINITE_GAFFER_REJECTION}${args.error}`.slice(0, 500) });
    const thread = await ctx.db.get(outbound.threadId);
    if (thread) await ctx.db.patch(thread._id, { updatedAt: Date.now(), lastAt: Date.now() });
    return { ok: true };
  },
});

export const markGafferFollowUpUncertain = internalMutation({
  args: { outboundId: v.id("email_messages"), error: v.string(), resendEmailId: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const outbound = await ctx.db.get(args.outboundId);
    if (!outbound || outbound.direction !== "out" || !outbound.providerId?.startsWith("out:gaffer-follow-up:")) {
      throw new Error("Gaffer follow-up delivery could not be reconciled");
    }
    if (outbound.state === "sent") return { state: "sent" as const };
    if (outbound.state === "failed" && outbound.error?.startsWith(DEFINITE_GAFFER_REJECTION)) return { state: "failed" as const };
    if (outbound.state === "uncertain") return { state: "uncertain" as const };
    const now = Date.now();
    const providerFields = await providerDeliveryFields(ctx, outbound, args.resendEmailId);
    await ctx.db.patch(outbound._id, {
      state: "uncertain",
      leaseUntil: undefined,
      error: args.error.slice(0, 500),
      ...providerFields,
    });
    const thread = await ctx.db.get(outbound.threadId);
    if (thread) await ctx.db.patch(thread._id, { updatedAt: now, lastAt: now });
    return { state: "uncertain" as const };
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
    if (prepared.state === "uncertain") return { ok: false, uncertain: true };
    try {
      const delivery = await ctx.runAction(internal.emailMailer.sendBusinessReply, {
        to: prepared.to,
        subject: prepared.subject,
        html: `<div style="font-family:system-ui,sans-serif;line-height:1.55;color:#111"><p>${prepared.name ? `Hi ${safeHtml(prepared.name)},` : "Hi,"}</p><p>Following up on your call with DB Cinema Rentals:</p><div style="border-left:3px solid #e0992f;padding:2px 0 2px 14px;margin:16px 0">${safeHtml(prepared.text)}</div><p>Reply to this email if you need anything else — it comes straight back to us.</p></div>`,
        replyTo,
        deliveryKey: prepared.deliveryKey,
        references: [],
      });
      if (!delivery.sent) {
        if (delivery.ambiguous) {
          await ctx.runMutation(internal.emailInbox.markGafferFollowUpUncertain, {
            outboundId: prepared.outboundId,
            error: "Resend may have accepted the follow-up; check delivery before sending again.",
            ...(delivery.resendEmailId ? { resendEmailId: delivery.resendEmailId } : {}),
          });
          return { ok: false, uncertain: true };
        }
        await ctx.runMutation(internal.emailInbox.failGafferFollowUp, {
          outboundId: prepared.outboundId,
          error: "Resend definitively rejected the follow-up.",
        });
        return { ok: false, rejected: true };
      }
      await ctx.runMutation(internal.emailInbox.finishGafferFollowUp, {
        threadId: prepared.threadId,
        outboundId: prepared.outboundId,
        text: prepared.text,
        ...(delivery.messageId ? { messageId: delivery.messageId } : {}),
        ...(delivery.resendEmailId ? { resendEmailId: delivery.resendEmailId } : {}),
      });
      return { ok: true };
    } catch (error) {
      await ctx.runMutation(internal.emailInbox.markGafferFollowUpUncertain, {
        outboundId: prepared.outboundId,
        error: `The follow-up send may have reached the renter: ${String((error as any)?.message ?? error)}`,
      });
      return { ok: false, uncertain: true };
    }
  },
});

async function rentalConversationForEmailThread(ctx: any, thread: any) {
  if (!thread.accountId || !thread.bookingId || !thread.latestInboundMessageId) return null;
  const [account, booking, latestInbound] = await Promise.all([
    ctx.db.get(thread.accountId),
    ctx.db.get(thread.bookingId),
    ctx.db.get(thread.latestInboundMessageId),
  ]);
  if (!account || !booking || !belongsToRentalAccount(booking, account) || thread.accountId !== account._id || thread.bookingId !== booking._id) return null;
  const verifiedEmail = account.email?.trim().toLowerCase();
  if (
    account.blockedAt != null ||
    !account.emailVerifiedAt ||
    account.emailVerificationRequired === true ||
    !verifiedEmail ||
    thread.email?.trim().toLowerCase() !== verifiedEmail ||
    thread.verifiedRenterEmail?.trim().toLowerCase() !== verifiedEmail
  ) return null;
  if (!latestInbound || latestInbound.threadId !== thread._id || latestInbound.direction !== "in" || latestInbound.bookingId !== booking._id || !latestInbound.profileMessageId) return null;
  const mirrored = await ctx.db.get(latestInbound.profileMessageId);
  if (
    !mirrored ||
    mirrored.accountId !== account._id ||
    mirrored.bookingId !== booking._id ||
    mirrored.sender !== "renter" ||
    mirrored.meta?.channel !== "email" ||
    mirrored.meta?.emailThreadId !== String(thread._id) ||
    mirrored.meta?.emailMessageId !== String(latestInbound._id)
  ) return null;
  return { accountId: account._id, bookingId: booking._id };
}

async function projectEmailThreads(ctx: any, threads: any[]) {
  return Promise.all(threads.map(async thread => ({
    ...thread,
    rentalConversation: await rentalConversationForEmailThread(ctx, thread),
  })));
}

export const adminInbox = query({
  args: { token: v.string(), limit: v.optional(v.number()) },
  handler: async (ctx, { token, limit }) => {
    if (!checkAdminToken(token)) return { authorized: false as const, items: [] };
    const count = Math.min(100, Math.max(1, Math.floor(limit ?? 100)));
    const rows = await ctx.db.query("email_threads").withIndex("by_updated").order("desc").take(count);
    const replySetupStatus = businessEmailReadiness();
    const inboundForwardingAddress = configuredForwardingAddress();
    return { authorized: true as const, items: await projectEmailThreads(ctx, rows), replyConfigured: replySetupStatus === "ready", replySetupStatus, outboundSenderAddress: configuredBusinessSender(), replyToAddress: inboundForwardingAddress ?? OWNER_EMAIL, inboundForwardingAddress };
  },
});

export const adminInboxPage = query({
  args: { token: v.string(), paginationOpts: paginationOptsValidator },
  handler: async (ctx, { token, paginationOpts }) => {
    if (!checkAdminToken(token)) {
      return { authorized: false as const, page: [], isDone: true, continueCursor: "" };
    }
    const numItems = Math.min(100, Math.max(1, Math.floor(paginationOpts.numItems)));
    const page = await ctx.db.query("email_threads")
      .withIndex("by_updated")
      .order("desc")
      .paginate({ cursor: paginationOpts.cursor, numItems });
    return { authorized: true as const, ...page, page: await projectEmailThreads(ctx, page.page) };
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
    const inboundForwardingAddress = configuredForwardingAddress();
    const replyToAddress = inboundForwardingAddress ?? OWNER_EMAIL;
    if (!thread) return { authorized: true as const, thread: null, messages: [], rentalConversation: null, replyConfigured, replySetupStatus, outboundSenderAddress, replyToAddress, inboundForwardingAddress };
    const messages = (await threadMessages(ctx, threadId, 40)).reverse();
    const latestInbound = await latestInboundMessage(ctx, thread);
    const replyDeliveryStatus = await unresolvedReplyDelivery(ctx, thread, latestInbound);
    const rentalConversation = await rentalConversationForEmailThread(ctx, thread);
    return { authorized: true as const, thread, messages, rentalConversation, replyConfigured, replySetupStatus, outboundSenderAddress, replyToAddress, inboundForwardingAddress, replyDeliveryStatus };
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
  args: { threadId: v.id("email_threads"), replyId: v.string(), text: v.string(), inReplyTo: v.optional(v.string()), references: v.array(v.string()) },
  handler: async (ctx, args) => {
    if (!isOwnerReplyId(args.replyId)) throw new Error("Invalid email reply request.");
    const thread = await ctx.db.get(args.threadId);
    if (!thread) throw new Error("email thread not found");
    const replyKey = thread.replyKey ?? makeReplyKey();
    const replyThread = { ...thread, replyKey };
    if (!thread.replyKey) await ctx.db.patch(thread._id, { replyKey });
    const latestInbound = await latestInboundMessage(ctx, thread);
    const bookingId = await verifiedEmailBookingId(ctx, thread, thread.bookingId);
    const deliveryKey = `email-owner:${args.threadId}:${args.replyId}`;
    const outboxKey = `out:${deliveryKey}`;
    const existing = await ctx.db.query("email_messages").withIndex("by_provider", (q) => q.eq("providerId", outboxKey)).first();
    const now = Date.now();
    if (existing && (existing.threadId !== thread._id || existing.direction !== "out" || existing.recipient !== thread.email)) {
      throw new Error("Email reply request does not match its thread.");
    }
    if (existing && existing.text !== args.text) throw new Error("Retry the same email reply text or start a new reply.");
    if (existing?.state === "sent") return { state: "sent" as const };
    if (existing?.state === "uncertain") return { state: "uncertain" as const };
    if (existing?.state === "failed" && !emailReplyFailureIsRetryable(existing)) {
      await makeReplyDeliveryUncertain(ctx, thread, existing);
      return { state: "uncertain" as const };
    }
    const deliveryStatus = await unresolvedReplyDelivery(ctx, thread, latestInbound, now, true);
    if (deliveryStatus) return { state: deliveryStatus === "sending" ? "busy" as const : deliveryStatus };
    if (existing?.state === "processing") {
      if ((existing.leaseUntil ?? 0) > now) return { state: "busy" as const };
      await ctx.db.patch(existing._id, { state: "uncertain", leaseUntil: undefined, error: "The previous email send did not finish cleanly; check delivery before sending again." });
      return { state: "uncertain" as const };
    }
    const outboundId = existing?._id ?? await ctx.db.insert("email_messages", {
      threadId: args.threadId,
      ...(bookingId ? { bookingId } : {}),
      direction: "out",
      chatSender: "owner",
      sender: OWNER_EMAIL,
      recipient: thread.email,
      subject: thread.subject,
      text: args.text,
      at: now,
      providerId: outboxKey,
      state: "processing",
      leaseUntil: now + LEASE_MS,
      ...(latestInbound ? { replyToProviderId: latestInbound.providerId ?? String(latestInbound._id) } : {}),
      inReplyTo: args.inReplyTo,
      references: args.references,
      humanRequested: true,
    });
    if (existing) await ctx.db.patch(existing._id, { state: "processing", leaseUntil: now + LEASE_MS, text: args.text, chatSender: existing.chatSender ?? "owner", ...(latestInbound ? { replyToProviderId: latestInbound.providerId ?? String(latestInbound._id) } : {}), ...(bookingId ? { bookingId } : {}), error: undefined });
    return { state: "claimed" as const, thread: replyThread, outboundId };
  },
});

export const reserveChatOwnerReply = internalMutation({
  args: {
    threadId: v.id("email_threads"),
    emailMessageId: v.id("email_messages"),
    chatMessageId: v.id("messages"),
    replyId: v.string(),
    text: v.string(),
  },
  handler: async (ctx, args) => {
    if (!/^[a-f0-9-]{36}$/i.test(args.replyId)) throw new Error("Invalid email reply request.");
    const thread = await ctx.db.get(args.threadId);
    const inbound = await ctx.db.get(args.emailMessageId);
    const chatMessage = await ctx.db.get(args.chatMessageId);
    if (!thread || !inbound || inbound.direction !== "in" || inbound.threadId !== thread._id) {
      throw new Error("This email message is no longer available to reply to.");
    }
    const account = chatMessage && await ctx.db.get(chatMessage.accountId);
    const email = typeof account?.email === "string" ? account.email.trim().toLowerCase() : "";
    const chatEmailMessageId = chatMessage?.meta?.emailMessageId;
    if (
      !account || !chatMessage || chatMessage.sender !== "renter" ||
      chatMessage.meta?.channel !== "email" || chatMessage.meta?.emailThreadId !== String(thread._id) ||
      chatEmailMessageId !== String(inbound._id) ||
      thread.accountId !== account._id || thread.email.trim().toLowerCase() !== email ||
      thread.verifiedRenterEmail?.trim().toLowerCase() !== email ||
      typeof account.emailVerifiedAt !== "number" || account.emailVerificationRequired === true
    ) {
      throw new Error("This email is not linked to the renter's verified conversation.");
    }
    if (chatMessage.bookingId && inbound.bookingId && chatMessage.bookingId !== inbound.bookingId) {
      throw new Error("This email message is linked to a different rental conversation.");
    }
    const bookingId = await verifiedEmailBookingId(ctx, thread, chatMessage.bookingId ?? inbound.bookingId, account);
    let latestInboundId = thread.latestInboundMessageId;
    if (!latestInboundId) {
      latestInboundId = (await ctx.db.query("email_messages")
        .withIndex("by_thread_at", (q: any) => q.eq("threadId", thread._id))
        .order("desc")
        .take(100))
        .find((message: any) => message.direction === "in")?._id;
    }
    if (latestInboundId !== inbound._id) throw new Error("A newer email arrived. Refresh the conversation before replying.");

    const latestRenterChatMessage = chatMessage.bookingId
      ? (await ctx.db.query("messages")
        .withIndex("by_booking_account_sender_at", (q: any) => q.eq("bookingId", chatMessage.bookingId).eq("accountId", account._id).eq("sender", "renter"))
        .order("desc")
        .take(1))[0]
      : (await ctx.db.query("messages")
        .withIndex("by_account", (q: any) => q.eq("accountId", account._id))
        .order("desc")
        .take(100))
        .find((message: any) => !message.bookingId && message.sender === "renter");
    if (latestRenterChatMessage?._id !== chatMessage._id) {
      throw new Error("The renter has sent a newer message. Refresh the conversation before replying.");
    }

    const deliveryKey = `email-chat:${thread._id}:${inbound._id}:${args.replyId}`;
    const outboxKey = `out:${deliveryKey}`;
    const existing = await ctx.db.query("email_messages")
      .withIndex("by_provider", (q: any) => q.eq("providerId", outboxKey))
      .first();
    const now = Date.now();
    if (existing && (existing.threadId !== thread._id || existing.direction !== "out" || existing.recipient !== email)) {
      throw new Error("Email reply request does not match its thread.");
    }
    if (existing && existing.text !== args.text) throw new Error("Retry the same email reply text or start a new reply.");
    if (existing?.state === "sent") return { state: "sent" as const };
    if (existing?.state === "uncertain") return { state: "uncertain" as const };
    if (existing?.state === "failed" && !emailReplyFailureIsRetryable(existing)) {
      await makeReplyDeliveryUncertain(ctx, thread, existing);
      return { state: "uncertain" as const };
    }
    const deliveryStatus = await unresolvedReplyDelivery(ctx, thread, inbound, now, true);
    if (deliveryStatus) return { state: deliveryStatus === "sending" ? "busy" as const : deliveryStatus };
    if (existing?.state === "processing" && (existing.leaseUntil ?? 0) > now) return { state: "busy" as const };
    if (existing?.state === "processing") {
      await ctx.db.patch(existing._id, { state: "uncertain", leaseUntil: undefined, error: "The previous email send did not finish cleanly; check delivery before sending again." });
      return { state: "uncertain" as const };
    }
    const outboundId = existing?._id ?? await ctx.db.insert("email_messages", {
      threadId: thread._id,
      ...(bookingId ? { bookingId } : {}),
      direction: "out",
      chatSender: "owner",
      sender: OWNER_EMAIL,
      recipient: email,
      subject: thread.subject,
      text: args.text,
      at: now,
      providerId: outboxKey,
      state: "processing",
      leaseUntil: now + LEASE_MS,
      replyToProviderId: inbound.providerId ?? String(inbound._id),
      inReplyTo: inbound.messageId,
      references: [...new Set([...(inbound.references ?? []), inbound.messageId].filter((value: any): value is string => typeof value === "string" && value.length > 0))].slice(-20),
      humanRequested: true,
    });
    if (existing) await ctx.db.patch(existing._id, { state: "processing", leaseUntil: now + LEASE_MS, chatSender: existing.chatSender ?? "owner", replyToProviderId: inbound.providerId ?? String(inbound._id), ...(bookingId ? { bookingId } : {}), error: undefined });
    const replyKey = thread.replyKey ?? makeReplyKey();
    const replyThread = { ...thread, replyKey };
    if (!thread.replyKey) await ctx.db.patch(thread._id, { replyKey });
    return {
      state: "claimed" as const,
      thread: replyThread,
      inbound,
      outboundId,
      deliveryKey,
      inReplyTo: inbound.messageId,
      references: [...new Set([...(inbound.references ?? []), inbound.messageId].filter((value: any): value is string => typeof value === "string" && value.length > 0))].slice(-20),
    };
  },
});

export const finishOwnerReply = internalMutation({
  args: { threadId: v.id("email_threads"), outboundId: v.id("email_messages"), text: v.string(), messageId: v.optional(v.string()), resendEmailId: v.optional(v.string()), inReplyTo: v.optional(v.string()), references: v.array(v.string()) },
  handler: async (ctx, args) => {
    const thread = await ctx.db.get(args.threadId);
    const out = await ctx.db.get(args.outboundId);
    if (!thread || !out) throw new Error("owner reply context not found");
    if (out.state === "sent") return { ok: true, duplicate: true };
    const now = Date.now();
    const providerFields = await providerDeliveryFields(ctx, out, args.resendEmailId);
    await ctx.db.patch(args.outboundId, { state: "sent", at: now, ...(args.messageId ? { messageId: args.messageId } : {}), inReplyTo: args.inReplyTo, references: args.references, leaseUntil: undefined, ...providerFields });
    await ctx.db.patch(args.threadId, { updatedAt: now, lastAt: now, lastDirection: "out", lastText: args.text.slice(0, 280), unreadOwner: 0, status: "open" });
    if (thread.accountId && !out.profileMessageId) {
      const bookingContextMatches = !thread.bookingId || !out.bookingId || thread.bookingId === out.bookingId;
      const bookingId = bookingContextMatches
        ? await verifiedEmailBookingId(ctx, thread, out.bookingId ?? thread.bookingId)
        : null;
      const profileMessageId = await postRentalMessage(ctx, { accountId: thread.accountId, ...(bookingId ? { bookingId } : {}), sender: out.chatSender ?? "owner", text: args.text, meta: { channel: "email", emailThreadId: String(thread._id), emailMessageId: String(args.outboundId) } });
      await ctx.db.patch(args.outboundId, { profileMessageId });
    }
    return { ok: true };
  },
});

export const markChatOwnerReplyUncertain = internalMutation({
  args: { threadId: v.id("email_threads"), outboundId: v.id("email_messages") },
  handler: async (ctx, args) => {
    const outbound = await ctx.db.get(args.outboundId);
    if (!outbound || outbound.threadId !== args.threadId || outbound.direction !== "out" || outbound.chatSender !== "owner") {
      throw new Error("owner email reply could not be reconciled");
    }
    const thread = await ctx.db.get(args.threadId);
    if (!thread) throw new Error("owner email reply could not be reconciled");
    return { state: await makeReplyDeliveryUncertain(ctx, thread, outbound) };
  },
});

export const sendChatOwnerReply = action({
  args: {
    token: v.string(),
    threadId: v.id("email_threads"),
    emailMessageId: v.id("email_messages"),
    chatMessageId: v.id("messages"),
    replyId: v.string(),
    text: v.string(),
  },
  handler: async (ctx, args) => {
    if (!checkAdminToken(args.token)) throw new Error("unauthorized");
    if (!businessEmailReady()) throw new Error("Business email sending is not configured.");
    const text = args.text.trim().slice(0, 2_000);
    if (!text) throw new Error("Write a reply first.");
    const claim = await ctx.runMutation(internal.emailInbox.reserveChatOwnerReply, { ...args, text });
    if (claim.state === "sent") return { ok: true, duplicate: true };
    if (claim.state === "busy") return { ok: false, busy: true };
    if (claim.state === "uncertain") return { ok: false, uncertain: true };
    if (claim.state !== "claimed") return { ok: false, uncertain: true };
    const replyTo = gafferReplyAddress(claim.thread.replyKey);
    if (!replyTo) {
      await ctx.runMutation(internal.emailInbox.markEmailReplyRetryable, { threadId: args.threadId, outboundId: claim.outboundId, kind: "preflight", error: "Gaffer email reply route is not configured" });
      throw new Error("Gaffer email reply route is not configured");
    }
    let delivery: { sent: boolean; ambiguous?: boolean; messageId?: string; resendEmailId?: string };
    try {
      delivery = await ctx.runAction(internal.emailMailer.sendBusinessReply, {
        to: claim.thread.email,
        subject: replySubject(claim.thread.subject),
        html: safeHtml(text),
        replyTo,
        deliveryKey: claim.deliveryKey,
        inReplyTo: claim.inReplyTo,
        references: claim.references,
      });
    } catch {
      await ctx.runMutation(internal.emailInbox.markChatOwnerReplyUncertain, { threadId: args.threadId, outboundId: claim.outboundId });
      return { ok: false, uncertain: true };
    }
    if (!delivery.sent) {
      if (delivery.ambiguous) {
        await ctx.runMutation(internal.emailInbox.markChatOwnerReplyUncertain, { threadId: args.threadId, outboundId: claim.outboundId });
        return { ok: false, uncertain: true };
      }
      await ctx.runMutation(internal.emailInbox.markEmailReplyRetryable, { threadId: args.threadId, outboundId: claim.outboundId, kind: "provider_rejected", error: "Resend definitively rejected the reply." });
      throw new Error("The email reply could not be sent.");
    }
    try {
      await ctx.runMutation(internal.emailInbox.finishOwnerReply, {
        threadId: args.threadId,
        outboundId: claim.outboundId,
        text,
        ...(delivery.messageId ? { messageId: delivery.messageId } : {}),
        ...(delivery.resendEmailId ? { resendEmailId: delivery.resendEmailId } : {}),
        inReplyTo: claim.inReplyTo,
        references: claim.references,
      });
    } catch {
      await ctx.runMutation(internal.emailInbox.markChatOwnerReplyUncertain, { threadId: args.threadId, outboundId: claim.outboundId });
      return { ok: false, uncertain: true };
    }
    return { ok: true };
  },
});

export const reserveCheckoutCartEmail = internalMutation({
  args: {
    email: v.string(),
    accountId: v.optional(v.id("accounts")),
    shareKey: v.string(),
    text: v.string(),
    profileMessageId: v.optional(v.id("messages")),
    chatSender: v.optional(v.union(v.literal("bot"), v.literal("owner"))),
  },
  handler: async (ctx, args) => {
    const email = args.email.trim().toLowerCase();
    const text = args.text.trim().slice(0, 12_000);
    if (!EMAIL_ADDRESS_RE.test(email) || !/^[A-Za-z0-9_-]{43}$/.test(args.shareKey) || !text) throw new Error("Check the rental kit email and try again.");
    const now = Date.now();
    const cart = await ctx.db.query("checkout_carts").withIndex("by_share", (q: any) => q.eq("shareKey", args.shareKey)).unique();
    if (!cart || cart.expiresAt <= now || cart.email !== email || args.accountId && cart.accountId !== args.accountId) {
      throw new Error("This rental kit link is no longer available. Build a new kit and try again.");
    }
    if (args.profileMessageId) {
      const profileMessage = await ctx.db.get(args.profileMessageId);
      if (!profileMessage || !args.accountId || profileMessage.accountId !== args.accountId) throw new Error("The rental chat card could not be linked to this email.");
    }

    const deliveryKey = `checkout-cart:${args.shareKey}`;
    const providerId = `out:${deliveryKey}`;
    const existing = await ctx.db.query("email_messages").withIndex("by_provider", (q: any) => q.eq("providerId", providerId)).first();
    if (existing) {
      if (existing.recipient !== email || existing.text !== text) throw new Error("This rental kit email key is already in use.");
      if (existing.state === "sent") return { state: "sent" as const };
      if (existing.state === "uncertain") return { state: "uncertain" as const };
      if (existing.state === "processing" && (existing.leaseUntil ?? 0) > now) return { state: "busy" as const };
      const thread = await ctx.db.get(existing.threadId);
      if (!thread) throw new Error("The rental kit email thread could not be found.");
      if (existing.state === "processing" || existing.state !== "failed" || !emailReplyFailureIsRetryable(existing)) {
        await makeReplyDeliveryUncertain(ctx, thread, existing);
        return { state: "uncertain" as const };
      }
      if (await unresolvedReplyDelivery(ctx, thread, null, now, true)) return { state: "uncertain" as const };
      const replyKey = thread.replyKey ?? makeReplyKey();
      if (!thread.replyKey) await ctx.db.patch(thread._id, { replyKey });
      const inReplyTo = existing.inReplyTo;
      const references = existing.references ?? [];
      await ctx.db.patch(existing._id, {
        state: "processing",
        leaseUntil: now + LEASE_MS,
        error: undefined,
        chatSender: existing.chatSender ?? args.chatSender ?? "owner",
        ...(args.profileMessageId ? { profileMessageId: args.profileMessageId } : {}),
      });
      return { state: "claimed" as const, threadId: thread._id, replyKey, outboundId: existing._id, deliveryKey, subject: existing.subject, inReplyTo, references };
    }

    const candidateAccount = args.accountId ? await ctx.db.get(args.accountId) : null;
    if (args.accountId && (!candidateAccount || candidateAccount.email?.trim().toLowerCase() !== email)) {
      throw new Error("The selected customer email changed. Refresh the account and try again.");
    }
    const account = candidateAccount && candidateAccount.emailVerificationRequired !== true &&
      typeof candidateAccount.emailVerifiedAt === "number" && Number.isFinite(candidateAccount.emailVerifiedAt) && candidateAccount.emailVerifiedAt > 0
      ? candidateAccount
      : null;
    const kitSubject = "Your DB Cinema Rentals rental kit";
    const recentThreads = await ctx.db.query("email_threads")
      .withIndex("by_email_updated", (q: any) => q.eq("email", email))
      .order("desc")
      .take(20);
    let thread = recentThreads.find((row: any) => subjectKey(row.subject) === subjectKey(kitSubject) && now - row.updatedAt < 30 * 86_400_000 &&
      (account ? row.accountId === account._id : row.accountId === undefined)) ?? null;
    if (!thread) {
      const threadId = await ctx.db.insert("email_threads", {
        email,
        name: candidateAccount?.name,
        subject: kitSubject,
        replyKey: makeReplyKey(),
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
      thread = await ctx.db.get(threadId);
    } else {
      await ctx.db.patch(thread._id, {
        ...(account ? { accountId: account._id, verifiedRenterEmail: email } : {}),
        replyKey: thread.replyKey ?? makeReplyKey(),
        ...(candidateAccount?.name && !thread.name ? { name: candidateAccount.name } : {}),
        status: thread.status === "closed" ? "open" : thread.status,
      });
      thread = await ctx.db.get(thread._id);
    }
    if (!thread) throw new Error("The rental kit email thread could not be created.");
    if (await unresolvedReplyDelivery(ctx, thread, null, now, true)) return { state: "uncertain" as const };
    const replyKey = thread.replyKey ?? makeReplyKey();
    if (!thread.replyKey) await ctx.db.patch(thread._id, { replyKey });

    const latest = (await threadMessages(ctx, thread._id, 30))[0];
    const inReplyTo = latest?.messageId;
    const references = [...new Set([...(latest?.references ?? []), inReplyTo].filter((value): value is string => typeof value === "string" && value.length > 0))].slice(-20);
    const subject = latest?.messageId ? replySubject(thread.subject) : thread.subject;
    const outboundId = await ctx.db.insert("email_messages", {
      threadId: thread._id,
      direction: "out",
      chatSender: args.chatSender ?? "owner",
      sender: OWNER_EMAIL,
      recipient: email,
      subject,
      text,
      at: now,
      providerId,
      state: "processing",
      leaseUntil: now + LEASE_MS,
      inReplyTo,
      references,
      humanRequested: false,
      ...(args.profileMessageId ? { profileMessageId: args.profileMessageId } : {}),
    });
    return { state: "claimed" as const, threadId: thread._id, replyKey, outboundId, deliveryKey, subject, inReplyTo, references };
  },
});

export const markCheckoutCartEmailUncertain = internalMutation({
  args: { threadId: v.id("email_threads"), outboundId: v.id("email_messages") },
  handler: async (ctx, { threadId, outboundId }) => {
    const thread = await ctx.db.get(threadId), outbound = await ctx.db.get(outboundId);
    if (!thread || !outbound || outbound.threadId !== threadId || outbound.direction !== "out" || !outbound.providerId?.startsWith("out:checkout-cart:")) throw new Error("The rental kit email could not be reconciled.");
    return { state: await makeReplyDeliveryUncertain(ctx, thread, outbound) };
  },
});

export const sendCheckoutCartEmail = internalAction({
  args: {
    email: v.string(),
    accountId: v.optional(v.id("accounts")),
    shareKey: v.string(),
    chatSender: v.optional(v.union(v.literal("bot"), v.literal("owner"))),
    profileMessageId: v.optional(v.id("messages")),
  },
  handler: async (ctx, args): Promise<{ sent: boolean; duplicate?: boolean; busy?: boolean; uncertain?: boolean }> => {
    if (!businessEmailReady()) throw new Error("Business email sending is not configured.");
    if (!/^[A-Za-z0-9_-]{43}$/.test(args.shareKey)) throw new Error("This rental kit link is invalid.");
    const url = checkoutCartUrl(args.shareKey);
    const text = `Your rental kit is ready.\n\nReview your kit: ${url}\n\nThis private link expires in seven days. Availability and final pricing are checked at checkout; opening the link does not reserve items or take payment.`;
    const claim = await ctx.runMutation(internal.emailInbox.reserveCheckoutCartEmail, { ...args, text });
    if (claim.state === "sent") return { sent: true, duplicate: true };
    if (claim.state === "busy") return { sent: false, busy: true };
    if (claim.state === "uncertain") return { sent: false, uncertain: true };
    const replyTo = gafferReplyAddress(claim.replyKey);
    if (!replyTo) {
      await ctx.runMutation(internal.emailInbox.markEmailReplyRetryable, { threadId: claim.threadId, outboundId: claim.outboundId, kind: "preflight", error: "Gaffer email reply route is not configured" });
      return { sent: false };
    }
    const html = `<div style="margin:0;background:#101111;padding:32px 16px;color:#f6f0e8;font-family:Arial,sans-serif"><div style="max-width:520px;margin:auto;border:1px solid #ffffff22;border-radius:20px;background:linear-gradient(145deg,#25211d,#141515);padding:28px"><p style="margin:0 0 10px;color:#dfb98f;font-size:11px;letter-spacing:.16em;text-transform:uppercase">DB Cinema Rentals</p><h1 style="margin:0 0 12px;font-family:Georgia,serif;font-size:26px">Your rental kit is ready</h1><p style="color:#c9c4be;line-height:1.6">Review the selected gear, add any missing dates, and finish checkout securely.</p><p style="margin:24px 0"><a href="${url}" style="display:inline-block;border-radius:999px;background:#d9ad80;padding:13px 22px;color:#17130f;text-decoration:none;font-weight:700">Review your kit</a></p><p style="color:#aaa39c;font-size:12px;line-height:1.6">This private link expires in seven days. Availability and final pricing are checked again at checkout. Items are not reserved by opening this link.</p></div></div>`;
    let delivery: { sent: boolean; ambiguous?: boolean; messageId?: string; resendEmailId?: string };
    try {
      delivery = await ctx.runAction(internal.emailMailer.sendBusinessReply, {
        to: args.email.trim().toLowerCase(),
        subject: claim.subject,
        html,
        replyTo,
        deliveryKey: claim.deliveryKey,
        ...(claim.inReplyTo ? { inReplyTo: claim.inReplyTo } : {}),
        references: claim.references,
      });
    } catch {
      await ctx.runMutation(internal.emailInbox.markCheckoutCartEmailUncertain, { threadId: claim.threadId, outboundId: claim.outboundId });
      return { sent: false, uncertain: true };
    }
    if (!delivery.sent) {
      if (delivery.ambiguous) {
        await ctx.runMutation(internal.emailInbox.markCheckoutCartEmailUncertain, { threadId: claim.threadId, outboundId: claim.outboundId });
        return { sent: false, uncertain: true };
      }
      await ctx.runMutation(internal.emailInbox.markEmailReplyRetryable, { threadId: claim.threadId, outboundId: claim.outboundId, kind: "provider_rejected", error: "The rental kit email was rejected." });
      return { sent: false };
    }
    try { await ctx.runMutation(internal.emailInbox.finishOwnerReply, {
      threadId: claim.threadId,
      outboundId: claim.outboundId,
      text,
      ...(delivery.messageId ? { messageId: delivery.messageId } : {}),
      ...(delivery.resendEmailId ? { resendEmailId: delivery.resendEmailId } : {}),
      ...(claim.inReplyTo ? { inReplyTo: claim.inReplyTo } : {}),
      references: claim.references,
    }); } catch {
      await ctx.runMutation(internal.emailInbox.markCheckoutCartEmailUncertain, { threadId: claim.threadId, outboundId: claim.outboundId });
      return { sent: false, uncertain: true };
    }
    return { sent: true, duplicate: false };
  },
});

export const sendOwnerReply = action({
  args: { token: v.string(), threadId: v.id("email_threads"), replyId: v.string(), text: v.string() },
  handler: async (ctx, args) => {
    if (!checkAdminToken(args.token)) throw new Error("unauthorized");
    if (!isOwnerReplyId(args.replyId)) throw new Error("Invalid email reply request.");
    const text = args.text.trim().slice(0, 12_000);
    if (!text) throw new Error("Write a reply first.");
    const data = await ctx.runQuery(internal.emailInbox.replyContext, { threadId: args.threadId });
    if (!data?.thread) throw new Error("email thread not found");
    const latest = data.recent[0];
    const inReplyTo = latest?.messageId;
    const references = [...new Set([...(latest?.references ?? []), inReplyTo].filter((value): value is string => typeof value === "string" && value.length > 0))].slice(-20);
    const deliveryKey = `email-owner:${args.threadId}:${args.replyId}`;
    const claim = await ctx.runMutation(internal.emailInbox.reserveOwnerReply, { threadId: args.threadId, replyId: args.replyId, text, inReplyTo, references });
    if (claim.state === "sent") return { ok: true, duplicate: true };
    if (claim.state === "busy") return { ok: false, busy: true };
    if (claim.state === "uncertain") return { ok: false, uncertain: true };
    if (claim.state !== "claimed") return { ok: false, uncertain: true };
    const replyTo = gafferReplyAddress(claim.thread.replyKey);
    if (!replyTo) {
      await ctx.runMutation(internal.emailInbox.markEmailReplyRetryable, { threadId: args.threadId, outboundId: claim.outboundId, kind: "preflight", error: "Gaffer email reply route is not configured" });
      throw new Error("Gaffer email reply route is not configured");
    }
    let delivery: { sent: boolean; ambiguous?: boolean; messageId?: string; resendEmailId?: string };
    try {
      delivery = await ctx.runAction(internal.emailMailer.sendBusinessReply, {
        to: data.thread.email,
        subject: replySubject(data.thread.subject),
        html: safeHtml(text),
        replyTo,
        deliveryKey,
        inReplyTo,
        references,
      });
    } catch {
      await ctx.runMutation(internal.emailInbox.markChatOwnerReplyUncertain, { threadId: args.threadId, outboundId: claim.outboundId });
      return { ok: false, uncertain: true };
    }
    if (!delivery.sent) {
      if (delivery.ambiguous) {
        await ctx.runMutation(internal.emailInbox.markChatOwnerReplyUncertain, { threadId: args.threadId, outboundId: claim.outboundId });
        return { ok: false, uncertain: true };
      }
      await ctx.runMutation(internal.emailInbox.markEmailReplyRetryable, { threadId: args.threadId, outboundId: claim.outboundId, kind: "provider_rejected", error: "Resend definitively rejected the reply." });
      throw new Error("business email reply could not be sent");
    }
    try {
      await ctx.runMutation(internal.emailInbox.finishOwnerReply, { threadId: args.threadId, outboundId: claim.outboundId, text, ...(delivery.messageId ? { messageId: delivery.messageId } : {}), ...(delivery.resendEmailId ? { resendEmailId: delivery.resendEmailId } : {}), inReplyTo, references });
    } catch {
      await ctx.runMutation(internal.emailInbox.markChatOwnerReplyUncertain, { threadId: args.threadId, outboundId: claim.outboundId });
      return { ok: false, uncertain: true };
    }
    return { ok: true };
  },
});

/** Only authenticated, verified ownership can attach pre-signup email history. */
export const claimForAccount = mutation({
  args: { token: v.string() },
  handler: async (ctx, { token }) => {
    const account = await accountForToken(ctx, token);
    if (!account || !account.emailVerifiedAt || account.emailVerificationRequired || account.blockedAt != null) return { ok: false };
    const verifiedAccount = await verifiedAccountForEmail(ctx, account.email.trim().toLowerCase());
    if (verifiedAccount?._id !== account._id) return { ok: false };
    await ctx.scheduler.runAfter(0, internal.emailInbox.linkVerifiedHistory, { accountId: account._id, cursor: null });
    return { ok: true };
  },
});

export const linkVerifiedHistory = internalMutation({
  args: { accountId: v.id("accounts"), cursor: v.union(v.string(), v.null()) },
  handler: async (ctx, { accountId, cursor }) => {
    const account = await ctx.db.get(accountId);
    if (!account || !account.emailVerifiedAt || account.emailVerificationRequired || account.blockedAt != null) return;
    const email = account.email.trim().toLowerCase();
    const verifiedAccount = await verifiedAccountForEmail(ctx, email);
    if (verifiedAccount?._id !== accountId) return;
    const page = await ctx.db.query("email_threads").withIndex("by_email_updated", q => q.eq("email", email)).paginate({ cursor, numItems: 10 });
    for (const thread of page.page) {
      if (thread.accountId && thread.accountId !== accountId) continue;
      if (thread.verifiedRenterEmail && thread.verifiedRenterEmail.trim().toLowerCase() !== email) continue;
      if (!thread.accountId || !thread.verifiedRenterEmail) {
        await ctx.db.patch(thread._id, { accountId, verifiedRenterEmail: email });
      }
      await ctx.scheduler.runAfter(0, internal.emailInbox.copyVerifiedHistory, { accountId, threadId: thread._id, cursor: null });
    }
    if (!page.isDone) await ctx.scheduler.runAfter(0, internal.emailInbox.linkVerifiedHistory, { accountId, cursor: page.continueCursor });
  },
});

export const copyVerifiedHistory = internalMutation({
  args: { accountId: v.id("accounts"), threadId: v.id("email_threads"), cursor: v.union(v.string(), v.null()) },
  handler: async (ctx, { accountId, threadId, cursor }) => {
    const account = await ctx.db.get(accountId), thread = await ctx.db.get(threadId);
    const email = account?.email?.trim().toLowerCase();
    if (!account || !thread || !email || thread.accountId !== accountId || thread.email.trim().toLowerCase() !== email || thread.verifiedRenterEmail?.trim().toLowerCase() !== email || !account.emailVerifiedAt || account.emailVerificationRequired || account.blockedAt != null) return;
    const verifiedAccount = await verifiedAccountForEmail(ctx, email);
    if (verifiedAccount?._id !== accountId) return;
    const threadBookingId = await verifiedEmailBookingId(ctx, thread, thread.bookingId, account);
    const page = await ctx.db.query("email_messages").withIndex("by_thread_at", q => q.eq("threadId", threadId)).order("asc").paginate({ cursor, numItems: 40 });
    for (const message of page.page) {
      if (message.direction === "out" && message.state !== "sent") continue;
      const latestInbound = thread.latestInboundMessageId ? await ctx.db.get(thread.latestInboundMessageId) : null;
      if (message.direction === "in" && (!latestInbound || latestInbound.at < message.at)) {
        await ctx.db.patch(thread._id, { latestInboundMessageId: message._id });
        thread.latestInboundMessageId = message._id;
      }
      const messageBookingId = await historyBookingId(ctx, account, message);
      const bookingId = message.bookingId ? messageBookingId : threadBookingId ?? messageBookingId;
      if (bookingId && !message.bookingId) await ctx.db.patch(message._id, { bookingId });
      if (message.profileMessageId) {
        const existing = await ctx.db.get(message.profileMessageId);
        if (
          existing?.accountId === accountId &&
          existing.meta?.channel === "email" &&
          existing.meta?.emailThreadId === String(threadId) &&
          existing.meta?.emailMessageId === String(message._id) &&
          bookingId &&
          !existing.bookingId
        ) {
          await ctx.db.patch(existing._id, { bookingId });
          await upsertBackfilledChatThread(ctx, accountId, bookingId, message, thread);
        }
        continue;
      }
      // Preserve original timestamps; backfill must not emit a new renter message or alert.
      const id = await ctx.db.insert("messages", {
        accountId,
        ...(bookingId ? { bookingId } : {}),
        sender: chatSenderForEmailMessage(message),
        text: message.text,
        at: message.at,
        readByOwner: true,
        threadCounted: true,
        meta: { channel: "email", emailThreadId: String(threadId), emailMessageId: String(message._id) },
      });
      await ctx.db.patch(message._id, { profileMessageId: id, ...(bookingId ? { bookingId } : {}) });
      await upsertBackfilledChatThread(ctx, accountId, bookingId, message, thread);
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
    for (const line of a.lines) if (line.start === undefined || line.end === undefined || !Number.isSafeInteger(line.start) || !Number.isSafeInteger(line.end) || line.end < line.start || line.end - line.start > 365 * 86400000 || !line.pickupTime || !line.returnTime || !await ctx.db.get(line.listingId)) throw new Error("Invalid proposed item");
    await ctx.db.insert("checkout_carts", { email: thread.email, accountId: thread.accountId, shareKey: a.shareKey, lines: a.lines, createdAt: Date.now(), expiresAt: Date.now() + 7 * 86400000 });
    return { ok: true };
  },
});
