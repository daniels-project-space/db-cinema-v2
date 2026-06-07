"use node";

import Stripe from "stripe";
import { action } from "./_generated/server";
import { internal, api } from "./_generated/api";
import { v } from "convex/values";
import { depositFor } from "./lib/pricing";

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
        offerType: v.optional(v.string()),
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
    promoCode: v.optional(v.string()),
    protection: v.optional(v.union(v.literal("verify"), v.literal("deposit"))),
    pickupTime: v.optional(v.string()),
    returnTime: v.optional(v.string()),
    agreement: v.optional(
      v.object({
        name: v.string(),
        documents: v.array(v.object({ kind: v.string(), version: v.string() })),
      }),
    ),
    origin: v.string(),
  },
  handler: async (ctx, a): Promise<{ url: string }> => {
    if (a.items.length === 0) throw new Error("empty cart");
    const cfg: any = await ctx.runQuery(api.settings.get, {});
    if (!cfg.acceptingOrders)
      throw new Error("We're not accepting new bookings right now — please check back soon.");
    if (!a.agreement || !a.agreement.name.trim())
      throw new Error("Please sign the rental agreement to continue.");

    // server-side availability re-check (quantity-aware, grouped by listing)
    const demand = new Map<string, { count: number; start: number; end: number; title: string }>();
    for (const it of a.items) {
      const g = demand.get(it.listingId);
      if (g) {
        g.count += 1;
        g.start = Math.min(g.start, it.start);
        g.end = Math.max(g.end, it.end);
      } else {
        demand.set(it.listingId, { count: 1, start: it.start, end: it.end, title: it.title });
      }
    }
    for (const [lid, g] of demand) {
      const av: any = await ctx.runQuery(api.availability.forListing, {
        listingId: lid as any,
        start: g.start,
        end: g.end,
      });
      if (!av || av.available < g.count) {
        throw new Error(`"${g.title}" isn't available in that quantity for those dates`);
      }
    }

    const subtotal = a.items.reduce((n, i) => n + i.total, 0);
    const protection = a.protection ?? "verify";
    const replacementSum = a.items.reduce((n, i) => n + i.deposit, 0);
    const depositAmount = depositFor(protection, replacementSum);
    const idVerifyStatus = protection === "verify" ? "required" : "not_required";

    // promo discount applies ONLY to non-offer rental lines (non-stackable)
    let discount = 0;
    let appliedCode: string | undefined;
    if (a.promoCode) {
      const eligible = a.items
        .filter((i) => !i.offerType)
        .reduce((n, i) => n + i.total, 0);
      const res: any = await ctx.runQuery(api.promo.validate, {
        code: a.promoCode,
        eligibleSubtotal: eligible,
      });
      if (res?.valid) {
        discount = res.discount;
        appliedCode = res.code;
      }
    }

    const total = subtotal + a.deliveryFee + depositAmount - discount;

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
      promoCode: appliedCode,
      discount,
      total,
      currency: "GBP",
      agreementName: a.agreement?.name,
      agreementDocs: a.agreement?.documents,
      protection,
      idVerifyStatus,
      pickupTime: a.pickupTime,
      returnTime: a.returnTime,
    });

    // soft-hold the units for 20 min so nobody else grabs them mid-checkout
    await ctx.runMutation(internal.bookings.placeHolds, {
      bookingId,
      ttlMs: 20 * 60 * 1000,
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
            name:
              protection === "deposit"
                ? "Refundable security deposit (released on safe return)"
                : "Refundable damage hold (covers minor damage, refunded on return)",
          },
        },
      });
    }

    const sb = stripe();
    let discounts: Stripe.Checkout.SessionCreateParams.Discount[] | undefined;
    if (discount > 0 && appliedCode) {
      const coupon = await sb.coupons.create({
        amount_off: pence(discount),
        currency: "gbp",
        name: appliedCode.toUpperCase(),
        duration: "once",
      });
      discounts = [{ coupon: coupon.id }];
    }

    const session = await sb.checkout.sessions.create({
      mode: "payment",
      line_items,
      discounts,
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

export const refundDeposit = action({
  args: { token: v.string(), bookingId: v.id("bookings") },
  handler: async (ctx, { token, bookingId }): Promise<{ refunded: boolean }> => {
    if (!process.env.ADMIN_TOKEN || token !== process.env.ADMIN_TOKEN) {
      throw new Error("unauthorized");
    }
    const b: any = await ctx.runQuery(internal.bookings.getForRefund, {
      bookingId,
    });
    if (!b || !b.paymentIntentId || b.depositRefunded || b.depositAmount <= 0) {
      return { refunded: false };
    }
    await stripe().refunds.create({
      payment_intent: b.paymentIntentId,
      amount: pence(b.depositAmount),
    });
    await ctx.runMutation(internal.bookings.markDepositRefunded, { bookingId });
    return { refunded: true };
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
