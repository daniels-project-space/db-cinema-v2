"use node";

import Stripe from "stripe";
import { action, internalAction } from "./_generated/server";
import { internal, api } from "./_generated/api";
import { v } from "convex/values";
import { depositFor } from "./lib/pricing";
import { tierByKey, FREE_ACCESSORY_TYPES } from "./lib/membership";

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

    // SERVER-AUTHORITATIVE pricing (anti-tamper): never trust client total/deposit — recompute
    // every line from the real listing (same quote() the storefront shows). A tampered cart
    // (e.g. total:1, deposit:0) is corrected to the true price; legit carts are unchanged.
    const repriced: any[] = await ctx.runQuery(internal.catalog.repriceLines, {
      items: a.items.map((i) => ({ listingId: i.listingId, start: i.start, end: i.end, offerType: i.offerType })),
    });
    a.items = a.items.map((it, idx) => {
      const r = repriced[idx];
      if (!r) throw new Error(`"${it.title}" is no longer available.`);
      return { ...it, total: r.total, deposit: r.deposit };
    });

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

    // look up the account (perks: saved ID verification + reminder-member 5%)
    const acct: any = await ctx.runQuery(internal.accounts._byEmail, {
      email: a.customer.email.trim().toLowerCase(),
    });
    let idVerifyStatus = protection === "verify" ? "required" : "not_required";
    if (protection === "verify" && acct?.idVerified) idVerifyStatus = "verified";

    const member = acct?.membershipActive ? tierByKey(acct.membershipTier) : null;

    // Pro/Studio: 2 free accessories per month (tripod, gimbal, filters, batteries)
    const month = new Date().toISOString().slice(0, 7);
    const allowance = member?.freeAccessories ?? 0;
    let creditsLeft = 0;
    if (allowance > 0) {
      const used = acct?.freeAccessoryMonth === month ? acct?.freeAccessoryUsed ?? 0 : 0;
      creditsLeft = Math.max(0, allowance - used);
    }
    const freed = new Set<number>();
    let freeAccessoryValue = 0;
    if (creditsLeft > 0) {
      const types: Record<string, string> = await ctx.runQuery(api.catalog.itemTypes, {
        ids: a.items.map((i) => i.listingId),
      });
      const elig = a.items
        .map((it, i) => ({ i, it }))
        .filter((x) => !x.it.offerType && FREE_ACCESSORY_TYPES.includes(types[x.it.listingId] ?? ""))
        .sort((x, y) => y.it.total - x.it.total)
        .slice(0, creditsLeft);
      for (const e of elig) {
        freed.add(e.i);
        freeAccessoryValue += e.it.total;
      }
    }
    const freedCount = freed.size;

    // % discounts apply to non-offer, non-freed lines, NON-STACKABLE (best of three)
    const eligible = a.items
      .filter((i, idx) => !i.offerType && !freed.has(idx))
      .reduce((n, i) => n + i.total, 0);
    let promoDiscount = 0;
    let appliedCode: string | undefined;
    if (a.promoCode) {
      const res: any = await ctx.runQuery(api.promo.validate, {
        code: a.promoCode,
        eligibleSubtotal: eligible,
        tier: acct?.membershipTier ?? undefined,
        membershipActive: !!acct?.membershipActive,
        email: a.customer.email,
      });
      if (res?.valid) {
        promoDiscount = res.discount;
        appliedCode = res.code;
      }
    }
    const reminderDiscount = acct?.marketingEmails ? Math.round(eligible * 0.05) : 0;
    const memberDiscount = member ? Math.round(eligible * (member.pct / 100)) : 0;
    let discount = promoDiscount;
    let discountLabel = appliedCode?.toUpperCase();
    if (reminderDiscount > discount) {
      discount = reminderDiscount;
      discountLabel = "Reminder member −5%";
      appliedCode = undefined;
    }
    if (memberDiscount > discount) {
      discount = memberDiscount;
      discountLabel = `${member!.name} member −${member!.pct}%`;
      appliedCode = undefined;
    }

    // free accessories are an ADDITIONAL perk on top of the best % discount
    const totalReduction = discount + freeAccessoryValue;
    const reductionLabel =
      freeAccessoryValue > 0
        ? discount > 0
          ? "Member perks"
          : `${freedCount} free accessor${freedCount > 1 ? "ies" : "y"}`
        : discountLabel;

    // members on Pro/Studio get free local delivery
    const deliveryFee = member?.freeDelivery && a.fulfilment === "delivery" ? 0 : a.deliveryFee;
    const total = subtotal + deliveryFee + depositAmount - totalReduction;

    const bookingId = await ctx.runMutation(internal.bookings.createPending, {
      customerEmail: a.customer.email,
      customerName: a.customer.name,
      phone: a.customer.phone,
      fulfilment: a.fulfilment,
      address: a.address,
      deliveryFee,
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
      discount: totalReduction,
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
    if (deliveryFee > 0) {
      line_items.push({
        quantity: 1,
        price_data: {
          currency: "gbp",
          unit_amount: pence(deliveryFee),
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
    if (totalReduction > 0) {
      const coupon = await sb.coupons.create({
        amount_off: pence(totalReduction),
        currency: "gbp",
        name: reductionLabel ?? "Discount",
        duration: "once",
      });
      discounts = [{ coupon: coupon.id }];
    }
    if (freedCount > 0 && acct) {
      await ctx.runMutation(internal.accounts._useFreeAccessories, {
        email: acct.email,
        month,
        count: freedCount,
      });
    }

    // saved cards: attach a Stripe customer so returning renters skip re-entry
    let stripeCustomerId: string | undefined = acct?.stripeCustomerId;
    if (acct && !stripeCustomerId) {
      const c = await sb.customers.create({ email: acct.email, name: a.customer.name });
      stripeCustomerId = c.id;
      await ctx.runMutation(internal.accounts._setStripeCustomer, {
        email: acct.email,
        customerId: c.id,
      });
    }

    const session = await sb.checkout.sessions.create({
      mode: "payment",
      line_items,
      discounts,
      ...(stripeCustomerId
        ? { customer: stripeCustomerId }
        : { customer_email: a.customer.email }),
      success_url: `${a.origin}/checkout/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${a.origin}/cart`,
      metadata: { bookingId },
      payment_intent_data: {
        metadata: { bookingId },
        setup_future_usage: "on_session", // save the card to the customer
      },
    });

    if (!session.url) throw new Error("Stripe did not return a checkout URL");
    return { url: session.url };
  },
});

/** Instant add-on checkout: pay for one extra item attached to an existing
 *  booking. Blocked within 1 hour of the rental start. */
export const startAddon = action({
  args: {
    token: v.string(),
    bookingId: v.id("bookings"),
    listingId: v.id("listings"),
    title: v.string(),
    start: v.number(),
    end: v.number(),
    total: v.number(),
    origin: v.string(),
  },
  handler: async (ctx, a): Promise<{ url: string }> => {
    const me: any = await ctx.runQuery(api.accounts.me, { token: a.token });
    const owner: any = await ctx.runQuery(internal.bookings.getForChat, { bookingId: a.bookingId });
    if (!me || !owner || owner.accountId !== me._id) throw new Error("unauthorized");
    if (Date.now() > a.start - 60 * 60 * 1000)
      throw new Error("Too close to your rental start to add gear — add-ons close 1 hour before pickup.");
    const av: any = await ctx.runQuery(api.availability.forListing, {
      listingId: a.listingId,
      start: a.start,
      end: a.end,
    });
    if (!av || av.available < 1) throw new Error("That add-on isn't available for your dates.");

    // anti-tamper: recompute the add-on price server-side, ignore the client total
    const repriced: any[] = await ctx.runQuery(internal.catalog.repriceLines, {
      items: [{ listingId: a.listingId, start: a.start, end: a.end }],
    });
    if (!repriced[0]) throw new Error("That add-on isn't available.");
    a.total = repriced[0].total;

    const session = await stripe().checkout.sessions.create({
      mode: "payment",
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: "gbp",
            unit_amount: pence(a.total),
            product_data: { name: `Add-on: ${a.title.slice(0, 110)}` },
          },
        },
      ],
      customer_email: me.email,
      success_url: `${a.origin}/checkout/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${a.origin}/account`,
      metadata: {
        addonBookingId: a.bookingId,
        addonListingId: a.listingId,
        addonTitle: a.title.slice(0, 200),
        addonStart: String(a.start),
        addonEnd: String(a.end),
        addonTotal: String(a.total),
      },
    });
    if (!session.url) throw new Error("Stripe did not return a checkout URL");
    return { url: session.url };
  },
});

