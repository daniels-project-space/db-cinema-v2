import { action, internalMutation, internalQuery, mutation, query } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import { bump } from "./rateLimit";

/**
 * Written follow-ups from a Gaffer voice call.
 *
 * A call is gone the moment it ends — the customer has no reference, no quote,
 * nothing to reply to. Anything Gaffer can't finish on the phone gets put in
 * writing here, addressed so that a reply comes back into the same thread
 * rather than landing as an orphan in the owner's inbox.
 *
 * Sending is deliberately rate-limited and validated: this is reachable from
 * the browser (Gaffer calls it as a client tool), so without a cap it is an
 * open relay for sending mail to arbitrary addresses.
 */

/** Conservative: no display names, no quoted locals, no spaces. */
const EMAIL_RE = /^[^\s@,;:<>"'\\]+@[^\s@.,;:<>"'\\]+\.[a-z]{2,}$/i;

export function isEmail(s: string): boolean {
  const e = String(s ?? "").trim();
  return e.length <= 254 && EMAIL_RE.test(e);
}

/** Opaque thread handle — used in the reply-to address, so keep it URL-safe. */
function makeReplyKey(): string {
  const b = new Uint8Array(12);
  crypto.getRandomValues(b);
  return Array.from(b, (n) => n.toString(16).padStart(2, "0")).join("");
}

export const _record = internalMutation({
  args: {
    email: v.string(),
    name: v.optional(v.string()),
    subject: v.string(),
    body: v.string(),
    replyKey: v.string(),
    direction: v.string(),
    accountId: v.optional(v.id("accounts")),
  },
  handler: async (ctx, a) => {
    await ctx.db.insert("gaffer_follow_ups", {
      at: Date.now(),
      handled: a.direction === "out",
      ...a,
    });
  },
});

/** Per-address cap, so one caller can't be used to mail-bomb someone. */
export const _checkRate = internalMutation({
  args: { email: v.string() },
  handler: async (ctx, { email }) => {
    const perAddress = await bump(ctx, `followup:${email.toLowerCase()}`, 3, 60 * 60 * 1000);
    const global = await bump(ctx, "followup:all", 60, 60 * 60 * 1000);
    return { allowed: perAddress.allowed && global.allowed };
  },
});

export const _byReplyKey = internalQuery({
  args: { replyKey: v.string() },
  handler: async (ctx, { replyKey }) =>
    await ctx.db
      .query("gaffer_follow_ups")
      .withIndex("by_replyKey", (q) => q.eq("replyKey", replyKey))
      .first(),
});

/**
 * Send the customer what was agreed on the call.
 *
 * Public because Gaffer calls it from the browser mid-conversation; the guards
 * above are what make that safe. Returns a short sentence — the agent reads the
 * result aloud, so it doubles as its own confirmation of what happened.
 */
export const send = action({
  args: {
    email: v.string(),
    name: v.optional(v.string()),
    summary: v.string(),
    subject: v.optional(v.string()),
  },
  handler: async (ctx, { email, name, summary, subject }): Promise<string> => {
    const to = String(email ?? "").trim();
    if (!isEmail(to)) return `That email address doesn't look right — can you say it again?`;

    const text = String(summary ?? "").trim();
    if (!text) return "I need something to put in the email first.";
    if (text.length > 4000) return "That's too long to send — shorten it.";

    const rate: { allowed: boolean } = await ctx.runMutation(internal.followUp._checkRate, { email: to });
    if (!rate.allowed) return `I've already sent a couple to ${to} — check the inbox, including spam.`;

    const replyKey = makeReplyKey();
    const subj = String(subject ?? "").trim() || "Following up on your call with Db Cinema Rentals";

    await ctx.runAction(internal.notify.followUpEmail, {
      to,
      name: name ?? "",
      subject: subj,
      summary: text,
      replyKey,
    });

    await ctx.runMutation(internal.followUp._record, {
      email: to,
      name,
      subject: subj,
      body: text,
      replyKey,
      direction: "out",
    });

    return `Sent it to ${to} — they can reply straight to that email and it comes back to us.`;
  },
});

/**
 * Inbound customer reply, matched back to its thread.
 *
 * Public because the mail webhook reaches it over HTTP, so it carries its own
 * secret check rather than trusting the Next route in front of it — otherwise
 * anyone who knows the deployment URL could inject messages into a customer's
 * chat thread.
 */
export const inbound = mutation({
  args: {
    secret: v.string(),
    replyKey: v.string(),
    email: v.string(),
    body: v.string(),
    subject: v.optional(v.string()),
  },
  handler: async (ctx, { secret, replyKey, email, body, subject }) => {
    const expected = process.env.INBOUND_EMAIL_SECRET;
    if (!expected || secret !== expected) throw new Error("unauthorized");
    const original = await ctx.db
      .query("gaffer_follow_ups")
      .withIndex("by_replyKey", (q) => q.eq("replyKey", replyKey))
      .first();

    await ctx.db.insert("gaffer_follow_ups", {
      at: Date.now(),
      email,
      name: original?.name,
      subject: subject ?? `Re: ${original?.subject ?? "your call"}`,
      body,
      replyKey,
      direction: "in",
      handled: false,
      accountId: original?.accountId,
    });

    // If they have an account, the reply belongs in the chat Gaffer already
    // answers — same conversation, not a second one in a different channel.
    const account = await ctx.db
      .query("accounts")
      .withIndex("by_email", (q: any) => q.eq("email", email.toLowerCase()))
      .first();

    if (account) {
      await ctx.db.insert("messages", {
        accountId: account._id,
        sender: "renter",
        text: body,
        at: Date.now(),
        readByOwner: false,
      });
      await ctx.scheduler.runAfter(0, internal.gaffer.gafferReply, { accountId: account._id });
      return { routed: "chat" as const };
    }

    await ctx.scheduler.runAfter(0, internal.notify.followUpReplyAlert, { email, body });
    return { routed: "owner" as const };
  },
});

/** Admin: the follow-up log, newest first. */
export const adminList = query({
  args: { token: v.string(), limit: v.optional(v.number()) },
  handler: async (ctx, { token, limit }) => {
    const { checkAdminToken } = await import("./adminAuth");
    if (!checkAdminToken(token)) return { authorized: false as const, items: [] };
    const items = await ctx.db.query("gaffer_follow_ups").withIndex("by_at").order("desc").take(limit ?? 100);
    return { authorized: true as const, items };
  },
});

/** Link a follow-up thread to an account once the caller signs up. */
export const claimForAccount = mutation({
  args: { token: v.string(), email: v.string() },
  handler: async (ctx, { token, email }) => {
    const session = await ctx.db
      .query("sessions")
      .withIndex("by_token", (q: any) => q.eq("token", token))
      .first();
    if (!session) return { ok: false };
    const rows = await ctx.db
      .query("gaffer_follow_ups")
      .withIndex("by_email", (q) => q.eq("email", email.toLowerCase()))
      .collect();
    for (const r of rows) if (!r.accountId) await ctx.db.patch(r._id, { accountId: session.accountId });
    return { ok: true, linked: rows.length };
  },
});
