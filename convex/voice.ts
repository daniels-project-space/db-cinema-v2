import { mutation } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";

/**
 * A lead captured by the Gaffer voice agent (phone or web call): a booking,
 * an inquiry, a gear issue, or a callback. Stored in the contact inbox AND
 * emailed to the owner + pinged on Telegram so nothing from a call is missed.
 */
export const lead = mutation({
  args: {
    kind: v.string(), // booking | inquiry | issue | callback
    name: v.string(),
    phone: v.optional(v.string()),
    email: v.optional(v.string()),
    message: v.string(),
  },
  handler: async (ctx, a) => {
    const body = `[VOICE · ${a.kind}] ${a.name}${a.phone ? ` · ${a.phone}` : ""}${a.email ? ` · ${a.email}` : ""}\n${a.message}`;
    await ctx.db.insert("contact_messages", {
      name: a.name,
      email: a.email || "voice@dbcinemarentals.com",
      message: body,
      routedTo: `voice-${a.kind}`,
      handled: false,
    });
    await ctx.scheduler.runAfter(0, internal.notify.ownerLead, {
      kind: a.kind, name: a.name, phone: a.phone, email: a.email, message: a.message,
    });
    return { ok: true };
  },
});
