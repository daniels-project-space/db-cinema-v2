"use node";

import Stripe from "stripe";
import { rentalRefundBalance } from "./lib/rentalRefundBalance";
import { createHash } from "node:crypto";
import { action, internalAction } from "./_generated/server";
import { internal, api } from "./_generated/api";
import { v } from "convex/values";
import { inspectionInput } from "./lib/returnInspectionFields";
import { assertCreditOffer, creditOfferFingerprint } from "./lib/rentalCreditPolicy";
import { cancellationPaymentPlan,rentalRefundPlan,securityReturnPlan } from "./lib/rentalPaymentPlan";
import { lateFeeQuote } from "./lib/lateFee";
import { assertCurrentAgreement } from "../shared/rentalAgreement";
import { sendMail } from "./lib/mailer";
import { assertDiditCheckoutCapacity } from "./lib/diditCapacity";
import { tierByKey, allocateSaving, TIERS } from "./lib/membership";
import { cancellationSettlement } from "../src/lib/cancellationPolicy";
import { MEMBERSHIP_BASKET_MINIMUM } from "../shared/checkoutMembershipCredit";
import { calculateRentalPrice } from "./lib/rentalPrice";
import { paidRecurringMembership } from "./lib/membershipBilling";
import { MEMBERSHIP_TERMS_VERSION,membershipActiveNow,membershipTierFor } from "../shared/membership";

const pence = (gbp: number) => Math.round(gbp * 100);
const subActive = (status: string) => status === "active" || status === "trialing";

type PriceQuoteResult = {
  replacementValue: number;
  benefitKind:string;refundCreditApplied:number;earnedCreditApplied:number;
  items: { title: string; total: number }[];
  subtotal: number;
  depositHoldAmount: number;
  depositAmount: number;
  quotedDeliveryFee: number;
  deliveryFee: number;
  reductionLabel?: string;
  totalReduction: number;
  creditApplied: number;
  membershipCreditApplied: number;
  membershipNetSaving: number;
  membershipOffer: {tier:string;netSaving:number;state:"join"|"selected"|"current"}|null;
  membershipSignupOfferSaving: number;
  totalDue: number;
  deliveryReduction: number;
  securityWaiverReason?: string;
  weekendSaving: number;
  rentalSaving: number;
  loyaltySaving: number;
  membershipFee: number;
  combinedTotalDue: number;
  recommendations: {membershipSignupOfferSaving:number;intro:"trial"|"none";membershipCreditApplied:number;tier:string;name:string;monthlyFee:number;monthlyCredit:number;rentalSaving:number;deliverySaving:number;initialFee:number;netSaving:number;depositWaived:boolean}[];
};

/** Map a Stripe subscription back to one of our tier keys: price lookup_key (dbc_member_<key>,
 *  set by ensurePrice) first, then subscription metadata, then the monthly amount as a fallback. */
