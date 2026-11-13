import { internalMutation, mutation, query } from "./_generated/server";
import { internal } from "./_generated/api";
import { bump } from "./rateLimit";
import { v } from "convex/values";
import { assertAdmin, checkAdminToken } from "./adminAuth";
import { BUSINESS_CONTACT_EMAIL } from "../shared/businessEmail";

function makeEmailReplyKey() {
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export const submit = mutation({
  args: { name: v.string(), email: v.string(), message: v.string(), hp: v.optional(v.string()) },
  handler: async (ctx, a) => {
    // honeypot: a hidden field real users never see — bots fill it, so silently accept + drop.
    if (a.hp && a.hp.trim()) return { id: null };
    const name = a.name.trim().slice(0, 120);
    const email = a.email.trim().toLowerCase().slice(0, 200);
    const message = a.message.trim().slice(0, 4000);
    if (!name || message.length < 2) throw new Error("Please add your name and a message.");
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Error("Please enter a valid email address.");
    // anti-spam: per-email cap + global flood guard (shared rate_limits table)
    const perEmail = await bump(ctx, `contact:${email}`, 3, 10 * 60 * 1000);
    if (!perEmail.allowed) throw new Error("You've already sent us a few messages — we'll be in touch shortly.");
    const flood = await bump(ctx, "contact:global", 20, 60 * 1000);
    if (!flood.allowed) throw new Error("We're getting a lot of messages right now — please try again in a minute.");
    const id = await ctx.db.insert("contact_messages", { name, email, message, routedTo: "contact-form", handled: false });
    const accountCandidates = await ctx.db.query("accounts")
      .withIndex("by_email", (q) => q.eq("email", email))
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
    const now = Date.now();
    const subject = `Website contact: ${name}`;
    const threadId = await ctx.db.insert("email_threads", {
      email,
      name,
      subject,
      replyKey: makeEmailReplyKey(),
      accountId: account?._id,
      verifiedRenterEmail: account ? email : undefined,
      status: "open",
      createdAt: now,
      updatedAt: now,
      lastAt: now,
      lastDirection: "in",
      lastText: message.slice(0, 280),
      unreadOwner: 1,
    });
    await ctx.db.insert("email_messages", {
      threadId,
      direction: "in",
      sender: email,
      recipient: BUSINESS_CONTACT_EMAIL,
      subject,
      text: message,
      at: now,
      providerId: `contact-form:${id}`,
      state: "received",
      humanRequested: false,
    });
    if (account) await ctx.scheduler.runAfter(0, internal.emailInbox.copyVerifiedHistory, { accountId: account._id, threadId, cursor: null });
    await ctx.scheduler.runAfter(0, internal.notify.contactAutoReply, { contactId: id, name, email, message });
    return { id };
  },
});

/** The mirrored email thread is the staff conversation; this row remains only for retry/audit. */
export const markAutoHandled = internalMutation({
  args: { id: v.id("contact_messages") },
  handler: async (ctx, { id }) => {
    const row = await ctx.db.get(id);
    if (!row || row.routedTo !== "contact-form" || row.handled) return { ok: false };
    await ctx.db.patch(id, { handled: true });
    return { ok: true };
  },
});

export const adminList = query({
  args: { token: v.string() },
  handler: async (ctx, { token }) => {
    if (!checkAdminToken(token)) {
      return { authorized: false as const, items: [] };
    }
    const rows = await ctx.db.query("contact_messages").order("desc").take(100);
    const items = (await Promise.all(rows.map(async (r) => {
      if (r.routedTo === "contact-form") return null;
      const mirrored = await ctx.db.query("email_messages")
        .withIndex("by_provider", (q) => q.eq("providerId", `legacy-contact:${r._id}`))
        .first() ?? await ctx.db.query("email_messages")
          .withIndex("by_provider", (q) => q.eq("providerId", `contact-form:${r._id}`))
          .first();
      if (mirrored) return null;
      return {
      _id: r._id,
      name: r.name,
      email: r.email,
      message: r.message,
      routedTo: r.routedTo,
      handled: r.handled,
      at: r._creationTime,
      };
    }))).filter((item): item is NonNullable<typeof item> => item !== null);
    return { authorized: true as const, items };
  },
});

/** Bring a legacy enquiry into the shared email conversation before staff reply. */
export const openCentralThread = mutation({
  args: { token: v.string(), id: v.id("contact_messages") },
  handler: async (ctx, { token, id }) => {
    await assertAdmin(ctx, token, "contact.openCentralThread");
    const row = await ctx.db.get(id);
    if (!row) throw new Error("Enquiry not found.");

    const providerId = `legacy-contact:${row._id}`;
    const existing = await ctx.db.query("email_messages")
      .withIndex("by_provider", (q) => q.eq("providerId", providerId))
      .first();
    if (existing) {
      if (row.routedTo !== "central-email") await ctx.db.patch(id, { routedTo: "central-email" });
      return { threadId: existing.threadId };
    }
    if (row.routedTo === "contact-form") throw new Error("This enquiry is already in Messages → Emails.");

    const email = row.email.trim().toLowerCase().slice(0, 200);
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Error("This enquiry has no valid reply address.");
    if (row.routedTo?.startsWith("voice-") && email === "voice@dbcinemarentals.com")
      throw new Error("This voice request has no renter email address to reply to.");
    const name = row.name.trim().slice(0, 120);
    const message = row.message.trim().slice(0, 4000);
    if (!message) throw new Error("This enquiry has no message to move.");
    const now = Date.now();
    const accountCandidates = await ctx.db.query("accounts")
      .withIndex("by_email", (q) => q.eq("email", email))
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
    const subject = `Website enquiry: ${name || "Customer"}`;
    const threadId = await ctx.db.insert("email_threads", {
      email,
      name: name || undefined,
      subject,
      replyKey: makeEmailReplyKey(),
      accountId: account?._id,
      verifiedRenterEmail: account ? email : undefined,
      status: "open",
      createdAt: now,
      updatedAt: now,
      lastAt: now,
      lastDirection: "in",
      lastText: message.slice(0, 280),
      unreadOwner: 1,
    });
    await ctx.db.insert("email_messages", {
      threadId,
      direction: "in",
      sender: email,
      recipient: BUSINESS_CONTACT_EMAIL,
      subject,
      text: message,
      at: now,
      providerId,
      state: "received",
      humanRequested: false,
    });
    await ctx.db.patch(id, { routedTo: "central-email" });
    if (account) await ctx.scheduler.runAfter(0, internal.emailInbox.copyVerifiedHistory, { accountId: account._id, threadId, cursor: null });
    return { threadId };
  },
});
