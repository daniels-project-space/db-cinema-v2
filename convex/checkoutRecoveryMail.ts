"use node";
import { internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { sendMail } from "./lib/mailer";
export const processDue = internalAction({
  args: {},
  handler: async (ctx): Promise<{ sent: number }> => {
    const due: any[] = await ctx.runQuery(internal.checkoutRecovery._due, {});
    let sent = 0;
    for (const row of due) {
      const claim: any = await ctx.runMutation(
        internal.checkoutRecovery._claim,
        { id: row._id },
      );
      if (!claim) continue;
      const app = process.env.APP_URL ?? "https://dbcinemarentals.com";
      let ok = false;
      try {
        ok = await sendMail({
          to: claim.email,
          subject: "Your cinema kit is ready to revisit",
          html: `<h2>Pick up where you left off</h2><p>You asked us to remind you about your unfinished checkout. Review your kit and check current prices and availability before booking. Equipment is not reserved.</p><p><a href="${app}/plan?recovery=${encodeURIComponent(claim.id)}">Review your kit</a></p><p>Sign in to the account you used. To stop reminders, use the checkbox in your <a href="${app}/cart">basket</a> or your <a href="${app}/account#plans">shoot lists</a>.</p>`,
        });
      } catch {}
      await ctx.runMutation(internal.checkoutRecovery._finish, {
        id: claim.id,
        leaseUntil: claim.leaseUntil,
        sent: ok,
      });
      if (ok) sent++;
    }
    return { sent };
  },
});