function tierKeyFromSub(sub: Stripe.Subscription): string | undefined {
  const price = sub.items?.data?.[0]?.price;
  const lk = price?.lookup_key ?? undefined;
  if (lk && lk.startsWith("dbc_member_v5_")) return lk.slice("dbc_member_v5_".length);
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
    selectedMembership: v.optional(v.object({tier:v.string(),intro:v.union(v.literal("trial"),v.literal("credit"),v.literal("none"))})),
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
    const base = a.selectedMembership ? await calculateRentalPrice(ctx, {...a, customer:{email:a.customerEmail}, selectedMembership:undefined}) : price;
    const netSaving = (preview: typeof price) => Math.round(((base.totalDue-base.depositAmount) - (preview.totalDue-preview.depositAmount+preview.membershipFee))*100)/100;
    const recommendations = membershipActiveNow(price.acct) ? [] : await Promise.all(TIERS.filter(tier => Math.round((base.subtotal-base.totalReduction+base.deliveryFee)*100) >= MEMBERSHIP_BASKET_MINIMUM[tier.key]*100).map(async tier => {
      const intros: ("trial"|"none")[] = ["none"];
      const offers = await Promise.all(intros.map(async intro => {
        const preview = await calculateRentalPrice(ctx, {...a, customer:{email:a.customerEmail}, selectedMembership:{tier:tier.key,intro}});
        const rentalSaving = Math.round((base.subtotal-base.totalReduction-preview.subtotal+preview.totalReduction)*100)/100;
        const deliverySaving = base.deliveryFee-preview.deliveryFee;
        return {tier:tier.key,intro,membershipSignupOfferSaving:preview.membershipSignupOfferSaving,name:tier.name,monthlyFee:tier.monthlyGbp,monthlyCredit:tier.monthlyCredit,rentalSaving,deliverySaving,initialFee:preview.membershipFee,membershipCreditApplied:preview.membershipCreditApplied,netSaving:netSaving(preview),depositWaived:preview.depositAmount===0};
      }));
      return offers.sort((x,y)=>y.netSaving-x.netSaving)[0];
    }));
    recommendations.sort((x,y)=>Number(y.netSaving>0)-Number(x.netSaving>0)||MEMBERSHIP_BASKET_MINIMUM[y.tier]-MEMBERSHIP_BASKET_MINIMUM[x.tier]);
    const membershipNetSaving = a.selectedMembership ? netSaving(price) : Math.round((price.rentalSaving + price.deliveryReduction + (membershipActiveNow(price.acct) ? price.earnedCreditApplied : 0))*100)/100;
    const recommended = recommendations.find(offer => offer.netSaving > 0);
    const activeTier = membershipActiveNow(price.acct) ? TIERS.find(tier => tier.key === membershipTierFor(price.acct)) : undefined;
    // Keep the exact displayed offer attached to the quote that calculated it.
    // The client must not infer quote identity from the monthly fee or account hydration.
    const membershipOffer: PriceQuoteResult["membershipOffer"] = a.selectedMembership
      ? {tier:a.selectedMembership.tier,netSaving:membershipNetSaving,state:"selected"}
      : activeTier
        ? {tier:activeTier.key,netSaving:membershipNetSaving,state:"current"}
        : recommended ? {tier:recommended.tier,netSaving:recommended.netSaving,state:"join"} : null;
    return {
      recommendations,
      membershipOffer,
      replacementValue: price.replacementSum,
      // Renewed membership credit is stored as earned credit. Count what is
      // actually applied to this rental, never the monthly allowance or refunds.
      membershipNetSaving,
      membershipCreditApplied: price.membershipCreditApplied,
      membershipSignupOfferSaving: price.membershipSignupOfferSaving,
      items: price.items.map((item) => ({ title: item.title, total: item.total })),
      subtotal: price.subtotal,
      depositHoldAmount: price.depositHoldAmount,
      depositAmount: price.depositAmount,
      quotedDeliveryFee: price.quotedDeliveryFee,
      deliveryFee: price.deliveryFee,
      reductionLabel: price.reductionLabel,
      totalReduction: price.totalReduction,
      benefitKind: price.benefitKind,
      refundCreditApplied: price.refundCreditApplied,
      earnedCreditApplied: price.earnedCreditApplied,
      creditApplied: price.creditApplied,
      totalDue: price.totalDue,
      deliveryReduction: price.deliveryReduction,
      securityWaiverReason: price.securityWaiverReason,
      weekendSaving: price.weekendSaving,
      rentalSaving: price.rentalSaving,
      loyaltySaving: price.loyaltySaving,
      membershipFee: price.membershipFee,
      combinedTotalDue: price.combinedTotalDue,
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
    selectedMembership: v.optional(v.object({tier:v.string(),intro:v.union(v.literal("trial"),v.literal("credit"),v.literal("none")),termsVersion:v.string(),requestId:v.string()})),
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
        requestId: v.optional(v.string()),
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
    assertCurrentAgreement(a.agreement, a.fulfilment);
    if (!a.agreement?.requestId) throw Error("Review and sign this booking before paying.");

    await assertDiditCheckoutCapacity(
      process.env.DIDIT_API_KEY!,
      process.env.DIDIT_WORKFLOW_ID!,
      process.env.DIDIT_ENVIRONMENT!,
      process.env.DIDIT_MAX_WORKFLOW_PRICE_USD,
    );

    if (a.selectedMembership && /^[A-Za-z0-9_-]{32,100}$/.test(a.selectedMembership.requestId)) {
      const existing: any = await ctx.runQuery(internal.membershipBenefits.byRequest,{requestId:a.selectedMembership.requestId,email:a.customer.email});
      if (existing?.sessionId) {
        const session = await stripe().checkout.sessions.retrieve(existing.sessionId);
        if (session.status === "open" && session.url) return {url:session.url};
        throw Error("This membership checkout is no longer open.");
      }
      if (existing?.sessionParams) {
        const session = await stripe().checkout.sessions.create(JSON.parse(existing.sessionParams),{idempotencyKey:`dbc-member-checkout-${existing._id}`});
        await ctx.runMutation(internal.membershipBenefits.bindCheckout,{id:existing._id,sessionId:session.id,bookingId:existing.bookingId});
        await ctx.runMutation(internal.bookings.bindCheckoutSession,{bookingId:existing.bookingId,sessionId:session.id});
        if (!session.url) throw Error("Stripe did not return a checkout URL");
        return {url:session.url};
      }
    }

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
      acct: pricedAccount, month, freedCount, subtotal, protection, depositHoldAmount, depositAmount,
      appliedCode, totalReduction, reductionLabel, deliveryFee, totalBeforeCredit: total,
    } = price;
    let acct = pricedAccount;
    let membershipCheckout: any = null;
    if (a.selectedMembership) {
      if (a.selectedMembership.termsVersion !== MEMBERSHIP_TERMS_VERSION || !/^[A-Za-z0-9_-]{32,100}$/.test(a.selectedMembership.requestId)) throw Error("Accept the membership terms and refresh your checkout.");
      if (!acct) acct = await ctx.runMutation(internal.membershipBenefits.bootstrapCheckoutAccount, {email:price.customerEmail,name:a.customer.name!,seedHash:createHash("sha256").update(a.selectedMembership.requestId).digest("hex")});
      membershipCheckout = await ctx.runMutation(internal.membershipBenefits.reserveCheckout, {accountId:acct._id,tier:a.selectedMembership.tier,intro:a.selectedMembership.intro,requestId:a.selectedMembership.requestId,termsVersion:a.selectedMembership.termsVersion});
      if (membershipCheckout.sessionId) {
        const existing = await stripe().checkout.sessions.retrieve(membershipCheckout.sessionId);
        if (existing.status === "open" && existing.url) return {url:existing.url};
        throw Error("Your membership checkout is no longer open.");
      }
    }
    a.customer.email = price.customerEmail;
    const idVerifyStatus = "required";
    if (!Number.isSafeInteger(Math.round(a.expectedTotalDue * 100)) ||
        Math.round(a.expectedTotalDue * 100) !== Math.round(price.combinedTotalDue * 100))
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
    const { bookingId, creditApplied, reused, sessionId: existingSessionId } = await ctx.runMutation(internal.bookings.createPending, {
      pricingVersion:price.pricingVersion,benefitKind:price.benefitKind,
      refundCreditApplied:price.refundCreditApplied,earnedCreditApplied:price.earnedCreditApplied,
      referralCode:price.referralCode,referralRewardId:price.referralRewardId,
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
      securityPolicyVersion: price.securityPolicyVersion,
      promoCode: appliedCode,
      discount: totalReduction,
      total,
      expectedTotalDue: price.totalDue,
      membershipCreditApplied: price.membershipCreditApplied,
      membershipSignupOfferSaving: price.membershipSignupOfferSaving,
      weekendSaving: price.weekendSaving,
      loyaltySaving: price.loyaltySaving,
      quotedDeliveryFee: price.quotedDeliveryFee,
      membershipCheckoutId: membershipCheckout?._id,
      accountAccessRequired: !pricedAccount,
      accountId: acct?._id,
      creditAccountId: acct?._id,
      deliveryBenefitMonth: price.deliveryBenefitMonth,
      securityWaiverReason: price.securityWaiverReason,
      repeatSourceBookingId: price.repeatSourceBookingId,
      repeatSourceFingerprint: price.repeatSourceFingerprint,
      currency: "GBP",
      agreementName: a.agreement?.name,
      agreementRequestId: a.agreement?.requestId,
      securityHoldConsent: a.agreement?.securityHoldConsent,
      laterChargeConsent: a.agreement?.laterChargeConsent,
      agreementDocs: a.agreement?.documents,
      protection,
      idVerifyStatus,
      verificationProvider: "didit",
      pickupTime: a.pickupTime,
      returnTime: a.returnTime,
    });
    if (reused) {
      if (!existingSessionId) throw Error("This checkout is still pending reconciliation. Do not submit a second acceptance or payment.");
      const existingSession = await sb.checkout.sessions.retrieve(existingSessionId);
      if (existingSession.status !== "open" || !existingSession.url) throw Error("This checkout has completed or expired. Use the existing booking or contact us.");
      return {url:existingSession.url};
    }

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
              "Refundable security deposit (refunded after safe return and settlement)",
          },
        },
      });
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

    // Apply rental discounts and first-month credit only to rental lines.
    // Other account credit can cover remaining rental/delivery, never security.
    // This applies to every checkout, including referrals without membership.
    const rentalNet=allocateSaving(a.items.map(i=>i.total),totalReduction+price.membershipCreditApplied);
    const eligibleNet=[...rentalNet,...(deliveryFee?[deliveryFee]:[])];
    const net=allocateSaving(eligibleNet,creditApplied-price.membershipCreditApplied);
    let checkoutLines:Stripe.Checkout.SessionCreateParams.LineItem[]=line_items.slice(0,eligibleNet.length).map((line,index)=>({...line,price_data:{...line.price_data!,unit_amount:pence(net[index])}}));
    if(depositAmount>0)checkoutLines.push(line_items[line_items.length-1]);
    checkoutLines=checkoutLines.filter(l=>(l.price_data?.unit_amount??0)>0);
    if(membershipCheckout)checkoutLines.push({price:await ensurePrice(sb,tierByKey(membershipCheckout.tier)!),quantity:1});
    const meta = {bookingId,rentalPaidPence:String(pence(price.totalDue)),...(membershipCheckout ? {membershipTier:membershipCheckout.tier,accountEmail:acct.email,membershipCheckoutId:String(membershipCheckout._id),membershipTerms:MEMBERSHIP_TERMS_VERSION}: {})};
    const sessionParams: Stripe.Checkout.SessionCreateParams = {
      mode: membershipCheckout ? "subscription" : price.totalDue === 0 ? "setup" : "payment",
      ...(!membershipCheckout&&price.totalDue===0?{currency:"gbp"}:{}),
      ...(membershipCheckout || price.totalDue > 0 ? {adaptive_pricing:{enabled:false}} : {}),
      expires_at: Math.floor(Date.now() / 1000) + 31 * 60,
      ...(membershipCheckout || price.totalDue > 0 ? {line_items:checkoutLines} : {}), payment_method_configuration: paymentConfigId,
      ...(membershipCheckout ? {payment_method_collection:"always" as const,subscription_data:{metadata:meta,...(membershipCheckout.intro === "trial" ? {trial_period_days:7} : {})}} : price.totalDue > 0 ? {payment_intent_data:{metadata:{bookingId},setup_future_usage:"off_session" as const}} : {setup_intent_data:{metadata:{bookingId}}}),
      ...(stripeCustomerId ? {customer:stripeCustomerId} : {customer_email:a.customer.email,customer_creation:"always" as const}),
      success_url: `${new URL(process.env.APP_URL!).origin}/checkout/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${new URL(process.env.APP_URL!).origin}/cart`, metadata:meta,
    };
    if (membershipCheckout) await ctx.runMutation(internal.membershipBenefits.saveSessionParams,{id:membershipCheckout._id,bookingId,sessionParams:JSON.stringify(sessionParams)});
    let session:Stripe.Checkout.Session;
    try{session=await sb.checkout.sessions.create(sessionParams,membershipCheckout ? {idempotencyKey:`dbc-member-checkout-${membershipCheckout._id}`} : undefined);}
    catch(error){if(error instanceof Stripe.errors.StripeInvalidRequestError)await ctx.runMutation(internal.bookings.checkoutCreationRejected,{bookingId});throw error;}
    if (membershipCheckout) await ctx.runMutation(internal.membershipBenefits.bindCheckout,{id:membershipCheckout._id,sessionId:session.id,bookingId});

    if (!session.url) throw new Error("Stripe did not return a checkout URL");
    await ctx.runMutation(internal.bookings.bindCheckoutSession, { bookingId, sessionId: session.id });
    return { url: session.url };
  },
});

