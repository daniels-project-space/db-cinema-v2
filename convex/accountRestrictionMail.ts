"use node";

import { internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import { sendBusinessMail } from "./lib/mailer";

export const deliver = internalAction({ args: { noticeId: v.id("account_restriction_notices") }, handler: async (ctx, { noticeId }) => {
  const notice = await ctx.runMutation(internal.accountRestrictionNotice.claim, { noticeId });
  if (!notice) return;
  let sent = false;
  try {
    sent = await sendBusinessMail({ to: notice.recipient, subject: "An update about your DB Cinema account",
      html: "<p>Hello,</p><p>Access to your DB Cinema account has been restricted. Please contact our team by replying to this email if you have questions or would like us to review the decision.</p><p>We can help with any existing rental arrangements separately.</p><p>DB Cinema Rentals</p>" });
  } catch { sent = false; }
  await ctx.runMutation(internal.accountRestrictionNotice.finish, { noticeId, result: sent ? "sent" : "uncertain" });
} });
