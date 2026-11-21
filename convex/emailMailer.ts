"use node";

import { v } from "convex/values";
import { createHash } from "node:crypto";
import { internalAction } from "./_generated/server";
import { deliveryMessageId, sendMail, supportEmailFrom } from "./lib/mailer";

/** Keep Node-only SMTP and crypto dependencies behind a dedicated Node action. */
export const sendBusinessReply = internalAction({
  args: {
    deliveryKey: v.string(),
    agentMailMessageId: v.optional(v.string()),
    to: v.string(),
    subject: v.string(),
    html: v.string(),
    replyTo: v.union(v.string(),v.array(v.string())),
    cc: v.optional(v.array(v.string())),
    inReplyTo: v.optional(v.string()),
    references: v.array(v.string()),
  },
  handler: async (_ctx, args) => {
    if (args.agentMailMessageId) {
      const key = process.env.AGENTMAIL_API_KEY, inbox = process.env.AGENTMAIL_INBOX_ADDRESS;
      if (!key || !inbox) return { sent: false };
      try {
        const result = await fetch(`https://api.agentmail.to/v0/inboxes/${encodeURIComponent(inbox)}/messages/${encodeURIComponent(args.agentMailMessageId)}/reply`, {
          method: "POST", headers: { authorization: `Bearer ${key}`, "content-type": "application/json", "idempotency-key": createHash("sha256").update(args.deliveryKey).digest("hex") },
          body: JSON.stringify({ to: args.to, ...(args.cc?.length ? { cc: args.cc } : {}), html: args.html, reply_to: inbox }), signal: AbortSignal.timeout(15_000),
        });
        if (!result.ok) return { sent: false };
        const value = await result.json() as { message_id?: unknown };
        const messageId = typeof value.message_id === "string" && value.message_id.length <= 512 && !/[\r\n]/.test(value.message_id) ? value.message_id : undefined;
        return { sent: true, ...(messageId ? { messageId } : {}) };
      } catch { return { sent: false }; }
    }
    let providerId:string|undefined,transport:"gmail"|"resend"|undefined;
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
    },id=>{providerId=id},provider=>{transport=provider});
    let messageId:string|undefined=transport==="gmail"?deliveryMessageId(args.deliveryKey):undefined;
    if(sent&&transport==="resend"&&providerId&&process.env.RESEND_API_KEY)try{
      const response=await fetch(`https://api.resend.com/emails/${encodeURIComponent(providerId)}`,{headers:{authorization:`Bearer ${process.env.RESEND_API_KEY}`},signal:AbortSignal.timeout(15_000)});
      if(response.ok){const value=await response.json() as {message_id?:unknown};if(typeof value.message_id==="string"&&value.message_id.length<=512&&!/[\r\n]/.test(value.message_id))messageId=value.message_id;}
    }catch{/* Sending succeeded; a missing Message-ID falls back to sender and subject matching. */}
    return { sent, ...(messageId?{messageId}:{}) };
  },
});