function checkoutCompleted(session: Stripe.Checkout.Session) {
  return session.payment_status === "paid" || (session.status === "complete" && session.payment_status === "no_payment_required");
}
/** New Stripe versions expose invoice payments separately from the Checkout Session. */
export async function checkoutPaymentIntent(session: Stripe.Checkout.Session): Promise<string | undefined> {
  if (session.payment_intent) return typeof session.payment_intent === "string" ? session.payment_intent : session.payment_intent.id;
  const invoiceId = typeof session.invoice === "string" ? session.invoice : session.invoice?.id;
  if (!invoiceId) return;
  const payments = await stripe().invoicePayments.list({ invoice: invoiceId, status: "paid", limit: 100 });
  const intents = payments.data.filter(p => p.payment.type === "payment_intent" && p.payment.payment_intent).map(p => typeof p.payment.payment_intent === "string" ? p.payment.payment_intent : p.payment.payment_intent!.id);
  if (intents.length > 1) throw Error("This invoice has multiple payments and needs financial reconciliation before rental confirmation.");
  return intents[0];
}

/** A separate manual-capture PaymentIntent is required for an actual card hold.
 * Checkout saves the card for off-session use, then this attempts the hold immediately.
 * Issuer authentication is still possible; the success page handles that in the same flow. */
