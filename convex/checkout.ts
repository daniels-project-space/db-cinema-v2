"use node";

import Stripe from "stripe";
import { action, internalAction } from "./_generated/server";
import { internal, api } from "./_generated/api";
import { v } from "convex/values";
import { depositFor } from "./lib/pricing";
import { lateFeeQuote } from "./lib/lateFee";
import { AGREEMENTS } from "../src/lib/legal";
import { sendMail } from "./lib/mailer";
import { tierByKey, FREE_ACCESSORY_TYPES } from "./lib/membership";
import { assertDiditCheckoutCapacity } from "./lib/diditCapacity";

const pence = (gbp: number) => Math.round(gbp * 100);

const subActive = (status: string) => status === "active" || status === "trialing";

/** Map a Stripe subscription back to one of our tier keys: price lookup_key (dbc_member_<key>,
 *  set by ensurePrice) first, then subscription metadata, then the monthly amount as a fallback. */
function tierKeyFromSub(sub: Stripe.Subscription): string | undefined {
  const price = sub.items?.data?.[0]?.price;
  const lk = price?.lookup_key ?? undefined;
  if (lk && lk.startsWith("dbc_member_")) return lk.slice("dbc_member_".length);
  const meta = sub.metadata?.membershipTier;
  if (meta) return meta;
  const amt = price?.unit_amount ?? 0;
  return amt >= 9900 ? "studio" : amt >= 4900 ? "pro" : amt >= 1900 ? "plus" : undefined;
}

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
    token: v.optional(v.string()), // session token — required to apply MEMBER perks (anti-spoof)
    customer: v.object({
      email: v.string(),
      name: v.optional(v.string()),
      phone: v.optional(v.string()),
      billingAddress: v.string(),
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
        securityHoldConsent: v.boolean(),
        laterChargeConsent: v.boolean(),
        documents: v.array(v.object({ kind: v.string(), version: v.string() })),
      }),
    ),
    origin: v.string(),
  },
  handler: async (ctx, a): Promise<{ url: string }> => {
    if (a.items.length === 0) throw new Error("empty cart");
    if (process.env.RENTAL_CHECKOUT_ENABLED !== "true")
      throw new Error("Direct rental checkout is being prepared. Please contact us to arrange your rental.");
    if (process.env.BUSINESS_VAT_REGISTERED === "true")
      throw new Error("Rental receipt tax configuration needs updating before checkout can continue.");
    if (!process.env.DIDIT_API_KEY || !process.env.DIDIT_WORKFLOW_ID || !process.env.DIDIT_WEBHOOK_SECRET ||
        !process.env.DIDIT_APPLICATION_ID || !["sandbox", "live"].includes(process.env.DIDIT_ENVIRONMENT ?? ""))
      throw new Error("Automatic identity and address verification is being configured. Please contact us before paying.");
    if ((process.env.STRIPE_SECRET_KEY?.startsWith("sk_live_") && process.env.DIDIT_ENVIRONMENT !== "live") ||
        (process.env.STRIPE_SECRET_KEY?.startsWith("sk_test_") && process.env.DIDIT_ENVIRONMENT !== "sandbox"))
      throw new Error("Payment and identity verification environments do not match.");
    if (!process.env.STRIPE_WEBHOOK_SECRET || !process.env.INVOICE_SECRET || !process.env.APP_URL ||
        !process.env.BUSINESS_LEGAL_NAME || !process.env.BUSINESS_INVOICE_ADDRESS ||
        !((process.env.GMAIL_USER && process.env.GMAIL_APP_PASSWORD) || process.env.RESEND_API_KEY))
      throw new Error("Rental receipts and payment notifications are being configured. Please contact us before paying.");
    const cfg: any = await ctx.runQuery(api.settings.get, {});
    if (!cfg.acceptingOrders)
      throw new Error("We're not accepting new bookings right now — please check back soon.");
    if (!a.agreement || !a.agreement.name.trim() || !a.agreement.securityHoldConsent || !a.agreement.laterChargeConsent)
      throw new Error("Please sign the rental agreement to continue.");
    if (a.customer.billingAddress.trim().length < 10 || (a.customer.name ?? "").trim().length < 3)
      throw new Error("Enter your full name and billing address for the rental statement.");
    const slot = /^([01]\d|2[0-3]):[0-5]\d$/;
    if (!a.pickupTime || !slot.test(a.pickupTime) || !a.returnTime || !slot.test(a.returnTime))
      throw new Error("Choose the agreed pickup and return times before paying.");
    if (!AGREEMENTS.every((expected) => a.agreement!.documents.some((accepted) =>
      accepted.kind === expected.kind && accepted.version === expected.version)))
      throw new Error("Please review and accept the current rental agreements before paying.");

    await assertDiditCheckoutCapacity(
      process.env.DIDIT_API_KEY!,
      process.env.DIDIT_WORKFLOW_ID!,
      process.env.DIDIT_ENVIRONMENT!,
      process.env.DIDIT_MAX_WORKFLOW_PRICE_USD,
    );

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
    const depositHoldAmount = depositFor(protection, replacementSum);
    const depositAmount = Math.round(depositHoldAmount * 50) / 100;

    // account perks (member discount, free accessories, saved ID/card, reminder 5%) require an
    // AUTHENTICATED session token — never the typed email — so they can't be claimed by spoofing
    // a member's address. Guest checkout (no token) gets no perks. (S6)
    const acct: any = a.token
      ? await ctx.runQuery(internal.accounts._byToken, { token: a.token })
      : null;
    // Existing Stripe Identity checks do not include proof of address. Require the
    // complete Didit flow for every new booking, including deposit-category rentals.
    const idVerifyStatus = "required";

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
        rentalSubtotal: subtotal,
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

    const sb = stripe();
    const paymentConfigId = process.env.STRIPE_RENTAL_PAYMENT_METHOD_CONFIGURATION_ID;
    if (!paymentConfigId) throw new Error("Rental card payment setup is incomplete. Please contact us before paying.");
    const paymentConfig = await sb.paymentMethodConfigurations.retrieve(paymentConfigId);
    if (!paymentConfig.active || paymentConfig.card?.display_preference?.value !== "on" ||
        paymentConfig.apple_pay?.display_preference?.value !== "off" ||
        paymentConfig.google_pay?.display_preference?.value !== "off" ||
        paymentConfig.link?.display_preference?.value !== "off")
      throw new Error("Rental payment configuration must use a reusable card. Please contact us before paying.");

    // store credit redemption — applies to the rental spend only (never the refundable deposit).
    // Reserved transactionally inside createPending (double-spend-safe): it caps to the account's
    // available balance minus credit already reserved by its other pending checkouts, and returns
    // the amount actually applied, which drives the Stripe discount below.
    const { bookingId, creditApplied } = await ctx.runMutation(internal.bookings.createPending, {
      customerEmail: a.customer.email,
      customerName: a.customer.name,
      billingAddress: a.customer.billingAddress.trim(),
      phone: a.customer.phone,
      fulfilment: a.fulfilment,
      address: a.address,
      deliveryFee,
      lineItems: a.items.map((i, idx) => ({
        listingId: i.listingId,
        title: i.title,
        start: i.start,
        end: i.end,
        qty: i.qty,
        lineTotal: i.total,
        dailyRate: repriced[idx]?.dailyRate,
      })),
      subtotal,
      depositAmount,
      depositHoldAmount,
      promoCode: appliedCode,
      discount: totalReduction,
      total,
      creditAccountId: acct?._id,
      currency: "GBP",
      agreementName: a.agreement?.name,
      securityHoldConsent: a.agreement?.securityHoldConsent,
      laterChargeConsent: a.agreement?.laterChargeConsent,
      agreementDocs: a.agreement?.documents,
      protection,
      idVerifyStatus,
      verificationProvider: "didit",
      pickupTime: a.pickupTime,
      returnTime: a.returnTime,
    });

    // soft-hold the units for 20 min so nobody else grabs them mid-checkout
    await ctx.runMutation(internal.bookings.placeHolds, {
      bookingId,
      ttlMs: 35 * 60 * 1000,
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
              "Refundable security payment (50% of card hold; refunded after safe return)",
          },
        },
      });
    }

    let discounts: Stripe.Checkout.SessionCreateParams.Discount[] | undefined;
    const couponAmount = totalReduction + creditApplied;
    if (couponAmount > 0) {
      const couponName =
        creditApplied > 0
          ? reductionLabel
            ? `${reductionLabel} + £${creditApplied} credit`
            : `£${creditApplied} store credit`
          : reductionLabel ?? "Discount";
      const coupon = await sb.coupons.create({
        amount_off: pence(couponAmount),
        currency: "gbp",
        name: couponName,
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
      // Align the payment window with the soft hold. Stripe defaults to a 24h session, but the
      // hold only lasts ~35 min — so a late payment could confirm after the hold was released and
      // the gear rebooked elsewhere (oversell). 31 min is just over Stripe's 30-min minimum.
      expires_at: Math.floor(Date.now() / 1000) + 31 * 60,
      line_items,
      payment_method_configuration: paymentConfigId,
      discounts,
      ...(stripeCustomerId
        ? { customer: stripeCustomerId }
        : { customer_email: a.customer.email, customer_creation: "always" as const }),
      success_url: `${a.origin}/checkout/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${a.origin}/cart`,
      metadata: { bookingId },
      payment_intent_data: {
        metadata: { bookingId },
        setup_future_usage: "off_session", // separately disclosed later charges need a saved card
      },
    });

    if (!session.url) throw new Error("Stripe did not return a checkout URL");
    await ctx.runMutation(internal.bookings.bindCheckoutSession, { bookingId, sessionId: session.id });
    return { url: session.url };
  },
});

