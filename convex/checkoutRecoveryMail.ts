"use node";
import { internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { sendMail } from "./lib/mailer";
import {rentalEmail} from "../shared/rentalEmail";
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
      if(!await ctx.runQuery(internal.checkoutRecovery._ready,claim))continue;
      const app = process.env.APP_URL ?? "https://dbcinemarentals.com";
      let ok = false;
      try {
        ok = await sendMail({
          to: claim.email,
          subject: "Your DB Cinema basket is saved",
          html: rentalEmail({title:"Pick up where you left off",preview:"Your unfinished rental basket is saved in your account.",url:`${app}/plan?recovery=${encodeURIComponent(claim.id)}`,button:"Review my kit",body:"<p>Your unfinished rental basket is saved in your account. Review your kit, current prices and availability before booking. Equipment is not reserved; alternatives are shown where needed.</p><p>Sign in with the account you used to build this kit. Completing checkout or clearing your basket stops this follow-up.</p>"}),
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
