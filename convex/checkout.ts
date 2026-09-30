"use node";

import Stripe from "stripe";
import { action, internalAction } from "./_generated/server";
import { internal, api } from "./_generated/api";
import { v } from "convex/values";
import { cancellationPaymentPlan,rentalRefundPlan,securityReturnPlan } from "./lib/rentalPaymentPlan";
import { lateFeeQuote } from "./lib/lateFee";
import { AGREEMENTS } from "../src/lib/legal";
import { sendMail } from "./lib/mailer";
import { assertDiditCheckoutCapacity } from "./lib/diditCapacity";
import { tierByKey } from "./lib/membership";
import { cancelKind, cancellationSettlement } from "../src/lib/cancellationPolicy";
import { calculateRentalPrice } from "./lib/rentalPrice";

const pence = (gbp: number) => Math.round(gbp * 100);
const subActive = (status: string) => status === "active" || status === "trialing";

type PriceQuoteResult = {
  items: { title: string; total: number }[];
  subtotal: number;
  depositHoldAmount: number;
  depositAmount: number;
  quotedDeliveryFee: number;
  deliveryFee: number;
  reductionLabel?: string;
  totalReduction: number;
  creditApplied: number;
  totalDue: number;
};

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

/** Preview the same authoritative calculation used when creating the Stripe session. */
export const priceQuote = action({
  args: {
    items: v.array(v.object({
      listingId: v.id("listings"), title: v.string(), start: v.number(), end: v.number(),
      qty: v.number(), total: v.number(), deposit: v.number(), offerType: v.optional(v.string()),
    })),
    token: v.optional(v.string()),
    customerEmail: v.string(),
    fulfilment: v.union(v.literal("pickup"), v.literal("delivery")),
    address: v.optional(v.string()),
    deliveryPostcode: v.optional(v.string()),
    promoCode: v.optional(v.string()),
    protection: v.optional(v.union(v.literal("verify"), v.literal("deposit"))),
  },
  handler: async (ctx, a): Promise<PriceQuoteResult> => {
    const price = await calculateRentalPrice(ctx, {
      ...a, customer: { email: a.customerEmail },
    });
    return {
      items: price.items.map((item) => ({ title: item.title, total: item.total })),
      subtotal: price.subtotal,
      depositHoldAmount: price.depositHoldAmount,
      depositAmount: price.depositAmount,
      quotedDeliveryFee: price.quotedDeliveryFee,
      deliveryFee: price.deliveryFee,
      reductionLabel: price.reductionLabel,
      totalReduction: price.totalReduction,
      creditApplied: price.creditApplied,
      totalDue: price.totalDue,
    };
  },
});

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
    deliveryPostcode: v.optional(v.string()),
    deliveryFee: v.number(),
    expectedTotalDue: v.number(),
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
  },
  handler: async (ctx, a): Promise<{ url: string }> => {
    if (a.items.length === 0) throw new Error("empty cart");
    if (a.items.some((item) => item.qty !== 1 || !Number.isSafeInteger(item.start) ||
        !Number.isSafeInteger(item.end) || item.end < item.start))
      throw new Error("Each rental line must be one item with valid dates. Please refresh your basket.");
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

    // Recompute exactly what the renter reviewed, using current listing and account data.
    const price = await calculateRentalPrice(ctx, a);
    a.items = price.items;

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

    const {
      acct, month, freedCount, subtotal, protection, depositHoldAmount, depositAmount,
      appliedCode, totalReduction, reductionLabel, deliveryFee, totalBeforeCredit: total,
    } = price;
    a.customer.email = price.customerEmail;
    const idVerifyStatus = "required";
    if (!Number.isSafeInteger(Math.round(a.expectedTotalDue * 100)) ||
        Math.round(a.expectedTotalDue * 100) !== Math.round(price.totalDue * 100))
      throw new Error("Your rental total has changed. Review the updated order summary before paying.");

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
        dailyRate: price.items[idx]?.dailyRate,
      })),
      subtotal,
      depositAmount,
      depositHoldAmount,
      promoCode: appliedCode,
      discount: totalReduction,
      total,
      expectedTotalDue: a.expectedTotalDue,
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

    // Reserve the units while Stripe resolves payment. The 35-minute marker is
    // only for cleaning up orphaned rows after a terminal provider outcome;
    // pending bookings keep their holds until reconciliation confirms or expires them.
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
      // Stripe defaults to a 24h session. Limit this to 31 minutes, while
      // the reservation stays protected until Stripe confirms its outcome.
      expires_at: Math.floor(Date.now() / 1000) + 31 * 60,
      line_items,
      payment_method_configuration: paymentConfigId,
      discounts,
      ...(stripeCustomerId
        ? { customer: stripeCustomerId }
        : { customer_email: a.customer.email, customer_creation: "always" as const }),
      success_url: `${new URL(process.env.APP_URL!).origin}/checkout/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${new URL(process.env.APP_URL!).origin}/cart`,
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
        payment_method: paymentMethod, allowed_payment_method_types: ["card"],
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
    throw new Error("Ask the team in your rental conversation to add items. Only the rental owner can propose order changes.");
  },
});

