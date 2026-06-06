"use node";

import Stripe from "stripe";
import { action } from "./_generated/server";
import { internal, api } from "./_generated/api";
import { v } from "convex/values";

const pence = (gbp: number) => Math.round(gbp * 100);

function stripe() {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error("STRIPE_SECRET_KEY not set on the Convex deployment");
  return new Stripe(key);
}

export const start = action({
  args: {
    items: v.array(
      v.object({
        listingId: v.id("listings"),
        title: v.string(),
        start: v.number(),
        end: v.number(),
        qty: v.number(),
        total: v.number(),
        deposit: v.number(),
      }),
    ),
    customer: v.object({
      email: v.string(),
      name: v.optional(v.string()),
      phone: v.optional(v.string()),
    }),
    fulfilment: v.union(v.literal("pickup"), v.literal("delivery")),
    address: v.optional(v.string()),
    deliveryFee: v.number(),
    origin: v.string(),
  },
  handler: async (ctx, a): Promise<{ url: string }> => {
    if (a.items.length === 0) throw new Error("empty cart");

    // server-side availability re-check
    for (const it of a.items) {
      const av: any = await ctx.runQuery(api.availability.check, {
        listingId: it.listingId,
        start: it.start,
        end: it.end,
      });
      if (!av?.available) {
        throw new Error(`"${it.title}" is no longer available for those dates`);
      }
    }

    const subtotal = a.items.reduce((n, i) => n + i.total, 0);
    const depositAmount = a.items.reduce((n, i) => n + i.deposit, 0);
    const total = subtotal + a.deliveryFee + depositAmount;

    const bookingId = await ctx.runMutation(internal.bookings.createPending, {
      customerEmail: a.customer.email,
      customerName: a.customer.name,
      phone: a.customer.phone,
      fulfilment: a.fulfilment,
      address: a.address,
      deliveryFee: a.deliveryFee,
      lineItems: a.items.map((i) => ({
        listingId: i.listingId,
        title: i.title,
        start: i.start,
        end: i.end,
        qty: i.qty,
        lineTotal: i.total,
      })),
      subtotal,
      depositAmount,
      total,
      currency: "GBP",
    });

    const line_items: Stripe.Checkout.SessionCreateParams.LineItem[] = a.items.map(
      (i) => ({
        quantity: 1,
        price_data: {
          currency: "gbp",
          unit_amount: pence(i.total),
          product_data: { name: i.title.slice(0, 120) },
        },
      }),
    );
    if (a.deliveryFee > 0) {
      line_items.push({
        quantity: 1,
        price_data: {
          currency: "gbp",
          unit_amount: pence(a.deliveryFee),
          product_data: { name: "Local delivery" },
        },
      });
    }
    if (depositAmount > 0) {
      line_items.push({
        quantity: 1,
        price_data: {
          currency: "gbp",
          unit_amount: pence(depositAmount),
          product_data: {
            name: "Refundable damage deposit (released on safe return)",
          },
        },
      });
    }

    const session = await stripe().checkout.sessions.create({
      mode: "payment",
      line_items,
      customer_email: a.customer.email,
      success_url: `${a.origin}/checkout/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${a.origin}/cart`,
      metadata: { bookingId },
      payment_intent_data: { metadata: { bookingId } },
    });

    if (!session.url) throw new Error("Stripe did not return a checkout URL");
    return { url: session.url };
  },
});

export const finalize = action({
  args: { sessionId: v.string() },
  handler: async (
    ctx,
    { sessionId },
  ): Promise<{ bookingId: string | null; paid: boolean }> => {
    const session = await stripe().checkout.sessions.retrieve(sessionId);
    const bookingId = (session.metadata?.bookingId as string) ?? null;
    const paid = session.payment_status === "paid";
    if (paid && bookingId) {
      await ctx.runMutation(internal.bookings.confirm, {
        bookingId: bookingId as any,
        paymentIntentId:
          typeof session.payment_intent === "string"
            ? session.payment_intent
            : undefined,
      });
    }
    return { bookingId, paid };
  },
});