async function authorizeHold(ctx: any, session: Stripe.Checkout.Session): Promise<{ status: string; clientSecret?: string }> {
  const bookingId = session.metadata?.bookingId;
  if (!bookingId || !checkoutCompleted(session)) return { status: "not_applicable" };
  const b: any = await ctx.runQuery(internal.bookings.holdContext, { bookingId: bookingId as any });
  if (!b || !b.amount || !["confirmed", "active"].includes(b.status)) return { status: "not_applicable" };
  const sb = stripe();
  let intent: Stripe.PaymentIntent;
  if (b.intentId) {
    intent = await sb.paymentIntents.retrieve(b.intentId, { expand: ["latest_charge"] });
  } else {
    const paymentId = await checkoutPaymentIntent(session);
    const customerId = typeof session.customer === "string" ? session.customer : session.customer?.id;
    if (!customerId) return { status: "failed" };
    let paymentMethod: string | undefined;
    if (paymentId) {
      const paidIntent = await sb.paymentIntents.retrieve(paymentId);
      paymentMethod = typeof paidIntent.payment_method === "string" ? paidIntent.payment_method : paidIntent.payment_method?.id;
    }
    if (!paymentMethod && session.setup_intent) {
      const setup = await sb.setupIntents.retrieve(typeof session.setup_intent === "string" ? session.setup_intent : session.setup_intent.id);
      if (setup.status === "succeeded") paymentMethod = typeof setup.payment_method === "string" ? setup.payment_method : setup.payment_method?.id;
    }
    if (!paymentMethod && session.subscription) {
      const sub = await sb.subscriptions.retrieve(typeof session.subscription === "string" ? session.subscription : session.subscription.id);
      paymentMethod = typeof sub.default_payment_method === "string" ? sub.default_payment_method : sub.default_payment_method?.id;
      if (!paymentMethod && sub.pending_setup_intent) {
        const setup = await sb.setupIntents.retrieve(typeof sub.pending_setup_intent === "string" ? sub.pending_setup_intent : sub.pending_setup_intent.id);
        if (setup.status === "succeeded") paymentMethod = typeof setup.payment_method === "string" ? setup.payment_method : setup.payment_method?.id;
      }
    }
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
 const payment=await checkoutPaymentIntent(session);
 if(session.payment_status!=="paid"||!payment)throw Error("Duplicate checkout payment is not confirmed");
 const amount=session.metadata?.rentalPaidPence !== undefined ? Number(session.metadata.rentalPaidPence) : undefined;
 if(amount!==undefined&&(!Number.isSafeInteger(amount)||amount<0))throw Error("Invalid rental refund allocation.");
 if(amount!==0)await stripe().refunds.create({payment_intent:payment,...(amount!==undefined?{amount}:{})},{idempotencyKey:`dbc-duplicate-rental-checkout-${session.id}`});
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
  const lookup = `dbc_member_v5_${tier.key}`;
  const existing = await sb.prices.list({ lookup_keys: [lookup], active: true, limit: 1 });
  if (existing.data[0]?.unit_amount === pence(tier.monthlyGbp) && existing.data[0].currency === "gbp" && existing.data[0].recurring?.interval === "month") return existing.data[0].id;
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
  args: { token: v.string(), tier: v.string(), origin: v.string(), intro: v.optional(v.union(v.literal("trial"), v.literal("credit"), v.literal("none"))), termsVersion: v.optional(v.string()), requestId: v.optional(v.string()) },
  handler: async (ctx, a): Promise<{ url: string }> => {
    const acct: any = await ctx.runQuery(internal.accounts._byToken, { token: a.token });
    if (!acct) throw new Error("Please sign in to subscribe.");
    const tier = tierByKey(a.tier);
    if (!tier) throw new Error("Unknown plan.");
    if (a.termsVersion !== MEMBERSHIP_TERMS_VERSION) throw Error("Accept the membership terms before subscribing.");
    const base = checkoutOrigin(a.origin);
    const reservation: any = await ctx.runMutation(internal.membershipBenefits.reserveCheckout, {
      accountId: acct._id, tier: tier.key, intro: a.intro ?? "none", requestId: a.requestId ?? crypto.randomUUID(), termsVersion: a.termsVersion,
    });
    const sb = stripe();
    if (reservation.sessionId) {
      const existing = await sb.checkout.sessions.retrieve(reservation.sessionId);
      if (existing.status === "open" && existing.url) return { url: existing.url };
      throw Error("This membership checkout is no longer open.");
    }
    try {
      let customerId = acct.stripeCustomerId;
      if (!customerId) {
        const c = await sb.customers.create({ email: acct.email, name: acct.name ?? undefined }, { idempotencyKey: `dbc-member-customer-${acct._id}` });
        customerId = c.id;
        await ctx.runMutation(internal.accounts._setStripeCustomer, { email: acct.email, customerId });
      }
      const priceId = await ensurePrice(sb, tier);
      const metadata = { membershipTier: tier.key, accountEmail: acct.email, membershipCheckoutId: String(reservation._id), membershipTerms: MEMBERSHIP_TERMS_VERSION };
      const session = await sb.checkout.sessions.create({
        adaptive_pricing: {enabled:false},
        mode: "subscription", line_items: [{ price: priceId, quantity: 1 }], customer: customerId,
        expires_at: Math.floor(reservation.createdAt / 1000) + 31 * 60,
        success_url: `${base}/checkout/success?session_id={CHECKOUT_SESSION_ID}`, cancel_url: `${base}/membership`,
        metadata, subscription_data: { metadata, ...(reservation.intro === "trial" ? { trial_period_days: 7 } : {}) },
        payment_method_collection: "always",
      }, { idempotencyKey: `dbc-member-checkout-${reservation._id}` });
      await ctx.runMutation(internal.membershipBenefits.bindCheckout, { id: reservation._id, sessionId: session.id });
      if (!session.url) throw Error("Stripe did not return a checkout URL");
      return { url: session.url };
    } catch (e) {
      // Keep the reservation on an ambiguous provider failure: a retry must reuse the same idempotency key.
      throw e;
    }
  },
});

function checkoutOrigin(origin: string) {
  const configured = new URL(process.env.APP_URL ?? "https://dbcinemarentals.com").origin;
  const requested = new URL(origin).origin;
  if (requested !== configured && !(process.env.STRIPE_SECRET_KEY?.startsWith("sk_test_") && /^https?:\/\/localhost(?::\d+)?$/.test(requested))) throw Error("Invalid checkout origin.");
  return requested;
}