async function ensurePrice(sb: Stripe, tier: { key: string; name: string; monthlyGbp: number }) {
  const lookup = `dbc_member_${tier.key}`;
  const existing = await sb.prices.list({ lookup_keys: [lookup], active: true, limit: 1 });
  if (existing.data[0]) return existing.data[0].id;
  const product = await sb.products.create({ name: `Db Cinema ${tier.name} membership` });
  const price = await sb.prices.create({
    product: product.id,
    unit_amount: pence(tier.monthlyGbp),
    currency: "gbp",
    recurring: { interval: "month" },
    lookup_key: lookup,
  });
  return price.id;
}

/** Subscribe to a membership tier (Stripe Billing). */
export const startMembership = action({
  args: { token: v.string(), tier: v.string(), origin: v.string() },
  handler: async (ctx, a): Promise<{ url: string }> => {
    const me: any = await ctx.runQuery(api.accounts.me, { token: a.token });
    if (!me) throw new Error("Please sign in to subscribe.");
    const tier = tierByKey(a.tier);
    if (!tier) throw new Error("Unknown plan.");
    const acct: any = await ctx.runQuery(internal.accounts._byEmail, { email: me.email });

    const sb = stripe();
    let customerId = acct?.stripeCustomerId;
    if (!customerId) {
      const c = await sb.customers.create({ email: me.email, name: me.name ?? undefined });
      customerId = c.id;
      await ctx.runMutation(internal.accounts._setStripeCustomer, { email: me.email, customerId });
    }
    const priceId = await ensurePrice(sb, tier);
    const session = await sb.checkout.sessions.create({
      mode: "subscription",
      line_items: [{ price: priceId, quantity: 1 }],
      customer: customerId,
      success_url: `${a.origin}/checkout/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${a.origin}/membership`,
      metadata: { membershipTier: tier.key, accountEmail: me.email },
      subscription_data: { metadata: { accountEmail: me.email, membershipTier: tier.key } },
    });
    if (!session.url) throw new Error("Stripe did not return a checkout URL");
    return { url: session.url };
  },
});

