"use node";
import Stripe from "stripe";
import { internalAction } from "./_generated/server";
import { api, internal } from "./_generated/api";
import { v } from "convex/values";
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
    const cfg: any = await ctx.runQuery(api.settings.get, {});
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
        claim: !!cfg.googleReviewUrl,
      });
      if (!claimed) continue;
      // Account review messages no longer bypass the settlement gate: review follow-ups use email only.
      const sent = await sendMail({to: b.guestEmail, subject: "How was your Db Cinema rental? ⭐",
        html: `<p>Thanks for renting with us! A quick Google review really helps us out:</p><p><a href="${esc(cfg.googleReviewUrl)}">Leave a review →</a></p><p>${esc(b.lineItems.map((li: any) => li.title).join(", "))}</p>`});
      await ctx.runMutation(internal.reviewFollowUpState.recordSent, {bookingId: b._id, sent});
      if (sent) result.sent++;
    }
    return result;
  },
});