async function syncStripeMembership(ctx: any, sub: Stripe.Subscription, checkoutId?: string) {
  const tier = tierKeyFromSub(sub);
  const email = sub.metadata.accountEmail;
  if (!tier || !email) return;
  const acct: any = await ctx.runQuery(internal.accounts._byEmail, { email });
  const customerId = typeof sub.customer === "string" ? sub.customer : sub.customer.id;
  // Shared Stripe accounts deliver events for other projects/deployments too.
  if (!acct) return;
  if (acct.stripeCustomerId !== customerId) throw Error("Stripe membership customer does not match the account.");
  let paidThrough: number | undefined;
  const latestId=typeof sub.latest_invoice === "string" ? sub.latest_invoice : sub.latest_invoice?.id;
  if(sub.status === "active" && latestId){
    const invoice=await stripe().invoices.retrieve(latestId);
    if(invoice.status === "paid" && invoice.amount_paid > 0){
      const recurring:Stripe.InvoiceLineItem[]=[];
      for await(const line of stripe().invoices.listLineItems(invoice.id,{limit:100})) if(line.parent?.type === "subscription_item_details" && !line.parent.subscription_item_details?.proration && line.amount>0 && sub.items.data.some(i=>i.id===line.parent?.subscription_item_details?.subscription_item))recurring.push(line);
      if(recurring.length)paidThrough=Math.max(...recurring.map(l=>l.period.end))*1000;
    }
  }
  await ctx.runMutation(internal.membershipBenefits.syncSubscription, {
    accountId: acct._id, subscriptionId: sub.id, tier, status: sub.status, subscriptionCreatedAt: sub.created * 1000,
    trialEnd: sub.trial_end ? sub.trial_end * 1000 : undefined, cancelAtPeriodEnd: sub.cancel_at_period_end, paidThrough,
    ...(checkoutId && ["active","trialing"].includes(sub.status) ? { checkoutId } : {}),
  });
  return acct;
}

async function grantStripeMembershipInvoice(ctx: any, invoice: Stripe.Invoice, sub: Stripe.Subscription) {
  const acct: any = await ctx.runQuery(internal.accounts._byEmail, { email: sub.metadata.accountEmail ?? "" });
  if (!acct || acct.stripeSubscriptionId !== sub.id) return;
  const lines: Stripe.InvoiceLineItem[] = [];
  for await (const line of stripe().invoices.listLineItems(invoice.id, { limit: 100 })) lines.push(line);
  const grant = paidRecurringMembership(invoice, lines, sub);
  if (grant) {
    await ctx.runMutation(internal.membershipBenefits.grantPaidInvoice, { accountId: acct._id, subscriptionId: sub.id, invoiceId: invoice.id, ...(invoice.billing_reason === "subscription_create" && sub.metadata.membershipCheckoutId ? {checkoutId:sub.metadata.membershipCheckoutId as any} : {}), ...grant });
    await reconcileMembershipCreditNotes(ctx,invoice,sub);
  }
}

async function reconcileMembershipCreditNotes(ctx:any, invoice:Stripe.Invoice, sub:Stripe.Subscription) {
  const lines:Stripe.InvoiceLineItem[]=[];
  for await (const line of stripe().invoices.listLineItems(invoice.id,{limit:100})) lines.push(line);
  const memberItems=new Set(sub.items.data.map(i=>i.id));
  const memberLines=new Set(lines.filter(l=>l.parent?.type==="subscription_item_details"&&!l.parent.subscription_item_details?.proration&&memberItems.has(l.parent.subscription_item_details?.subscription_item??"")).map(l=>l.id));
  let refunded=0;
  for await (const note of stripe().creditNotes.list({invoice:invoice.id,limit:100})) {
    if(note.status!=="issued")continue;
    for await (const line of stripe().creditNotes.listLineItems(note.id,{limit:100})) if(line.invoice_line_item&&memberLines.has(line.invoice_line_item))refunded+=line.amount;
  }
  if(refunded>0)await ctx.runMutation(internal.membershipBenefits.revokeRefundedInvoice,{invoiceId:invoice.id,membershipRefundedPence:refunded});
}

async function reconcileFullyRefundedMembership(ctx:any, refund:Stripe.Refund) {
  if(refund.status!=="succeeded"||!refund.payment_intent)return;
  const pi=await stripe().paymentIntents.retrieve(typeof refund.payment_intent==="string"?refund.payment_intent:refund.payment_intent.id);
  let refunded=0;for await(const r of stripe().refunds.list({payment_intent:pi.id,limit:100}))if(r.status==="succeeded")refunded+=r.amount;
  if(refunded<pi.amount_received)return;
  const payments=await stripe().invoicePayments.list({payment:{type:"payment_intent",payment_intent:pi.id},status:"paid",limit:100});
  for(const p of payments.data){const id=typeof p.invoice==="string"?p.invoice:p.invoice.id;const invoice=await stripe().invoices.retrieve(id);const parent=invoice.parent?.subscription_details?.subscription;const subId=typeof parent==="string"?parent:parent?.id;if(!subId)continue;const sub=await stripe().subscriptions.retrieve(subId);const lines:Stripe.InvoiceLineItem[]=[];for await(const line of stripe().invoices.listLineItems(id,{limit:100}))lines.push(line);const grant=paidRecurringMembership(invoice,lines,sub);if(grant)await ctx.runMutation(internal.membershipBenefits.revokeRefundedInvoice,{invoiceId:id,membershipRefundedPence:grant.paidMembershipPence});}
}

async function fulfillMembership(ctx: any, session: Stripe.Checkout.Session) {
  const subId = typeof session.subscription === "string" ? session.subscription : session.subscription?.id;
  if (!subId || !session.metadata?.membershipTier || session.status !== "complete") return;
  const sub = await stripe().subscriptions.retrieve(subId);
  await syncStripeMembership(ctx, sub, session.metadata.membershipCheckoutId);
  const invoiceId = typeof session.invoice === "string" ? session.invoice : session.invoice?.id;
  if (invoiceId) await grantStripeMembershipInvoice(ctx, await stripe().invoices.retrieve(invoiceId), sub);
}

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
      return_url: `${checkoutOrigin(a.origin)}/account`,
    });
    return { url: ps.url };
  },
});

/** Admin: mark a rental RETURNED and release its security deposit in one step. Pass damageKept to
 *  retain part of the deposit for damage (that portion stays captured; the rest is refunded to the
 *  card). Idempotent — the depositRefunded flag plus a Stripe idempotency key prevent a double refund. */