/** Open the Stripe billing portal to manage/cancel the membership. */
export const billingPortal = action({
  args: { token: v.string(), origin: v.string() },
  handler: async (ctx, a): Promise<{ url: string }> => {
    const me: any = await ctx.runQuery(api.accounts.me, { token: a.token });
    if (!me) throw new Error("unauthorized");
    const acct: any = await ctx.runQuery(internal.accounts._byEmail, { email: me.email });
    if (!acct?.stripeCustomerId) throw new Error("No billing account yet — subscribe first.");
    const ps = await stripe().billingPortal.sessions.create({
      customer: acct.stripeCustomerId,
      return_url: `${a.origin}/account`,
    });
    return { url: ps.url };
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
  ): Promise<{ bookingId: string | null; paid: boolean; membership?: string }> => {
    const session = await stripe().checkout.sessions.retrieve(sessionId);
    const m = session.metadata ?? {};
    const paid = session.payment_status === "paid";

    // membership subscription → activate the tier on the account
    if (paid && m.membershipTier) {
      await ctx.runMutation(internal.accounts._setMembership, {
        email: m.accountEmail ?? "",
        tier: m.membershipTier,
        subscriptionId: typeof session.subscription === "string" ? session.subscription : undefined,
      });
      return { bookingId: null, paid, membership: m.membershipTier };
    }

    // add-on payment → attach to the existing booking
    if (paid && m.addonBookingId) {
      await ctx.runMutation(internal.bookings.attachAddon, {
        bookingId: m.addonBookingId as any,
        listingId: m.addonListingId as any,
        title: m.addonTitle ?? "Add-on",
        start: Number(m.addonStart),
        end: Number(m.addonEnd),
        total: Number(m.addonTotal),
      });
      return { bookingId: m.addonBookingId as string, paid };
    }

    const bookingId = (m.bookingId as string) ?? null;
    if (paid && bookingId) {
      await ctx.runMutation(internal.bookings.confirm, {
        bookingId: bookingId as any,
        paymentIntentId:
          typeof session.payment_intent === "string"
            ? session.payment_intent
            : undefined,
      });
      await ctx.runMutation(api.analytics.track, { type: "purchase" });
    }
    return { bookingId, paid };
  },
});

/**
 * STAGED Stripe webhook handler (called by convex/http.ts on POST /stripe-webhook).
 * Confirms bookings server-side so a paid booking is never left unconfirmed if the
 * customer closes the tab before the success page runs finalize().
 * ACTIVATION (2 steps, both required):
 *   1. In the Stripe dashboard, add a webhook endpoint → https://veracious-wombat-196.convex.site/stripe-webhook
 *      for event `checkout.session.completed`; copy its signing secret.
 *   2. `npx convex env set STRIPE_WEBHOOK_SECRET whsec_...`
 * Until the secret is set this returns false (no-op) and the success-page finalize() still
 * confirms bookings — so deploying this is safe and non-breaking.
 */
export const stripeWebhook = internalAction({
  args: { body: v.string(), sig: v.string() },
  handler: async (ctx, { body, sig }): Promise<boolean> => {
    const secret = process.env.STRIPE_WEBHOOK_SECRET;
    if (!secret || !sig) return false; // not configured yet — finalize() covers confirmation
    let event: Stripe.Event;
    try {
      event = stripe().webhooks.constructEvent(body, sig, secret);
    } catch {
      return false; // bad signature
    }
    if (event.type === "checkout.session.completed") {
      const s = event.data.object as Stripe.Checkout.Session;
      const m = s.metadata ?? {};
      const pi = typeof s.payment_intent === "string" ? s.payment_intent : undefined;
      if (s.payment_status === "paid") {
        if (m.bookingId) {
          await ctx.runMutation(internal.bookings.confirm, { bookingId: m.bookingId as any, paymentIntentId: pi });
        } else if (m.addonBookingId) {
          await ctx.runMutation(internal.bookings.attachAddon, {
            bookingId: m.addonBookingId as any, listingId: m.addonListingId as any,
            title: m.addonTitle ?? "Add-on", start: Number(m.addonStart), end: Number(m.addonEnd), total: Number(m.addonTotal),
          });
        } else if (m.membershipTier) {
          await ctx.runMutation(internal.accounts._setMembership, {
            email: m.accountEmail ?? "", tier: m.membershipTier,
            subscriptionId: typeof s.subscription === "string" ? s.subscription : undefined,
          });
        }
      }
    }
    return true;
  },
});