/** Fulfil already-paid legacy sessions once, or refund when their rental/stock is closed. */
async function refundDuplicateCheckout(session:Stripe.Checkout.Session){
 const payment=typeof session.payment_intent==="string"?session.payment_intent:session.payment_intent?.id;
 if(session.payment_status!=="paid"||!payment)throw Error("Duplicate checkout payment is not confirmed");
 await stripe().refunds.create({payment_intent:payment},{idempotencyKey:`dbc-duplicate-rental-checkout-${session.id}`});
}

async function fulfillLegacyAddon(ctx:any,session:Stripe.Checkout.Session){
 const m=session.metadata??{};
 const paymentIntentId=typeof session.payment_intent==="string"?session.payment_intent:session.payment_intent?.id;
 if(session.payment_status!=="paid"||!paymentIntentId||session.currency!=="gbp"||!session.amount_total)throw Error("Legacy addition payment is not confirmed");
 const result=await ctx.runMutation(internal.bookings.attachAddon,{bookingId:m.addonBookingId as any,listingId:m.addonListingId as any,title:m.addonTitle??"Add-on",start:Number(m.addonStart),end:Number(m.addonEnd),total:session.amount_total/100,sessionId:session.id,paymentIntentId});
 if(result.closed)await stripe().refunds.create({payment_intent:paymentIntentId},{idempotencyKey:`dbc-closed-legacy-addition-${session.id}`});
 return result;
}

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
    const sources = b.paymentSources ?? (b.paymentIntentId ? [{paymentIntentId:b.paymentIntentId,securityPence:pence(deposit)}] : []);
    const capturedSecurity = sources.reduce((sum:number,source:any)=>sum+source.securityPence,0);
    const refundablePence = Math.min(pence(toRefund),capturedSecurity);
    if(refundablePence>0){for(const allocation of securityReturnPlan(sources,refundablePence))await stripe().refunds.create({payment_intent:allocation.paymentIntentId,amount:allocation.amountPence},{idempotencyKey:allocation.paymentIntentId===b.paymentIntentId?`dbc-deposit-release-${bookingId}`:`dbc-deposit-release-${bookingId}-${allocation.paymentIntentId}`});}
    const refunded = refundablePence / 100;
    await ctx.runMutation(internal.bookings.markDepositReleased, { bookingId, kept, refunded, capturedFromHold, note: damageNote?.trim() });
    await ctx.runMutation(internal.bookings.recordLateFee, { bookingId, actualReturnedAt: returned, ...late, ...waiver });
    return { ok: true, released: refunded, kept, lateAmount: late.amount, alreadyReleased: false };
  },
});