export const markReturned = action({
  args: { token: v.string(), bookingId: v.id("bookings"), damageKept: v.optional(v.number()), damageNote: v.optional(v.string()), actualReturnedAt: v.optional(v.number()), chargeLate: v.boolean(), lateWaiverReason: v.optional(v.string()), inspection: v.optional(v.array(inspectionInput)) },
  handler: async (
    ctx,
    { token, bookingId, damageKept, damageNote, actualReturnedAt, chargeLate, lateWaiverReason, inspection },
  ): Promise<{ ok: boolean; released: number; kept: number; lateAmount: number; alreadyReleased: boolean }> => {
    await ctx.runMutation(internal.adminAuth.assertAdminInternal, { token, fn: "checkout.markReturned" });
    const b: any = await ctx.runQuery(internal.bookings.getForRefund, { bookingId });
    if (!b) throw new Error("Booking not found.");
    if(!["confirmed","active","returned"].includes(b.status))throw Error("Booking is not available for return.");
    const returned = actualReturnedAt ?? Date.now();
    if (!Number.isFinite(returned) || returned > Date.now() + 60000 || (returned < Date.now() - 45 * 86400000 && returned !== b.returnDecision?.actualReturnedAt))
      throw new Error("Actual return time must be within the last 45 days.");
    if(b.returnDecision && (b.returnDecision.actualReturnedAt!==returned || b.returnDecision.damageKept!==(damageKept??0) || (b.returnDecision.damageNote??"")!==(damageNote??"") || b.returnDecision.chargeLate!==chargeLate || (b.returnDecision.lateWaiverReason??"")!==(lateWaiverReason??"")))throw Error("Resume the saved return decision; its amounts and return time cannot be changed during settlement.");
    const quotedLate = lateFeeQuote(b.lineItems, b.returnTime, returned);
    if (!chargeLate && quotedLate.amount > 0 && (lateWaiverReason ?? "").trim().length < 5)
      throw new Error("Record why the calculated late rental time is being waived.");
    const late = chargeLate ? quotedLate : { amount: 0, breakdown: [] };
    const waiver = !chargeLate && quotedLate.amount > 0
      ? { waivedAmount: quotedLate.amount, waiverReason: lateWaiverReason?.trim() } : {};
    if ((damageKept ?? 0) > 0 && (!damageNote || damageNote.trim().length < 10))
      throw new Error("Record the evidence and reason for a damage deduction.");
    if(!inspection && !b.returnDecision)throw Error("Inspect every individual item before settling this rental.");
    if (inspection) await ctx.runQuery(internal.returnInspections.validate, { bookingId, inspection, damage: damageKept ?? 0 });
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
      inspection,
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
    const paid = checkoutCompleted(session);
    if(m.filmFundEntryId){const r=await ctx.runAction(internal.filmFundPayments.fulfill,{sessionId});return {bookingId:null,paid:r.paid};}

    if(paid&&m.rentalAdditionId){const r=await ctx.runAction(internal.rentalAdditions.finalizePaid,{id:m.rentalAdditionId as any,sessionId});return {bookingId:r.bookingId,paid,closed:r.closed,holdStatus:r.status,holdClientSecret:r.clientSecret,additionId:m.rentalAdditionId};}
    if(paid&&m.pendingAdditionId){const r=await ctx.runAction(internal.rentalAdditions.finalizePaid,{id:m.pendingAdditionId as any,sessionId});if(r.closed)return {bookingId:r.bookingId,paid,closed:true};}

    if (m.membershipTier && session.status === "complete") {
      await fulfillMembership(ctx, session);
      if (!m.bookingId) return { bookingId: null, paid: paid || session.payment_status === "no_payment_required", membership: m.membershipTier };
    }

    // add-on payment → attach to the existing booking
    if (paid && m.addonBookingId) {
      const result=await fulfillLegacyAddon(ctx,session);
      return {bookingId:m.addonBookingId,paid,closed:result.closed};
    }

    // extend payment → apply the extra days to the targeted item(s)
    if (paid && m.changeRequestId) {
      return ctx.runAction(internal.rentalExtensionPayments.finalize, { sessionId: session.id });
    }

    const bookingId = (m.bookingId as string) ?? null;
    if (paid && bookingId) {
      const confirmation = await ctx.runMutation(internal.bookings.confirm, {
        bookingId: bookingId as any,
        paymentIntentId: await checkoutPaymentIntent(session),
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
    if (!checkoutCompleted(session) || !session.metadata?.bookingId)
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
        if (checkoutCompleted(session)) {
          if(session.metadata?.pendingAdditionId){const addition=await ctx.runAction(internal.rentalAdditions.finalizePaid,{id:session.metadata.pendingAdditionId as any,sessionId:session.id});if(addition.closed){failures++;continue;}}
          if (session.metadata?.membershipTier) await fulfillMembership(ctx, session);
          const paymentIntentId = await checkoutPaymentIntent(session);
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
      if(m.filmFundEntryId){await ctx.runAction(internal.filmFundPayments.fulfill,{sessionId:s.id});return true;}
      const pi = await checkoutPaymentIntent(s);
      if (m.membershipTier) await fulfillMembership(ctx, await stripe().checkout.sessions.retrieve(s.id));
      if (checkoutCompleted(s)) {
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
          await fulfillMembership(ctx, await stripe().checkout.sessions.retrieve(s.id));
        } else if (m.changeRequestId) {
          await ctx.runAction(internal.rentalExtensionPayments.finalize, { sessionId: s.id });
        }
      }
    }
    if (["refund.created","refund.updated","refund.failed"].includes(event.type)) {
      const refund=event.data.object as Stripe.Refund;
      await reconcileFullyRefundedMembership(ctx,await stripe().refunds.retrieve(refund.id));
      await ctx.runAction(internal.filmFundPayments.reconcileRefund,{refundId:refund.id});
      const id=refund.metadata?.rentalRefundId;
      if(id)await ctx.runMutation(refund.metadata?.rentalPaymentIntent?internal.rentalOperations.recordRefundPart:internal.rentalOperations.recordRefund,{id:id as any,...(refund.metadata?.rentalPaymentIntent?{paymentIntentId:refund.metadata.rentalPaymentIntent}:{}),stripeRefundId:refund.id,status:refund.status==="succeeded"?"succeeded":refund.status==="failed"||refund.status==="canceled"?"failed":"pending"});
    }
    // Retrieve current state: delayed webhook snapshots must not re-enable a canceled subscription.
    if (["customer.subscription.created", "customer.subscription.updated", "customer.subscription.deleted", "customer.subscription.paused", "customer.subscription.resumed"].includes(event.type)) {
      const snapshot = event.data.object as Stripe.Subscription;
      const current = await stripe().subscriptions.retrieve(snapshot.id);
      await syncStripeMembership(ctx, current, current.metadata.membershipCheckoutId);
    }
    if (["credit_note.created","credit_note.updated","credit_note.voided"].includes(event.type)) {
      const note=event.data.object as Stripe.CreditNote;
      const invoice=await stripe().invoices.retrieve(typeof note.invoice==="string"?note.invoice:note.invoice.id);
      const parent=invoice.parent?.subscription_details?.subscription;const subId=typeof parent==="string"?parent:parent?.id;
      if(subId)await reconcileMembershipCreditNotes(ctx,invoice,await stripe().subscriptions.retrieve(subId));
    }
    if (["invoice.paid", "invoice.payment_failed", "invoice.payment_action_required"].includes(event.type)) {
      const invoice = await stripe().invoices.retrieve((event.data.object as Stripe.Invoice).id);
      const parent = invoice.parent?.subscription_details?.subscription;
      const subId = typeof parent === "string" ? parent : parent?.id;
      if (subId) {
        const sub = await stripe().subscriptions.retrieve(subId);
        await syncStripeMembership(ctx, sub, sub.metadata.membershipCheckoutId);
        if (event.type === "invoice.paid") await grantStripeMembershipInvoice(ctx, invoice, sub);
      }
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
      if (!sub) {
        await ctx.runMutation(internal.accounts._applyMembershipReconcile, { accountId: s.accountId, active: false });
        changed++;
        continue;
      }
      try {
        await syncStripeMembership(ctx, sub, sub.metadata.membershipCheckoutId);
        // Catch up paid invoices independently of delivery of webhooks, newest first.
        const invoices = await sb.invoices.list({ subscription: sub.id, status: "paid", limit: 100 });
        for (const invoice of invoices.data) await grantStripeMembershipInvoice(ctx, invoice, sub);
        changed++;
      } catch (e) { console.error("Membership reconciliation will retry", sub.id, e); }
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
  if (session.status === "complete" && checkoutCompleted(session))
    return (await checkoutPaymentIntent(session)) ?? null;
  if (session.status === "expired") return null;
  throw new Error("Checkout payment is still processing. Contact support before cancelling.");
}

async function remainingCancellationPayment(payment: Stripe.PaymentIntent, maxPaidPence?: number) {
  const refunds:Stripe.Refund[]=[];for await(const refund of stripe().refunds.list({payment_intent:payment.id,limit:100}))refunds.push(refund);
  const memberRefunds=new Map<string,number>();
  if(maxPaidPence!==undefined&&maxPaidPence<payment.amount_received&&refunds.length){
    const payments=await stripe().invoicePayments.list({payment:{type:"payment_intent",payment_intent:payment.id},status:"paid",limit:100});
    for(const paid of payments.data){
      const invoiceId=typeof paid.invoice==="string"?paid.invoice:paid.invoice.id,invoice=await stripe().invoices.retrieve(invoiceId);
      const parent=invoice.parent?.subscription_details?.subscription,subId=typeof parent==="string"?parent:parent?.id;if(!subId)continue;
      const sub=await stripe().subscriptions.retrieve(subId),items=new Set(sub.items.data.map(i=>i.id)),memberLines=new Set<string>();
      for await(const line of stripe().invoices.listLineItems(invoiceId,{limit:100}))if(line.parent?.type==="subscription_item_details"&&items.has(line.parent.subscription_item_details?.subscription_item??""))memberLines.add(line.id);
      for await(const note of stripe().creditNotes.list({invoice:invoiceId,limit:100})){
        if(note.status!=="issued"||!note.refunds.length)continue;
        const lines:Stripe.CreditNoteLineItem[]=[];for await(const line of stripe().creditNotes.listLineItems(note.id,{limit:100}))lines.push(line);
        if(!lines.length||lines.some(l=>!l.invoice_line_item||!memberLines.has(l.invoice_line_item)))continue;
        for(const allocation of note.refunds){const id=typeof allocation.refund==="string"?allocation.refund:allocation.refund.id;memberRefunds.set(id,(memberRefunds.get(id)??0)+allocation.amount_refunded);}
      }
    }
  }
  return rentalRefundBalance(payment.amount_received,maxPaidPence,refunds,memberRefunds);
}

async function cancelRental(ctx:any,bookingId:any,b:any,accountId?:any,adminReason?:string,fullCreditOfferId?:any){
 const decision=await ctx.runMutation(internal.bookings.prepareCancellation,{bookingId,fullCreditOfferId});
 let quote=decision.quote;
 if(!quote){
  const paidIntentId=await paymentBeforeCancellation(b);
  let mode:"none"|"refund"|"credit"="none",refundAmount=0,creditAmount=0,allocations:any[]=[];
  if(paidIntentId || b.status==="confirmed"&&(b.creditApplied??0)>0){
   const sources=paidIntentId?(b.paymentSources?.length?b.paymentSources:[{paymentIntentId:paidIntentId,securityPence:pence(b.depositAmount)}]):[];
   const balances=await Promise.all(sources.map(async(source:any)=>({...source,availablePence:await remainingCancellationPayment(await stripe().paymentIntents.retrieve(source.paymentIntentId),source.maxPaidPence)})));
   const settlement = decision.fullCreditOfferId
    ? { allocations: [], refundPence: 0, creditPence: balances.reduce((sum:number, source:any) => sum + source.availablePence, 0) + pence(b.creditApplied ?? 0) }
    : cancellationPaymentPlan(decision.kind,balances,b.status==="confirmed"?pence(b.creditApplied??0):0);
   if(decision.fullCreditOfferId){
    const offer:any=await ctx.runQuery(internal.rentalCreditOffers.byId,{offerId:decision.fullCreditOfferId});
    if(!offer||settlement.creditPence!==offer.amountPence)throw Error("The payment balance changed. The team must review the credit quote before cancellation.");
   }
   allocations=settlement.allocations;
   mode=decision.fullCreditOfferId?"credit":decision.kind==="full_refund"?"refund":"credit";refundAmount=settlement.refundPence/100;creditAmount=settlement.creditPence/100;
   if(creditAmount>0&&!accountId)throw Error("The renter needs an account with their booking email before account credit can be issued. Resume this cancellation after account creation.");
  }
  quote=await ctx.runMutation(internal.bookings.recordCancellationQuote,{bookingId,quote:{mode,refundAmount,creditAmount,paymentIntentId:paidIntentId??undefined,allocations}});
 }
 for(const allocation of quote.allocations??(quote.paymentIntentId&&quote.refundAmount>0?[{paymentIntentId:quote.paymentIntentId,amountPence:pence(quote.refundAmount)}]:[]))await stripe().refunds.create({payment_intent:allocation.paymentIntentId,amount:allocation.amountPence},{idempotencyKey:allocation.paymentIntentId===quote.paymentIntentId?`dbc-cancel-refund-${bookingId}`:`dbc-cancel-refund-${bookingId}-${allocation.paymentIntentId}`});
 await releaseBookingHolds(ctx,bookingId,b);
 await ctx.runMutation(internal.bookings._finalizeCancellation,{bookingId,accountId,mode:quote.mode,refundAmount:quote.refundAmount,creditAmount:quote.creditAmount,currency:b.currency,adminReason});
 return {ok:true,mode:quote.mode,refundAmount:quote.refundAmount,creditAmount:quote.creditAmount};
}
/** Read-only provider quote. Gaffer can offer, but only the renter can accept. */
export const offerFullCredit = internalAction({
 args:{accountId:v.id("accounts"),bookingId:v.id("bookings")},
 handler:async(ctx,args):Promise<any>=>{
  if(process.env.CUSTOMER_BOOKING_ACTIONS!=="true")return null;
  const booking:any=await ctx.runQuery(internal.rentalCreditOffers.context,{bookingId:args.bookingId});
  if(!booking)return null;
  try{assertCreditOffer({...args,fingerprint:creditOfferFingerprint(booking),expiresAt:Date.now()+1000},booking);}catch{return null;}
  const b:any=await ctx.runQuery(internal.bookings.getForCancel,{bookingId:args.bookingId});
  if(!b?.siteOnly||b.accountId!==args.accountId||b.cancellationDecision)return null;
  const holds = [...new Set([b.stripeDepositIntentId,b.depositHoldRenewalIntentId,...(b.depositHoldPreviousIntentIds??[])].filter(Boolean))];
  for(const id of holds){const hold=await stripe().paymentIntents.retrieve(id as string);if(hold.amount_received>0||hold.status==="processing")return null;}
  const sources=b.paymentSources??[];
  const amountPence=(await Promise.all(sources.map(async(source:any)=>remainingCancellationPayment(await stripe().paymentIntents.retrieve(source.paymentIntentId),source.maxPaidPence)))).reduce((sum:number,amount:number)=>sum+amount,0)+pence(b.creditApplied??0);
  return ctx.runMutation(internal.rentalCreditOffers.create,{...args,amountPence,fingerprint:creditOfferFingerprint(booking)});
 }
});
export const acceptFullCredit = action({
 args:{token:v.string(),offerId:v.id("rental_credit_offers"),consent:v.boolean()},
 handler:async(ctx,{token,offerId,consent}):Promise<any>=>{
  if(process.env.CUSTOMER_BOOKING_ACTIONS!=="true")throw Error("Please ask the team to arrange cancellation.");
  if(!consent)throw Error("Confirm that you choose account credit instead of a card refund.");
  const me:any=await ctx.runQuery(api.accounts.me,{token});if(!me)throw Error("Please sign in.");
  const offer:any=await ctx.runQuery(internal.rentalCreditOffers.byId,{offerId});
  if(!offer||offer.accountId!==me._id)throw Error("Credit offer unavailable.");
  const b:any=await ctx.runQuery(internal.bookings.getForCancel,{bookingId:offer.bookingId});
  if(!b?.siteOnly||b.accountId!==me._id)throw Error("Credit offer unavailable.");
  if(b.status==="cancelled"&&b.cancellationDecision?.fullCreditOfferId===offerId){await ctx.runMutation(internal.rentalCreditOffers.accepted,{offerId});return {ok:true};}
  const booking:any=await ctx.runQuery(internal.rentalCreditOffers.context,{bookingId:offer.bookingId});
  if(b.cancellationDecision?.fullCreditOfferId !== offerId) assertCreditOffer(offer,booking);
  const result=await cancelRental(ctx,offer.bookingId,b,me._id,undefined,offerId);
  await ctx.runMutation(internal.rentalCreditOffers.accepted,{offerId});return result;
 }
});
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
  if(!allocations){const sources=await ctx.runQuery(internal.rentalOperations.paymentSources,{bookingId:args.bookingId});const balances=await Promise.all(sources.map(async(source:any)=>({...source,availablePence:await remainingCancellationPayment(await stripe().paymentIntents.retrieve(source.paymentIntentId),source.maxPaidPence)})));allocations=await ctx.runMutation(internal.rentalOperations.bindRefundAllocations,{id:job._id,allocations:rentalRefundPlan(balances,job.amountPence)});}
  let status="succeeded";
  for(const allocation of allocations){const part=job.parts?.find((p:any)=>p.paymentIntentId===allocation.paymentIntentId);const refund=part?.stripeRefundId?await stripe().refunds.retrieve(part.stripeRefundId):await stripe().refunds.create({payment_intent:allocation.paymentIntentId,amount:allocation.amountPence,metadata:{rentalRefundId:job._id,rentalPaymentIntent:allocation.paymentIntentId,bookingId:args.bookingId}}, {idempotencyKey:allocation.paymentIntentId===allocations[0].paymentIntentId?`dbc-rental-refund-${job._id}`:`dbc-rental-refund-${job._id}-${allocation.paymentIntentId}`});const result=refund.status==="succeeded"?"succeeded":refund.status==="failed"||refund.status==="canceled"?"failed":"pending";if(result!=="succeeded")status=result;await ctx.runMutation(internal.rentalOperations.recordRefundPart,{id:job._id,paymentIntentId:allocation.paymentIntentId,stripeRefundId:refund.id,status:result});}
  return {status,amount:job.amountPence/100};
 }
});
