"use node";
import { REVIEW_PRIZE_GBP } from "../shared/reviewPrize";
import Stripe from "stripe";
import { internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import { unsubscribeToken } from "./referralMail";
import { reviewPrizeRound,prizeDate,REVIEW_SOCIAL } from "../shared/reviewPrize";
import { sendMail } from "./lib/mailer";
import { reviewFingerprint, reviewGate, reviewSettlementFingerprint } from "./lib/reviewEligibility";

/** Provider reads only: creating a refund does not mean it succeeded. */
export async function providerReviewGate(b: any, stripe: Stripe): Promise<string | null> {
  if (b.depositAmount > 0) {
    const sources=b.paymentSources??(b.stripePaymentIntentId?[{paymentIntentId:b.stripePaymentIntentId,securityPence:Math.round(b.depositAmount*100)}]:[]);
    if(!sources.length||sources.reduce((sum:number,p:any)=>sum+p.securityPence,0)!==Math.round(b.depositAmount*100))return "refund_unverified";
    for(const source of sources){if(!source.securityPence)continue;let refunded=0;
      for await(const r of stripe.refunds.list({payment_intent:source.paymentIntentId,limit:100})){if(r.status!=="succeeded")return "refund_pending_or_failed";if(r.currency==="gbp" && !(b.rentalRefundIds??[]).includes(r.id))refunded+=r.amount;}
      if(refunded<source.securityPence)return "refund_pending_or_failed";
    }
  }
  for(const id of b.unappliedSecurityPayments??[]){
    const payment=await stripe.paymentIntents.retrieve(id);
    let refunded=0;
    for await(const r of stripe.refunds.list({payment_intent:id,limit:100})){if(r.status!=="succeeded")return "addition_refund_pending_or_failed";refunded+=r.amount;}
    if(payment.amount_received>refunded)return "addition_refund_pending_or_failed";
  }
  const holds = [...new Set([b.stripeDepositIntentId, b.depositHoldRenewalIntentId,
    ...(b.depositHoldPreviousIntentIds ?? [])].filter(Boolean))] as string[];
  if ((b.depositHoldAmount ?? 0) > 0 && !holds.length) return "hold_release_unverified";
  for (const id of holds) {
    const hold = await stripe.paymentIntents.retrieve(id);
    if (hold.amount_received > 0) return "deposit_retained";
    if (hold.status !== "canceled") return "hold_release_pending";
  }
  return null;
}
const esc = (s: string) => s.replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[c]!);
export const processDue = internalAction({
  args: { dryRun: v.optional(v.boolean()) },
  handler: async (ctx, { dryRun }): Promise<{checked: number; sent: number; reasons: Record<string, number>}> => {
    const rows: any[] = await ctx.runQuery(internal.reviewFollowUpState.candidates, {});
    const result = {checked: rows.length, sent: 0, reasons: {} as Record<string, number>};
    for (const b of rows) {
      let reason = reviewGate(b);
      if (!reason) {
        try {
          reason = process.env.STRIPE_SECRET_KEY
            ? await providerReviewGate(b, new Stripe(process.env.STRIPE_SECRET_KEY))
            : "provider_unconfigured";
        } catch { reason = "provider_unavailable"; }
      }
      result.reasons[reason ?? "fully_settled"] = (result.reasons[reason ?? "fully_settled"] ?? 0) + 1;
      if (dryRun) continue;
      await ctx.runMutation(internal.reviewInvitations.recordEligibility, {
        bookingId: b._id, fingerprint: reviewSettlementFingerprint(b), eligible: !reason,
      });
      const claimed = await ctx.runMutation(internal.reviewFollowUpState.recordCheck, {
        bookingId: b._id, fingerprint: reviewFingerprint(b), reason: reason ?? undefined,
        claim: true,
      });
      if (!claimed) continue;
      // Account review messages no longer bypass the settlement gate: review follow-ups use email only.
      const app=new URL(process.env.APP_URL??"https://dbcinemarentals.com").origin;
      const round=reviewPrizeRound();
      let promotion="";
      if(b.prizeOffersAllowed){try{const optout=unsubscribeToken(b.guestEmail);promotion=`<h2>Your set story could win £${REVIEW_PRIZE_GBP}.</h2><p>Leave an honest website review and tell us about your shoot. Follow @${REVIEW_SOCIAL.handle}, share a public set-experience post, tag us and clearly disclose #ad / prize entry. Submit your evidence by ${prizeDate(round.deadline)}, 23:59 UK time.</p><p>One £${REVIEW_PRIZE_GBP} cash prize twice a year, judged for originality (50%), craft insight (30%) and clarity (20%) by an independent judge. Star rating and praise do not affect the result. UK residents aged 18+. One entry per rental; security must be fully refunded and every hold released with no deductions. Winner announced within 14 days, payment by ${prizeDate(round.payBy)}.</p><p><a href="${app}/rental-stories">Enter and track your steps</a> · <a href="${app}/legal/review-prize">Competition terms</a></p><p>You opted into offers. <a href="${app}/referrals/unsubscribe#${optout}">Unsubscribe from offers</a>.</p>`;}catch{/* Without a working unsubscribe link send the ordinary review request only. */}}
      const sent = await sendMail({to:b.guestEmail,subject:promotion?`Your rental story could win £${REVIEW_PRIZE_GBP} · DB Cinema`:"How was your DB Cinema rental?",
        html:`<p>Thanks for renting with us. Your refundable security is fully settled. We welcome your honest review, whatever your experience.</p><p><a href="${app}/account#chat">Leave your website review</a></p>${promotion}<p>${esc(b.lineItems.map((li:any)=>li.title).join(", "))}</p>`});
      await ctx.runMutation(internal.reviewFollowUpState.recordSent, {bookingId: b._id, sent});
      if (sent) result.sent++;
    }
    return result;
  },
});