/** A separate manual-capture PaymentIntent is required for an actual card hold.
 * Checkout saves the card for off-session use, then this attempts the hold immediately.
 * Issuer authentication is still possible; the success page handles that in the same flow. */
async function authorizeHold(ctx: any, session: Stripe.Checkout.Session): Promise<{ status: string; clientSecret?: string }> {
  const bookingId = session.metadata?.bookingId;
  if (!bookingId || session.payment_status !== "paid") return { status: "not_applicable" };
  const b: any = await ctx.runQuery(internal.bookings.holdContext, { bookingId: bookingId as any });
  if (!b || !b.amount || !["confirmed", "active"].includes(b.status)) return { status: "not_applicable" };
  const sb = stripe();
  let intent: Stripe.PaymentIntent;
  if (b.intentId) {
    intent = await sb.paymentIntents.retrieve(b.intentId, { expand: ["latest_charge"] });
  } else {
    const paymentId = typeof session.payment_intent === "string" ? session.payment_intent : null;
    const customerId = typeof session.customer === "string" ? session.customer : session.customer?.id;
    if (!paymentId || !customerId) return { status: "failed" };
    const paidIntent = await sb.paymentIntents.retrieve(paymentId);
    const paymentMethod = typeof paidIntent.payment_method === "string"
      ? paidIntent.payment_method : paidIntent.payment_method?.id;
    if (!paymentMethod) return { status: "failed" };
    try {
      intent = await sb.paymentIntents.create({
        amount: pence(b.amount), currency: "gbp", customer: customerId,
        payment_method: paymentMethod, payment_method_types: ["card"],
        capture_method: "manual", confirm: true, off_session: true,
        ...(process.env.STRIPE_EXTENDED_AUTH_ENABLED === "true"
          ? { payment_method_options: { card: { request_extended_authorization: "if_available" as const } } }
          : {}),
        metadata: { bookingId, purpose: "refundable_security_hold" },
        expand: ["latest_charge"],
      }, { idempotencyKey: `dbc-security-hold-${bookingId}` });
    } catch (e: any) {
      const failedIntentId = e?.raw?.payment_intent?.id ?? e?.payment_intent?.id;
      if (!failedIntentId) {
        await ctx.runMutation(internal.bookings.setHold, { bookingId: bookingId as any, status: "failed" });
        return { status: "failed" };
      }
      intent = await sb.paymentIntents.retrieve(failedIntentId, { expand: ["latest_charge"] });
    }
  }
  const charge: any = intent.latest_charge;
  const expiresAt = typeof charge === "object"
    ? charge?.payment_method_details?.card?.capture_before * 1000 || undefined : undefined;
  const status = intent.status === "requires_capture" ? "held"
    : intent.status === "requires_action" ? "requires_action"
    : intent.status === "canceled" ? "released" : "failed";
  await ctx.runMutation(internal.bookings.setHold, {
    bookingId: bookingId as any, intentId: intent.id, status, expiresAt,
  });
  return { status, clientSecret: status === "requires_action" ? intent.client_secret ?? undefined : undefined };
}

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
      expires_at: Math.floor(Date.now() / 1000) + 31 * 60, // don't let an add-on confirm long after pricing/availability was checked
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

