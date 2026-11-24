"use node";

import { v } from "convex/values";
import { internalAction } from "./_generated/server";
import { sendBusinessMailTracked } from "./lib/mailer";

/** Keep the provider client behind a Node action and return only provider receipts. */
export const sendBusinessReply = internalAction({
  args: {
    deliveryKey: v.string(),
    to: v.string(),
    subject: v.string(),
    html: v.string(),
    replyTo: v.union(v.string(),v.array(v.string())),
    cc: v.optional(v.array(v.string())),
    inReplyTo: v.optional(v.string()),
    references: v.array(v.string()),
  },
  handler: async (_ctx, args) => {
    const result = await sendBusinessMailTracked({
      deliveryKey: args.deliveryKey,
      to: args.to,
      cc: args.cc,
      subject: args.subject,
      html: args.html,
      replyTo: args.replyTo,
      inReplyTo: args.inReplyTo,
      references: args.references,
    });
    if (!result.sent || result.messageId || !result.resendEmailId || !/^[a-zA-Z0-9_-]{1,128}$/.test(result.resendEmailId) || !process.env.RESEND_API_KEY) return result;
    try {
      const response = await fetch(`https://api.resend.com/emails/${encodeURIComponent(result.resendEmailId)}`, { headers: { authorization: `Bearer ${process.env.RESEND_API_KEY}` }, signal: AbortSignal.timeout(15_000) });
      if (response.ok) {
        const value = await response.json() as { message_id?: unknown };
        if (typeof value.message_id === "string" && /^<[^<>\r\n\s]{1,510}>$/.test(value.message_id)) return { ...result, messageId: value.message_id };
      }
    } catch {}
    return result;
  },
});