export const finalize = action({
  args: { sessionId: v.string() },
  handler: async (
    ctx,
    { sessionId },
  ): Promise<{ bookingId: string | null; paid: boolean; closed?: boolean; membership?: string; holdStatus?: string; holdClientSecret?: string;additionId?:string }> => {
    const session = await stripe().checkout.sessions.retrieve(sessionId);
    const m = session.metadata ?? {};
    const paid = session.payment_status === "paid";

    if(paid&&m.rentalAdditionId){const r=await ctx.runAction(internal.rentalAdditions.finalizePaid,{id:m.rentalAdditionId as any,sessionId});return {bookingId:r.bookingId,paid,closed:r.closed,holdStatus:r.status,holdClientSecret:r.clientSecret,additionId:m.rentalAdditionId};}
    if(paid&&m.pendingAdditionId){const r=await ctx.runAction(internal.rentalAdditions.finalizePaid,{id:m.pendingAdditionId as any,sessionId});if(r.closed)return {bookingId:r.bookingId,paid,closed:true};}

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
      const result=await fulfillLegacyAddon(ctx,session);
      return {bookingId:m.addonBookingId,paid,closed:result.closed};
    }

    // extend payment → apply the extra days to the targeted item(s)
    if (paid && m.changeRequestId) {
      const result=await ctx.runMutation(internal.changes._applyExtendPaid, { requestId: m.changeRequestId as any });
      if(result.closed&&session.payment_intent)await stripe().refunds.create({payment_intent:typeof session.payment_intent==="string"?session.payment_intent:session.payment_intent.id},{idempotencyKey:`dbc-closed-change-${m.changeRequestId}`});
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
      if (confirmation.closed) {if(confirmation.duplicatePayment)await refundDuplicateCheckout(session);return { bookingId, paid, closed: true };}
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

/** Stripe is authoritative for abandoned checkouts. A delayed webhook must
 * never cause a paid booking to be age-expired or its stock hold to be released. */
export const reconcilePendingPayments = internalAction({
  args: {},
  handler: async (ctx): Promise<{ checked: number; confirmed: number; expired: number; failures: number }> => {
    if (!process.env.STRIPE_SECRET_KEY) return { checked: 0, confirmed: 0, expired: 0, failures: 0 };
    const pending: { bookingId: any; sessionId: string | null; createdAt: number }[] =
      await ctx.runQuery(internal.bookings.pendingCheckoutSessions, {});
    const sb = stripe();
    const now = Date.now();
    let confirmed = 0, expired = 0, failures = 0;
    for (const booking of pending) {
      try {
        if (!booking.sessionId) {
          if (booking.createdAt < now - 45 * 60 * 1000 &&
              await ctx.runMutation(internal.bookings.expireUnpaidPending, { bookingId: booking.bookingId })) expired++;
          continue;
        }
        let session = await sb.checkout.sessions.retrieve(booking.sessionId);
        if (session.metadata?.bookingId !== booking.bookingId) {
          console.error("Checkout reconciliation found a booking/session mismatch", booking.bookingId);
          failures++;
          continue;
        }
        if (session.payment_status === "paid") {
          if(session.metadata?.pendingAdditionId){const addition=await ctx.runAction(internal.rentalAdditions.finalizePaid,{id:session.metadata.pendingAdditionId as any,sessionId:session.id});if(addition.closed){failures++;continue;}}
          const paymentIntentId = typeof session.payment_intent === "string"
            ? session.payment_intent : session.payment_intent?.id;
          const result = await ctx.runMutation(internal.bookings.confirm, {
            bookingId: booking.bookingId, paymentIntentId,
          });
          if (result.closed) {
            if(result.duplicatePayment)await refundDuplicateCheckout(session);
            console.error("Paid checkout was already closed", booking.bookingId);
            failures++;
            continue;
          }
          confirmed++;
          try { await authorizeHold(ctx, session); }
          catch (error) { console.error("Card hold authorization failed during reconciliation", error); }
          continue;
        }
        if (session.status === "open" && (session.created ? session.created * 1000 : booking.createdAt) < now - 45 * 60 * 1000)
          session = await sb.checkout.sessions.expire(session.id);
        if (session.status === "expired" && session.payment_status !== "paid" &&
            await ctx.runMutation(internal.bookings.expireUnpaidPending, {
              bookingId: booking.bookingId, sessionId: booking.sessionId,
            })) expired++;
        // A completed but unpaid session may still be processing; leave it pending.
      } catch (error) {
        console.error("Checkout reconciliation could not determine payment status", booking.bookingId, error);
        failures++;
      }
    }
    return { checked: pending.length, confirmed, expired, failures };
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
 *   1. In the Stripe dashboard, add a webhook endpoint for this deployment's
 *      /stripe-webhook path, including `checkout.session.completed` and
 *      `checkout.session.async_payment_succeeded`; copy its signing secret.
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
    if (event.type === "checkout.session.completed" || event.type === "checkout.session.async_payment_succeeded") {
      const s = event.data.object as Stripe.Checkout.Session;
      const m = s.metadata ?? {};
      const pi = typeof s.payment_intent === "string" ? s.payment_intent : undefined;
      if (s.payment_status === "paid") {
        if(m.rentalAdditionId){await ctx.runAction(internal.rentalAdditions.finalizePaid,{id:m.rentalAdditionId as any,sessionId:s.id});return true;}
        if(m.pendingAdditionId){const r=await ctx.runAction(internal.rentalAdditions.finalizePaid,{id:m.pendingAdditionId as any,sessionId:s.id});if(r.closed)return true;}
        if (m.bookingId) {
          const confirmation = await ctx.runMutation(internal.bookings.confirm, { bookingId: m.bookingId as any, paymentIntentId: pi });
          if (confirmation.closed) {if(confirmation.duplicatePayment)await refundDuplicateCheckout(s);return true;}
          try { await authorizeHold(ctx, s); }
          catch (e) { console.error("Card hold authorization failed", e); }
        } else if (m.addonBookingId) {
          await fulfillLegacyAddon(ctx,s);
        } else if (m.membershipTier) {
          await ctx.runMutation(internal.accounts._setMembership, {
            email: m.accountEmail ?? "", tier: m.membershipTier,
            subscriptionId: typeof s.subscription === "string" ? s.subscription : undefined,
          });
        } else if (m.changeRequestId) {
          const result=await ctx.runMutation(internal.changes._applyExtendPaid, { requestId: m.changeRequestId as any });
          if(result.closed&&pi)await stripe().refunds.create({payment_intent:pi},{idempotencyKey:`dbc-closed-change-${m.changeRequestId}`});
        }
      }
    }
    if (["refund.created","refund.updated","refund.failed"].includes(event.type)) {
      const refund=event.data.object as Stripe.Refund;
      const id=refund.metadata?.rentalRefundId;
      if(id)await ctx.runMutation(refund.metadata?.rentalPaymentIntent?internal.rentalOperations.recordRefundPart:internal.rentalOperations.recordRefund,{id:id as any,...(refund.metadata?.rentalPaymentIntent?{paymentIntentId:refund.metadata.rentalPaymentIntent}:{}),stripeRefundId:refund.id,status:refund.status==="succeeded"?"succeeded":refund.status==="failed"||refund.status==="canceled"?"failed":"pending"});
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

/**
 * Customer self-service cancellation (Phase 3). Gated behind CUSTOMER_BOOKING_ACTIONS=true.
 *  - At least CANCELLATION_FULL_REFUND_DAYS London days before start → full cash refund.
 *  - Closer to start → security payment refunded + CANCELLATION_CREDIT_DAYS-day store credit.
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

async function remainingCancellationPayment(payment: Stripe.PaymentIntent) {
  let refunded = 0;
  for await (const refund of stripe().refunds.list({payment_intent:payment.id,limit:100})) {
    if(refund.status!=="failed"&&refund.status!=="canceled")refunded+=refund.amount;
  }
  return Math.max(0,payment.amount_received-refunded);
}

async function cancelRental(ctx:any,bookingId:any,b:any,accountId?:any,adminReason?:string){
 const decision=await ctx.runMutation(internal.bookings.prepareCancellation,{bookingId});
 let quote=decision.quote;
 if(!quote){
  const paidIntentId=await paymentBeforeCancellation(b);
  let mode:"none"|"refund"|"credit"="none",refundAmount=0,creditAmount=0,allocations:any[]=[];
  if(paidIntentId){
   const sources=b.paymentSources?.length?b.paymentSources:[{paymentIntentId:paidIntentId,securityPence:pence(b.depositAmount)}];
   const balances=await Promise.all(sources.map(async(source:any)=>({...source,availablePence:await remainingCancellationPayment(await stripe().paymentIntents.retrieve(source.paymentIntentId))})));
   const settlement=cancellationPaymentPlan(decision.kind,balances,b.status==="confirmed"?pence(b.creditApplied??0):0);
   allocations=settlement.allocations;
   mode=decision.kind==="full_refund"?"refund":"credit";refundAmount=settlement.refundPence/100;creditAmount=settlement.creditPence/100;
   if(creditAmount>0&&!accountId)throw Error("The renter needs an account with their booking email before account credit can be issued. Resume this cancellation after account creation.");
  }
  quote=await ctx.runMutation(internal.bookings.recordCancellationQuote,{bookingId,quote:{mode,refundAmount,creditAmount,paymentIntentId:paidIntentId??undefined,allocations}});
 }
 for(const allocation of quote.allocations??(quote.paymentIntentId&&quote.refundAmount>0?[{paymentIntentId:quote.paymentIntentId,amountPence:pence(quote.refundAmount)}]:[]))await stripe().refunds.create({payment_intent:allocation.paymentIntentId,amount:allocation.amountPence},{idempotencyKey:allocation.paymentIntentId===quote.paymentIntentId?`dbc-cancel-refund-${bookingId}`:`dbc-cancel-refund-${bookingId}-${allocation.paymentIntentId}`});
 await releaseBookingHolds(ctx,bookingId,b);
 await ctx.runMutation(internal.bookings._finalizeCancellation,{bookingId,accountId,mode:quote.mode,refundAmount:quote.refundAmount,creditAmount:quote.creditAmount,currency:b.currency,adminReason});
 return {ok:true,mode:quote.mode,refundAmount:quote.refundAmount,creditAmount:quote.creditAmount};
}
export const cancelByAdmin = action({
 args:{token:v.string(),bookingId:v.id("bookings"),reason:v.string()},
 handler:async(ctx,{token,bookingId,reason}):Promise<{refundAmount:number;creditAmount:number;mode:string}>=>{
  await ctx.runMutation(internal.adminAuth.assertAdminInternal,{token,fn:"checkout.cancelByAdmin"});
  if(reason.trim().length<5)throw Error("Record the cancellation reason");
  const b:any=await ctx.runQuery(internal.bookings.getForCancel,{bookingId});
  if(!b||!["confirmed","pending_payment"].includes(b.status)||!b.siteOnly)throw Error("Only unstarted direct bookings can be cancelled here");
  return cancelRental(ctx,bookingId,b,b.accountId??undefined,reason.trim().slice(0,400));
 }
});
/** Abandoning an unpaid checkout remains available without enabling paid self-service actions. */
export const cancelUnpaidByCustomer = action({
 args:{token:v.string(),bookingId:v.id("bookings")},
 handler:async(ctx,{token,bookingId}):Promise<{ok:boolean;mode:string;refundAmount:number;creditAmount:number}>=>{
  const me:any=await ctx.runQuery(api.accounts.me,{token});if(!me)throw Error("Please sign in.");
  const b:any=await ctx.runQuery(internal.bookings.getForCancel,{bookingId});
  if(!b||(b.guestEmail??"").trim().toLowerCase()!==me.email.trim().toLowerCase())throw Error("unauthorized");
  if(b.status!=="pending_payment"||!b.siteOnly)throw Error("Only unpaid direct checkouts can be abandoned here.");
  return cancelRental(ctx,bookingId,b,me._id);
 }
});
export const cancelByCustomer = action({
 args:{token:v.string(),bookingId:v.id("bookings")},
 handler:async(ctx,{token,bookingId}):Promise<{ok:boolean;mode:string;refundAmount:number;creditAmount:number}>=>{
  if(process.env.CUSTOMER_BOOKING_ACTIONS!=="true")throw Error("Online cancellation isn't available yet — please contact us to cancel.");
  const me:any=await ctx.runQuery(api.accounts.me,{token});if(!me)throw Error("Please sign in.");
  const b:any=await ctx.runQuery(internal.bookings.getForCancel,{bookingId});
  if(!b||b.guestEmail!==me.email)throw Error("unauthorized");
  if(b.cancelledAt||b.status==="cancelled")throw Error("This booking is already cancelled.");
  if(!["confirmed","pending_payment"].includes(b.status)||!b.siteOnly)throw Error("Please contact us to change this booking.");
  return cancelRental(ctx,bookingId,b,me._id);
 }
});

/** Owner-only, durable and idempotent rental refund. Security is handled by return/cancel. */
export const refundRental=action({
 args:{token:v.string(),bookingId:v.id("bookings"),requestId:v.string(),amountPence:v.optional(v.number()),reason:v.string()},
 handler:async(ctx,args):Promise<{status:string;amount:number}>=>{
  const job:any=await ctx.runMutation(internal.rentalOperations.prepareRefund,args);
  if(job.status==="succeeded"||job.status==="failed")return {status:job.status,amount:job.amountPence/100};
  // Resume receipts produced by the previous single-payment implementation without charging again.
  if(job.stripeRefundId&&!job.allocations){
   const refund=await stripe().refunds.retrieve(job.stripeRefundId);
   const status=refund.status==="succeeded"?"succeeded":refund.status==="failed"||refund.status==="canceled"?"failed":"pending";
   await ctx.runMutation(internal.rentalOperations.recordRefund,{id:job._id,stripeRefundId:refund.id,status});
   return {status,amount:job.amountPence/100};
  }
  let allocations=job.allocations;
  if(!allocations){const sources=await ctx.runQuery(internal.rentalOperations.paymentSources,{bookingId:args.bookingId});const balances=await Promise.all(sources.map(async(source:any)=>({...source,availablePence:await remainingCancellationPayment(await stripe().paymentIntents.retrieve(source.paymentIntentId))})));allocations=await ctx.runMutation(internal.rentalOperations.bindRefundAllocations,{id:job._id,allocations:rentalRefundPlan(balances,job.amountPence)});}
  let status="succeeded";
  for(const allocation of allocations){const part=job.parts?.find((p:any)=>p.paymentIntentId===allocation.paymentIntentId);const refund=part?.stripeRefundId?await stripe().refunds.retrieve(part.stripeRefundId):await stripe().refunds.create({payment_intent:allocation.paymentIntentId,amount:allocation.amountPence,metadata:{rentalRefundId:job._id,rentalPaymentIntent:allocation.paymentIntentId,bookingId:args.bookingId}}, {idempotencyKey:allocation.paymentIntentId===allocations[0].paymentIntentId?`dbc-rental-refund-${job._id}`:`dbc-rental-refund-${job._id}-${allocation.paymentIntentId}`});const result=refund.status==="succeeded"?"succeeded":refund.status==="failed"||refund.status==="canceled"?"failed":"pending";if(result!=="succeeded")status=result;await ctx.runMutation(internal.rentalOperations.recordRefundPart,{id:job._id,paymentIntentId:allocation.paymentIntentId,stripeRefundId:refund.id,status:result});}
  return {status,amount:job.amountPence/100};
 }
});