/** Admin: mark a rental RETURNED and release its security deposit in one step. Pass damageKept to
 *  retain part of the deposit for damage (that portion stays captured; the rest is refunded to the
 *  card). Idempotent — the depositRefunded flag plus a Stripe idempotency key prevent a double refund. */
export const markReturned = action({
  args: { token: v.string(), bookingId: v.id("bookings"), damageKept: v.optional(v.number()), damageNote: v.optional(v.string()), actualReturnedAt: v.optional(v.number()), chargeLate: v.boolean(), lateWaiverReason: v.optional(v.string()) },
  handler: async (
    ctx,
    { token, bookingId, damageKept, damageNote, actualReturnedAt, chargeLate, lateWaiverReason },
  ): Promise<{ ok: boolean; released: number; kept: number; lateAmount: number; alreadyReleased: boolean }> => {
    await ctx.runMutation(internal.adminAuth.assertAdminInternal, { token, fn: "checkout.markReturned" });
    const b: any = await ctx.runQuery(internal.bookings.getForRefund, { bookingId });
    if (!b) throw new Error("Booking not found.");
    const returned = actualReturnedAt ?? Date.now();
    if (!Number.isFinite(returned) || returned > Date.now() + 60000 || returned < Date.now() - 45 * 86400000)
      throw new Error("Actual return time must be within the last 45 days.");
    const quotedLate = lateFeeQuote(b.lineItems, b.returnTime, returned);
    if (!chargeLate && quotedLate.amount > 0 && (lateWaiverReason ?? "").trim().length < 5)
      throw new Error("Record why the calculated late rental time is being waived.");
    const late = chargeLate ? quotedLate : { amount: 0, breakdown: [] };
    const waiver = !chargeLate && quotedLate.amount > 0
      ? { waivedAmount: quotedLate.amount, waiverReason: lateWaiverReason?.trim() } : {};
    if ((damageKept ?? 0) > 0 && (!damageNote || damageNote.trim().length < 10))
      throw new Error("Record the evidence and reason for a damage deduction.");
    for (const oldId of b.depositHoldPreviousIntentIds ?? []) {
      try {
        const old = await stripe().paymentIntents.retrieve(oldId);
        if (old.status === "requires_capture") await stripe().paymentIntents.cancel(oldId);
        await ctx.runMutation(internal.bookings.clearPreviousHold, { bookingId, intentId: oldId });
      } catch (error) { console.error("Could not release superseded hold at return", oldId, error); }
    }

    const deposit = b.depositAmount ?? 0;
    if (!Number.isFinite(damageKept ?? 0) || (damageKept ?? 0) < 0 ||
        (damageKept ?? 0) > deposit + (b.depositHoldAmount ?? 0))
      throw new Error("The damage amount must be within the paid security payment and full authorised hold.");
    const kept = Math.max(0, Math.min(Math.round((damageKept ?? 0) * 100) / 100, deposit + (b.depositHoldAmount ?? 0)));
    if (b.depositRefunded && kept > 0 && !b.returnDecision)
      throw new Error("This security payment was already settled; a new damage deduction cannot be added here.");
    if (kept > 0 && !b.depositRefunded) {
      let holdAvailable = 0;
      if (b.depositHoldIntentId) {
        const observed = await stripe().paymentIntents.retrieve(b.depositHoldIntentId);
        if (observed.status === "requires_capture") holdAvailable = b.depositHoldAmount ?? 0;
        else if (observed.status === "succeeded") holdAvailable = observed.amount_received / 100;
      }
      if (kept > deposit + holdAvailable)
        throw new Error("The active card hold cannot cover this deduction. Record only the amount currently available and handle any further claim separately.");
      if (!b.guestEmail) throw new Error("Customer email is required for an itemised damage notice.");
    }
    await ctx.runMutation(internal.bookings.beginReturnDecision, {
      bookingId, actualReturnedAt: returned, damageKept: kept, damageNote: kept ? damageNote?.trim() : undefined,
      chargeLate, lateWaiverReason: !chargeLate && quotedLate.amount > 0 ? lateWaiverReason?.trim() : undefined,
    });
    if (kept > 0 && !b.depositRefunded && !b.damageNoticeSentAt) {
      const detail = (damageNote ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
      const sent = await sendMail({
        to: b.guestEmail,
        subject: `Db Cinema rental: itemised £${kept} damage or loss deduction`,
        html: `<h2>Rental return and security deduction</h2><p>We recorded a £${kept} deduction for the following documented reason:</p><p>${detail}</p><p>We will apply the available authorised hold first and use the refundable security payment only for any remaining amount. Reply to this email if the evidence or amount is wrong. We will not collect the same amount twice.</p>`,
      });
      if (!sent) throw new Error("The itemised deduction notice could not be delivered. No damage amount was captured; please retry after fixing email delivery.");
      await ctx.runMutation(internal.bookings.markDamageNoticeSent, { bookingId });
    }

    // Mark returned and free the inventory ledger after the deduction preflight.
    await ctx.runMutation(internal.bookings.markReturnedStatus, { bookingId });

    if (b.depositRefunded || (deposit <= 0 && !b.depositHoldIntentId)) {
      await ctx.runMutation(internal.bookings.recordLateFee, { bookingId, actualReturnedAt: returned, ...late, ...waiver });
      return { ok: true, released: b.depositRefundAmount ?? 0, kept: b.depositKept ?? 0, lateAmount: late.amount, alreadyReleased: !!b.depositRefunded };
    }
    let capturedFromHold = 0;
    if (b.depositHoldIntentId) {
      const sb = stripe();
      const hold = await sb.paymentIntents.retrieve(b.depositHoldIntentId);
      if (hold.status === "requires_capture") {
        capturedFromHold = Math.min(kept, b.depositHoldAmount ?? 0);
        if (capturedFromHold > 0) {
          await sb.paymentIntents.capture(hold.id, { amount_to_capture: pence(capturedFromHold) }, { idempotencyKey: `dbc-hold-capture-${bookingId}` });
        } else if (late.amount === 0) {
          await sb.paymentIntents.cancel(hold.id, {}, { idempotencyKey: `dbc-hold-release-${bookingId}` });
        }
        if (capturedFromHold > 0 || late.amount === 0)
          await ctx.runMutation(internal.bookings.setHold, {
            bookingId, intentId: hold.id, status: capturedFromHold ? "captured" : "released",
          });
      } else if (hold.status === "succeeded") {
        capturedFromHold = Math.min(kept, hold.amount_received / 100);
      }
    }
    const toRefund = Math.max(0, deposit - Math.max(0, kept - capturedFromHold));
    if (toRefund > 0 && b.paymentIntentId) {
      await stripe().refunds.create(
        { payment_intent: b.paymentIntentId, amount: pence(toRefund) },
        { idempotencyKey: `dbc-deposit-release-${bookingId}` },
      );
    }
    await ctx.runMutation(internal.bookings.markDepositReleased, { bookingId, kept, refunded: b.paymentIntentId ? toRefund : 0, capturedFromHold, note: damageNote?.trim() });
    await ctx.runMutation(internal.bookings.recordLateFee, { bookingId, actualReturnedAt: returned, ...late, ...waiver });
    return { ok: true, released: b.paymentIntentId ? toRefund : 0, kept, lateAmount: late.amount, alreadyReleased: false };
  },
});

export const finalize = action({
  args: { sessionId: v.string() },
  handler: async (
    ctx,
    { sessionId },
  ): Promise<{ bookingId: string | null; paid: boolean; closed?: boolean; membership?: string; holdStatus?: string; holdClientSecret?: string }> => {
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

    // extend payment → apply the extra days to the targeted item(s)
    if (paid && m.changeRequestId) {
      await ctx.runMutation(internal.changes._applyExtendPaid, { requestId: m.changeRequestId as any });
      return { bookingId: null, paid };
    }

    const bookingId = (m.bookingId as string) ?? null;
    if (paid && bookingId) {
      const confirmation = await ctx.runMutation(internal.bookings.confirm, {
        bookingId: bookingId as any,
        paymentIntentId:
          typeof session.payment_intent === "string"
            ? session.payment_intent
            : undefined,
      });
      if (confirmation.closed) return { bookingId, paid, closed: true };
      await ctx.runMutation(api.analytics.track, { type: "purchase" });
      const hold = await authorizeHold(ctx, session);
      return { bookingId, paid, holdStatus: hold.status, holdClientSecret: hold.clientSecret };
    }
    return { bookingId, paid };
  },
});

/** Reconcile the separate hold after issuer authentication in the success page. */
export const syncHold = action({
  args: { sessionId: v.string() },
  handler: async (ctx, { sessionId }): Promise<{ status: string; clientSecret?: string }> => {
    const session = await stripe().checkout.sessions.retrieve(sessionId);
    if (session.payment_status !== "paid" || !session.metadata?.bookingId)
      throw new Error("Payment has not completed");
    return authorizeHold(ctx, session);
  },
});

/** A disputed late charge must not keep an otherwise unused security hold. */
export const releasePausedLateHold = internalAction({
  args: { bookingId: v.id("bookings") },
  handler: async (ctx, { bookingId }) => {
    const late: any = await ctx.runQuery(internal.bookings.lateFeeContext, { bookingId });
    if (!late || late.lateFeeStatus !== "paused" || late.depositKept > 0 || !late.stripeDepositIntentId) return;
    const sb = stripe();
    const hold = await sb.paymentIntents.retrieve(late.stripeDepositIntentId);
    if (hold.status === "requires_capture") {
      await sb.paymentIntents.cancel(hold.id, {}, { idempotencyKey: `dbc-disputed-late-release-${bookingId}` });
      await ctx.runMutation(internal.bookings.setHold, { bookingId, intentId: hold.id, status: "released" });
    }
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
          const confirmation = await ctx.runMutation(internal.bookings.confirm, { bookingId: m.bookingId as any, paymentIntentId: pi });
          if (confirmation.closed) return true;
          try { await authorizeHold(ctx, s); }
          catch (e) { console.error("Card hold authorization failed", e); }
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
        } else if (m.changeRequestId) {
          await ctx.runMutation(internal.changes._applyExtendPaid, { requestId: m.changeRequestId as any });
        }
      }
    }
    // Subscription lifecycle → keep membership perks honest (perks everywhere gate on membershipActive).
    if (event.type === "customer.subscription.deleted") {
      const sub = event.data.object as Stripe.Subscription;
      await ctx.runMutation(internal.accounts._setMembershipBySubscription, { subscriptionId: sub.id, active: false });
    } else if (event.type === "customer.subscription.updated") {
      const sub = event.data.object as Stripe.Subscription;
      await ctx.runMutation(internal.accounts._setMembershipBySubscription, {
        subscriptionId: sub.id,
        active: subActive(sub.status),
        tier: tierKeyFromSub(sub),
      });
    }
    return true;
  },
});

