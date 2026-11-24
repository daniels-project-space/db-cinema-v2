"use node";
import { internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { sendMail } from "./lib/mailer";
import {rentalEmail} from "../shared/rentalEmail";
import { CHECKOUT_RECOVERY_CODE } from "../shared/checkoutRecovery";
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
      const firstReminder=claim.stage === "day_one";
      let ok = false;
      try {
        ok = await sendMail({
          deliveryKey:`dbc-checkout-recovery-${claim.id}-${claim.stage}-${claim.emailFollowupConsentAt}-${claim.updatedAt}`,
          to: claim.email,
          subject: firstReminder ? "Your DB Cinema kit is still saved" : "Still planning your rental kit?",
          html: rentalEmail({
            title:firstReminder ? "Your kit is still saved" : "Still planning your shoot?",
            preview:firstReminder ? "Your saved kit is ready when you are." : "Review your saved kit and current availability.",
            url:`${app}/plan?recovery=${encodeURIComponent(claim.id)}`,
            button:"Review my kit",
            body:firstReminder
              ? "<p>Your saved kit is ready when you are. Check current prices and availability before you book; equipment is not reserved.</p><p>Sign in with the account you used to build the kit. You can turn off future reminders from this saved-kit page or in your kit drawer.</p>"
              : `<p>Your kit is still saved. If your plans have changed, you can update or clear it. Prices and availability are checked again before booking; equipment is not reserved.</p><p>Use code <strong>${CHECKOUT_RECOVERY_CODE.toUpperCase()}</strong> for 10% off eligible rental charges. It can be used once per email address.</p><p>This is the last reminder for this basket. You can turn off future reminders from this saved-kit page or in your kit drawer.</p>`,
          }),
        });
      } catch {}
      await ctx.runMutation(internal.checkoutRecovery._finish, {
        id: claim.id,
        leaseUntil: claim.leaseUntil,
        sent: ok,
        stage:claim.stage,
        updatedAt:claim.updatedAt,
        emailFollowupConsentAt:claim.emailFollowupConsentAt,
      });
      if (ok) sent++;
    }
    return { sent };
  },
});
