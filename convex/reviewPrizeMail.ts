"use node";
import { REVIEW_PRIZE_GBP } from "../shared/reviewPrize";
import { internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { sendMail, OWNER_EMAIL } from "./lib/mailer";
import { prizeDate } from "../shared/reviewPrize";
const esc = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
export const processDue = internalAction({
  args: {},
  handler: async (ctx): Promise<{ sent: number }> => {
    const ids: any[] = await ctx.runQuery(
      internal.reviewPrize.mailCandidates,
      {},
    );
    let sent = 0;
    for (const id of ids) {
      const c: any = await ctx.runMutation(internal.reviewPrize.claimMail, {
        id,
      });
      if (!c) continue;
      let ok = false;
      try {
        const app = new URL(
          process.env.APP_URL ?? "https://dbcinemarentals.com",
        ).origin;
        const winner = c.stage === "winner_notice";
        ok = await sendMail({
          to: winner ? c.email : OWNER_EMAIL(),
          subject: winner
            ? `Your set story won £${REVIEW_PRIZE_GBP} · DB Cinema`
            : `DB Cinema story prize · ${c.stage.replaceAll("_", " ")}`,
          html: winner
            ? `<h2>Your story won the £${REVIEW_PRIZE_GBP} set-story prize.</h2><p>The independent judge selected your entry for round ${esc(c.key)}. We will contact you securely to arrange the £${REVIEW_PRIZE_GBP} cash payment by ${prizeDate(c.payBy)}. We never ask winners to pay a fee or send card details.</p><p><a href="${app}/rental-stories">View your entry status</a></p>`
            : `<h2>£${REVIEW_PRIZE_GBP} story prize · ${esc(c.key)}</h2><p>Round deadline: ${prizeDate(c.deadline)}. Payment due by ${prizeDate(c.payBy)}. Current task: ${esc(c.stage.replaceAll("_", " "))}. Judge all verified entries, select the top-scoring story and record the actual transfer reference after payment.</p><p><a href="${app}/admin">Open the Story Prize admin tab</a></p>`,
        });
      } catch {}
      await ctx.runMutation(internal.reviewPrize.finishMail, {
        id: c.id,
        lease: c.lease,
        stage: c.stage,
        sent: ok,
      });
      if (ok) sent++;
    }
    return { sent };
  },
});