/** Safety net for membership perks: reconcile every subscriber's membershipActive/tier against the
 *  REAL Stripe subscription so perks lapse with billing even when the Stripe webhook isn't configured.
 *  Runs on a cron. Stripe outage/transient errors leave the flag untouched (fail-safe, retried next run). */
export const reconcileMemberships = internalAction({
  args: {},
  handler: async (ctx): Promise<{ checked: number; changed: number }> => {
    if (!process.env.STRIPE_SECRET_KEY) return { checked: 0, changed: 0 };
    const subs: any[] = await ctx.runQuery(internal.accounts._listSubscribers, {});
    const sb = stripe();
    let changed = 0;
    for (const s of subs) {
      let sub: Stripe.Subscription | null = null;
      try {
        sub = await sb.subscriptions.retrieve(s.subscriptionId);
      } catch (e: any) {
        if (e?.code === "resource_missing") sub = null; // deleted at Stripe → deactivate
        else continue; // transient error — leave as-is, retry next cron
      }
      const active = sub ? subActive(sub.status) : false;
      const tier = sub ? tierKeyFromSub(sub) : undefined;
      if (active !== s.membershipActive || (tier && tier !== s.membershipTier)) {
        await ctx.runMutation(internal.accounts._applyMembershipReconcile, { accountId: s.accountId, active, tier });
        changed++;
      }
    }
    return { checked: subs.length, changed };
  },
});

