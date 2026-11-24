"use node";

import { v } from "convex/values";
import { internalAction } from "./_generated/server";
import { deliveryMessageId, sendMail, supportEmailFrom } from "./lib/mailer";

/** Keep Node-only Gmail OAuth and crypto dependencies behind a dedicated Node action. */
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
    providerThreadId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const sent = await sendMail(ctx, {
      deliveryKey: args.deliveryKey,
      from: supportEmailFrom(),
      to: args.to,
      cc: args.cc,
      subject: args.subject,
      html: args.html,
      replyTo: args.replyTo,
      inReplyTo: args.inReplyTo,
      references: args.references,
      providerThreadId: args.providerThreadId,
    });
    const messageId = sent ? deliveryMessageId(args.deliveryKey) : undefined;
    return { sent, ...(messageId?{messageId}:{}) };
  },
});
