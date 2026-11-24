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
    replyTo: v.string(),
    cc: v.optional(v.array(v.string())),
    inReplyTo: v.optional(v.string()),
    references: v.array(v.string()),
  },
  handler: async (_ctx, args) => {
    return sendBusinessMailTracked({
      deliveryKey: args.deliveryKey,
      to: args.to,
      cc: args.cc,
      subject: args.subject,
      html: args.html,
      replyTo: args.replyTo,
      inReplyTo: args.inReplyTo,
      references: args.references,
    });
  },
});
