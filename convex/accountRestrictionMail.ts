"use node";

import { internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import { sendBusinessMail } from "./lib/mailer";

function escapeHtml(value: string) {
  const escaped: Record<string, string> = {
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  };
  return value.replace(/[&<>"']/g, character => escaped[character]);
}

export const deliver = internalAction({ args: { noticeId: v.id("account_restriction_notices") }, handler: async (ctx, { noticeId }) => {
  const notice = await ctx.runMutation(internal.accountRestrictionNotice.claim, { noticeId });
  if (!notice) return;
  const reason = notice.reason.trim();
  const safeReason = reason ? escapeHtml(reason).replace(/\r\n?|\n/g, "<br>") : "No reason was included in this notice. Please reply if you would like the team to review the decision.";
  const plainReason = reason || "No reason was included in this notice. Please reply if you would like the team to review the decision.";
  let sent = false;
  try {
    sent = await sendBusinessMail({ to: notice.recipient, subject: "An update about your DB Cinema account",
      html: `<p>Hello,</p><p>Access to your DB Cinema account has been restricted.</p><p><strong>Reason provided to our team:</strong></p><blockquote>${safeReason}</blockquote><p>Please contact our team by replying to this email if you have questions or would like us to review the decision. We can help with any existing rental arrangements separately.</p><p>DB Cinema Rentals</p>`,
      text: `Hello,\n\nAccess to your DB Cinema account has been restricted.\n\nReason provided to our team:\n${plainReason}\n\nPlease contact our team by replying to this email if you have questions or would like us to review the decision. We can help with any existing rental arrangements separately.\n\nDB Cinema Rentals`,
    });
  } catch { sent = false; }
  await ctx.runMutation(internal.accountRestrictionNotice.finish, { noticeId, result: sent ? "sent" : "uncertain" });
} });
