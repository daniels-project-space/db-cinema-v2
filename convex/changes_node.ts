"use node";

import Stripe from "stripe";
import { internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";

const pence = (gbp: number) => Math.round(gbp * 100);
function stripe() {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error("STRIPE_SECRET_KEY not set");
  return new Stripe(key);
}

/** On extend approval: re-check availability + price, then create a Stripe checkout session for
 *  the extra-day delta and post the pay link into the rental chat. Free extends apply instantly. */
export const createExtendPayLink = internalAction({
  args: { requestId: v.id("booking_change_requests") },
  handler: async (ctx, { requestId }) => {
    const q: any = await ctx.runQuery(internal.changes._extendQuote, { requestId });
    if (!q.ok) {
      await ctx.runMutation(internal.changes._declineUnavailable, { requestId, item: q.item });
      return;
    }
    if (q.priceDelta <= 0) {
      await ctx.runMutation(internal.changes._applyExtendPaid, { requestId });
      return;
    }
    const app = process.env.APP_URL ?? "https://dbcinemarentals.com";
    const session = await stripe().checkout.sessions.create({
      mode: "payment",
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: "gbp",
            unit_amount: pence(q.priceDelta),
            product_data: { name: `Extra ${q.extra} day(s): ${q.summary}`.slice(0, 120) },
          },
        },
      ],
      success_url: `${app}/checkout/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${app}/account`,
      metadata: { changeRequestId: requestId },
      payment_intent_data: { metadata: { changeRequestId: requestId } },
    });
    if (!session.url) return;
    await ctx.runMutation(internal.changes._setAwaitingPayment, {
      requestId,
      url: session.url,
      sessionId: session.id,
      priceDelta: q.priceDelta,
    });
  },
});
