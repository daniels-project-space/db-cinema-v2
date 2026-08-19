import { mutation, query } from "./_generated/server";
import { internal } from "./_generated/api";
import { bump } from "./rateLimit";
import { v } from "convex/values";
import { assertAdmin, checkAdminToken } from "./adminAuth";

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
    const id = await ctx.db.insert("contact_messages", { name, email, message, handled: false });
    await ctx.scheduler.runAfter(0, internal.notify.contactAlert, { name, email, message });
    return { id };
  },
});

export const adminList = query({
  args: { token: v.string() },
  handler: async (ctx, { token }) => {
    if (!checkAdminToken(token)) {
      return { authorized: false as const, items: [] };
    }
    const rows = await ctx.db.query("contact_messages").order("desc").take(100);
    const items = rows.map((r) => ({
      _id: r._id,
      name: r.name,
      email: r.email,
      message: r.message,
      handled: r.handled,
      at: r._creationTime,
    }));
    return { authorized: true as const, items };
  },
});

export const adminMarkHandled = mutation({
  args: { token: v.string(), id: v.id("contact_messages") },
  handler: async (ctx, { token, id }) => {
    await assertAdmin(ctx, token, "contact.adminMarkHandled");
    await ctx.db.patch(id, { handled: true });
  },
});
