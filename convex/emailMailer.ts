"use node";

import { v } from "convex/values";
import { internalAction } from "./_generated/server";
import { deliveryMessageId, sendBusinessMail } from "./lib/mailer";

/** Keep Node-only SMTP and crypto dependencies behind a dedicated Node action. */
export const sendBusinessReply = internalAction({
  args: {
    deliveryKey: v.string(),
    to: v.string(),
    subject: v.string(),
    html: v.string(),
    replyTo: v.string(),
    inReplyTo: v.optional(v.string()),
    references: v.array(v.string()),
  },
  handler: async (_ctx, args) => {
    const messageId = deliveryMessageId(args.deliveryKey);
    const sent = await sendBusinessMail({
      deliveryKey: args.deliveryKey,
      to: args.to,
      subject: args.subject,
      html: args.html,
      replyTo: args.replyTo,
      inReplyTo: args.inReplyTo,
      references: args.references,
    });
    return { sent, messageId };
  },
});