const londonStartOfDay = (ms: number) => {
  const p = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date(ms));
  const y = +p.find((x) => x.type === "year")!.value;
  const mo = +p.find((x) => x.type === "month")!.value;
  const d = +p.find((x) => x.type === "day")!.value;
  return Date.UTC(y, mo - 1, d);
};

/**
 * Customer self-service cancellation (Phase 3). Gated behind CUSTOMER_BOOKING_ACTIONS=true.
 *  - ≥3 London-days before start → full cash refund (rental + deposit) to the card.
 *  - <3 days → deposit refunded to the card + 90-day store credit for the rental portion.
 *  - pending_payment (nothing charged) → just cancel + release holds.
 * Only site-sourced bookings; never touches Hygglo-mirrored reservations.
 */
async function releaseBookingHolds(ctx: any, bookingId: any, b: any) {
  const sb = stripe();
  const ids = [...new Set([
    b.stripeDepositIntentId,
    b.depositHoldRenewalIntentId,
    ...(b.depositHoldPreviousIntentIds ?? []),
  ].filter((id): id is string => !!id))];
  for (const id of ids) {
    const hold = await sb.paymentIntents.retrieve(id);
    if (["requires_capture", "requires_action", "requires_confirmation", "requires_payment_method"].includes(hold.status)) {
      await sb.paymentIntents.cancel(id, {}, { idempotencyKey: `dbc-cancel-hold-${bookingId}-${id}` });
      if (id === b.stripeDepositIntentId)
        await ctx.runMutation(internal.bookings.setHold, { bookingId, intentId: id, status: "released" });
    }
  }
}

