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
    replyTo: v.union(v.string(),v.array(v.string())),
    cc: v.optional(v.array(v.string())),
    inReplyTo: v.optional(v.string()),
    references: v.array(v.string()),
  },
  handler: async (_ctx, args) => {
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
