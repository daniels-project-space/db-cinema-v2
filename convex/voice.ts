import { mutation } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import { bump } from "./rateLimit";

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
    const kind=a.kind.trim(),name=a.name.trim(),message=a.message.trim(),phone=a.phone?.trim(),email=a.email?.trim();
    if(!kind || kind.length>20 || !name || name.length>120 || !message || message.length>4000 || (phone?.length??0)>40 || (email?.length??0)>200)throw Error("Voice lead details are invalid.");
    if(!(await bump(ctx,"voice-lead:global",20,60000)).allowed)throw Error("The team is receiving many requests. Please try again shortly.");
    const body = `[VOICE · ${kind}] ${name}${phone ? ` · ${phone}` : ""}${email ? ` · ${email}` : ""}\n${message}`;
    await ctx.db.insert("contact_messages", {
      name,
      // Keep this empty when the caller did not provide an address. A fake
      // internal address looks replyable in Admin and can misroute a response.
      email: email || "",
      message: body,
      routedTo: `voice-${kind}`,
      handled: false,
    });
    await ctx.scheduler.runAfter(0, internal.notify.ownerLead, {
      kind, name, phone:phone||undefined, email:email||undefined, message,
    });
    return { ok: true };
  },
});