async function paymentBeforeCancellation(b: any): Promise<string | null> {
  if (b.stripePaymentIntentId) return b.stripePaymentIntentId;
  if (b.status !== "pending_payment") return null;
  if (!b.stripeCheckoutSessionId) throw new Error("Checkout is still being prepared. Try again shortly.");
  const sb = stripe();
  const session = await sb.checkout.sessions.retrieve(b.stripeCheckoutSessionId);
  if (session.status === "open") {
    await sb.checkout.sessions.expire(session.id);
    return null;
  }
  if (session.status === "complete" && session.payment_status === "paid")
    return typeof session.payment_intent === "string" ? session.payment_intent : session.payment_intent?.id ?? null;
  if (session.status === "expired") return null;
  throw new Error("Checkout payment is still processing. Contact support before cancelling.");
}

export const cancelByAdmin = action({
  args: { token: v.string(), bookingId: v.id("bookings"), reason: v.string() },
  handler: async (ctx, { token, bookingId, reason }): Promise<{ refundAmount: number }> => {
    await ctx.runMutation(internal.adminAuth.assertAdminInternal, { token, fn: "checkout.cancelByAdmin" });
    if (reason.trim().length < 5) throw new Error("Record the cancellation reason.");
    const b: any = await ctx.runQuery(internal.bookings.getForCancel, { bookingId });
    if (!b || !["confirmed", "pending_payment"].includes(b.status) || !b.siteOnly)
      throw new Error("Only unstarted direct bookings can be cancelled here.");
    const paidIntentId = await paymentBeforeCancellation(b);
    let refundAmount = 0;
    if (paidIntentId) {
      const payment = await stripe().paymentIntents.retrieve(paidIntentId);
      refundAmount = payment.amount_received / 100;
      if (refundAmount > 0) await stripe().refunds.create(
        { payment_intent: payment.id, amount: payment.amount_received },
        { idempotencyKey: `dbc-admin-cancel-refund-${bookingId}` },
      );
    }
    await releaseBookingHolds(ctx, bookingId, b);
    await ctx.runMutation(internal.bookings._finalizeCancellation, {
      bookingId, accountId: b.accountId ?? undefined, mode: refundAmount > 0 ? "refund" : "none",
      refundAmount, creditAmount: 0, currency: b.currency, adminReason: reason.trim().slice(0, 400),
    });
    return { refundAmount };
  },
});

