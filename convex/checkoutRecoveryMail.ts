"use node";
import { randomBytes } from "node:crypto";
import { action, internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import { sendMail } from "./lib/mailer";
import { rentalEmail } from "../shared/rentalEmail";

export const unsubscribe = action({
  args: { token: v.string() },
  handler: async (ctx, { token }): Promise<{ ok: boolean }> => {
    if (!/^[A-Za-z0-9_-]{43}$/.test(token)) return { ok: false };
    const ok = await ctx.runMutation(internal.checkoutRecovery.unsubscribe, { token });
    return { ok };
  },
});

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
      if (!await ctx.runQuery(internal.checkoutRecovery._ready, claim)) {
        await ctx.runMutation(internal.checkoutRecovery._finish, {
          id: claim.id, leaseUntil: claim.leaseUntil, sent: false, stop: true,
        });
        continue;
      }
      const app = process.env.APP_URL ?? "https://dbcinemarentals.com";
      const token: string | null = await ctx.runMutation(
        internal.checkoutRecovery.ensureUnsubscribeToken,
        {
          accountId: claim.accountId,
          email: claim.email,
          candidate: randomBytes(32).toString("base64url"),
        },
      );
      if (!token || !await ctx.runQuery(internal.checkoutRecovery._ready, claim)) {
        await ctx.runMutation(internal.checkoutRecovery._finish, {
          id: claim.id, leaseUntil: claim.leaseUntil, sent: false, stop: true,
        });
        continue;
      }
      const unsubscribeUrl = new URL("/email-preferences/basket", app);
      unsubscribeUrl.searchParams.set("token", token);
      const recoveryUrl = new URL("/plan", app);
      recoveryUrl.searchParams.set("recovery", claim.id);
      let ok = false;
      try {
        ok = await sendMail({
          to: claim.email,
          subject: "Your DB Cinema basket is saved",
          html: rentalEmail({
            title: "Pick up where you left off",
            preview: "Your unfinished rental basket is saved in your account.",
            url: recoveryUrl.toString(),
            button: "Review my kit",
            body: "<p>Your unfinished rental basket is saved in your account. Review your kit, current prices and availability before booking. Equipment is not reserved; alternatives are shown where needed.</p><p>Sign in with the account you used to build this kit. Completing checkout or clearing your basket stops this follow-up.</p><p><a href=\"" + unsubscribeUrl.toString() + "\">Turn off these basket reminders</a></p>",
          }),
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
