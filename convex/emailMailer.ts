"use node";

import { v } from "convex/values";
import { internalAction } from "./_generated/server";
import { deliveryMessageId, sendMail, supportEmailFrom } from "./lib/mailer";

/** Keep Node-only SMTP and crypto dependencies behind a dedicated Node action. */
export const sendBusinessReply = internalAction({
  args: {
    deliveryKey: v.string(),
    to: v.string(),
    subject: v.string(),
    html: v.string(),
    replyTo: v.string(),
    cc: v.optional(v.array(v.string())),
    inReplyTo: v.optional(v.string()),
    references: v.array(v.string()),
  },
  handler: async (_ctx, args) => {
    const messageId = deliveryMessageId(args.deliveryKey);
    const sent = await sendMail({
      deliveryKey: args.deliveryKey,
      from: supportEmailFrom(),
      to: args.to,
      cc: args.cc,
      subject: args.subject,
      html: args.html,
      replyTo: args.replyTo,
      inReplyTo: args.inReplyTo,
      references: args.references,
    });
    return { sent, messageId };
  },
});