export const cancelByCustomer = action({
  args: { token: v.string(), bookingId: v.id("bookings") },
  handler: async (ctx, { token, bookingId }): Promise<{ ok: boolean; mode: string; refundAmount: number; creditAmount: number }> => {
    if (process.env.CUSTOMER_BOOKING_ACTIONS !== "true")
      throw new Error("Online cancellation isn't available yet — please contact us to cancel.");
    const me: any = await ctx.runQuery(api.accounts.me, { token });
    if (!me) throw new Error("Please sign in.");
    const b: any = await ctx.runQuery(internal.bookings.getForCancel, { bookingId });
    if (!b || b.guestEmail !== me.email) throw new Error("unauthorized");
    if (b.cancelledAt || b.status === "cancelled") throw new Error("This booking is already cancelled.");
    if (!["confirmed", "pending_payment"].includes(b.status))
      throw new Error("This booking can no longer be cancelled online — please contact us.");
    if (!b.siteOnly) throw new Error("Please contact us to change this booking.");

    const paidIntentId = await paymentBeforeCancellation(b);

    let mode: "none" | "refund" | "credit" = "none";
    let refundAmount = 0;
    let creditAmount = 0;
    // only refund / issue store credit for a booking that was GENUINELY paid through Stripe —
    // a confirmed booking with no payment intent (e.g. admin-confirmed, £0) yields no credit.
    if (paidIntentId) {
      const days = b.earliestStart != null
        ? Math.round((londonStartOfDay(b.earliestStart) - londonStartOfDay(Date.now())) / 86400000)
        : 0;
      if (days >= 3) {
        mode = "refund";
        refundAmount = b.total;
      } else {
        mode = "credit";
        refundAmount = b.depositAmount;
        creditAmount = Math.max(0, b.total - b.depositAmount);
      }
      if (refundAmount > 0) {
        // idempotency key → Stripe dedupes a double-click so a cancellation can never double-refund
        await stripe().refunds.create(
          { payment_intent: paidIntentId, amount: pence(refundAmount) },
          { idempotencyKey: `dbc-cancel-refund-${bookingId}` },
        );
      }
    }
    await releaseBookingHolds(ctx, bookingId, b);
    await ctx.runMutation(internal.bookings._finalizeCancellation, {
      bookingId, accountId: me._id, mode, refundAmount, creditAmount, currency: b.currency,
    });
    return { ok: true, mode, refundAmount, creditAmount };
  },
});
