"use node";
import { invoiceRequest } from "./lib/invoiceRequest";
import { STARTED_RENTAL_REFUND_MESSAGE } from "../src/lib/cancellationPolicy";
import {isAllowedReturnTime} from "../src/lib/site";

import Stripe from "stripe";
import { PICKUP_HOLD_POLICY } from "../shared/pickupSecurity";
import { returnSecurityPlan } from "../shared/returnSettlement";
import { returnStatementEmail, damageDeductionEmail, type ReturnStatementData } from "../shared/returnStatement";
import type { InspectionInput } from "../shared/returnInspection";
import { rentalRefundBalance } from "./lib/rentalRefundBalance";
import { recoverApprovedRefund, RefundReviewRequired } from "./lib/approvedRefund";
import { belongsToRentalAccount } from "./lib/rentalAccount";
import { createHash } from "node:crypto";
import { action, internalAction } from "./_generated/server";
import { internal, api } from "./_generated/api";
import { v, ConvexError } from "convex/values";
import { inspectionInput } from "./lib/returnInspectionFields";
import { assertCreditOffer, creditOfferFingerprint } from "./lib/rentalCreditPolicy";
import { cancellationPaymentPlan,rentalRefundPlan,securityReturnPlan } from "./lib/rentalPaymentPlan";
import { lateFeeQuote } from "./lib/lateFee";
import { assertCurrentAgreement, agreementRequestFingerprint } from "../shared/rentalAgreement";
import { sendMail } from "./lib/mailer";
import { assertDiditCheckoutCapacity } from "./lib/diditCapacity";
import { ensureCheckoutCustomer } from "./lib/stripeCustomer";
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
      qty: v.number(), total: v.number(), deposit: v.number(), offerType: v.optional(v.string()),pickupTime:v.optional(v.string()),returnTime:v.optional(v.string()),
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
        pickupTime:v.optional(v.string()),returnTime:v.optional(v.string()),
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
      throw new ConvexError({code:"CHECKOUT_PAUSED",message:"Checkout is temporarily paused while we improve the booking experience. Your basket is saved; please check back soon."});
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
    if (!a.pickupTime || !slot.test(a.pickupTime) || !a.returnTime || !slot.test(a.returnTime) || !isAllowedReturnTime(a.pickupTime) || !isAllowedReturnTime(a.returnTime) || a.items.some(i=>i.pickupTime!==undefined&&!isAllowedReturnTime(i.pickupTime)||i.returnTime!==undefined&&!isAllowedReturnTime(i.returnTime)))
      throw new Error("Choose the agreed pickup and return times before paying.");
    assertCurrentAgreement(a.agreement, a.fulfilment);
    if (!a.agreement?.requestId||!/^[a-zA-Z0-9-]{16,80}$/.test(a.agreement.requestId)) throw Error("Review and sign this booking before paying.");

    const checkoutInputFingerprint=createHash("sha256").update(agreementRequestFingerprint({...a,token:undefined})).digest("hex");
    const priorAttempt=await ctx.runQuery(internal.bookings.checkoutAttempt,{requestId:a.agreement.requestId,checkoutInputFingerprint});
    if(priorAttempt?.sessionId){
      const session=await stripe().checkout.sessions.retrieve(priorAttempt.sessionId);
      if(session.id!==priorAttempt.sessionId||session.metadata?.bookingId!==String(priorAttempt.bookingId))throw Error("This payment session does not match the saved booking. Contact us before retrying.");
      if(session.status!=="open"||!session.url)throw Error("This checkout has completed or expired. Use the existing booking or contact us.");
      return {url:session.url};
    }
    if(priorAttempt&&!priorAttempt.membershipCheckoutId)throw Error("This checkout is still pending reconciliation. Do not submit a second acceptance or payment.");

    await assertDiditCheckoutCapacity(
      process.env.DIDIT_API_KEY!,
      process.env.DIDIT_WORKFLOW_ID!,
      process.env.DIDIT_ENVIRONMENT!,
      process.env.DIDIT_MAX_WORKFLOW_PRICE_USD,
    );

    if (a.selectedMembership && /^[A-Za-z0-9_-]{32,100}$/.test(a.selectedMembership.requestId)) {
      const existing: any = await ctx.runQuery(internal.membershipBenefits.byRequest,{requestId:a.selectedMembership.requestId,email:a.customer.email});
      if(priorAttempt&&existing&&(String(existing._id)!==String(priorAttempt.membershipCheckoutId)||String(existing.bookingId)!==String(priorAttempt.bookingId)))throw Error("This membership checkout does not match the saved booking. Contact us before retrying.");
      if(priorAttempt&&existing&&!["creating","open"].includes(existing.state))throw Error("This membership checkout has completed or closed. Contact us before retrying.");
      if (existing?.sessionId) {
        const session = await stripe().checkout.sessions.retrieve(existing.sessionId);
        if(priorAttempt&&(session.id!==existing.sessionId||session.metadata?.bookingId!==String(priorAttempt.bookingId)))throw Error("This payment session does not match the saved booking. Contact us before retrying.");
        if (session.status === "open" && session.url) return {url:session.url};
        throw Error("This membership checkout is no longer open.");
      }
      if (existing?.sessionParams) {
        const savedParams=JSON.parse(existing.sessionParams);
        if(priorAttempt&&savedParams.metadata?.bookingId!==String(priorAttempt.bookingId))throw Error("This payment setup does not match the saved booking. Contact us before retrying.");
        const session = await stripe().checkout.sessions.create(savedParams,{idempotencyKey:`dbc-member-checkout-${existing._id}`});
        await ctx.runMutation(internal.membershipBenefits.bindCheckout,{id:existing._id,sessionId:session.id,bookingId:existing.bookingId});
        await ctx.runMutation(internal.bookings.bindCheckoutSession,{bookingId:existing.bookingId,sessionId:session.id});
        if (!session.url) throw Error("Stripe did not return a checkout URL");
        return {url:session.url};
      }
    }

    // New checkout must read current upstream stock, not only the scheduled
    // mirror. Existing bound membership recovery above retains its saved URL.
    try { await ctx.runAction(api.sync.syncHyggloReservations,{}); }
    catch { throw new ConvexError({code:"STOCK_CHECK_UNAVAILABLE",message:"We couldn't check equipment availability. Please try again before paying."}); }

    // Recompute exactly what the renter reviewed, using current listing and account data.
    const price = await calculateRentalPrice(ctx, a);
    a.items = price.items;

    // Check the complete physical basket, preserving each line's own period.
    // Separate listings can share kit components; disjoint dates do not add.
    const availability=await ctx.runQuery(api.availability.forCart,{items:a.items.map(i=>({listingId:i.listingId,start:i.start,end:i.end,qty:i.qty,pickupTime:i.pickupTime??a.pickupTime,returnTime:i.returnTime??a.returnTime}))});
    const unavailable=a.items.find(i=>!availability[i.listingId]?.ok);
    if(unavailable)throw Error(`"${unavailable.title}" isn't available in that quantity for those dates`);

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

    const stripeCustomerId = acct ? await ensureCheckoutCustomer(sb, acct, (customerId,expectedCustomerId)=>
      ctx.runMutation(internal.accounts._bindCheckoutCustomer,{accountId:acct._id,customerId,expectedCustomerId})) : undefined;

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
        pickupTime:i.pickupTime??a.pickupTime,returnTime:i.returnTime??a.returnTime,
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
      checkoutInputFingerprint,
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
    try {
      await ctx.runMutation(internal.bookings.placeHolds, {
        bookingId,
        ttlMs: 35 * 60 * 1000,
      });
    } catch (error) {
      // No Stripe session creation has been attempted on this path. Release
      // the unbound pending order/credit rather than trapping it until cron.
      // The mutation refuses to close a bound or paid checkout.
      const closed = await ctx.runMutation(internal.bookings.expireUnpaidPending, { bookingId });
      if (closed) throw new ConvexError({ code: "CHECKOUT_STOCK_REJECTED", freshAcceptanceRequired: true,
        message: `${error instanceof Error ? error.message : "The requested equipment could not be reserved."} Review your basket, then review and accept the rental terms again.` });
      throw error;
    }

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
    const meta = {bookingId,rentalPaidPence:String(pence(price.totalDue)),...(membershipCheckout ? {membershipTier:membershipCheckout.tier,accountId:String(acct._id),accountEmail:acct.email,membershipCheckoutId:String(membershipCheckout._id),membershipTerms:MEMBERSHIP_TERMS_VERSION}: {})};
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

/** Payment, setup, paid subscription and trial subscription all save a reusable card. */
export async function checkoutSavedCard(session:Stripe.Checkout.Session,sb:Stripe) {
 const customerId=typeof session.customer==="string"?session.customer:session.customer?.id;
 if(!customerId)throw Error("Rental checkout has no saved card customer.");
 let paymentMethod:string|undefined;
 const paymentId=await checkoutPaymentIntent(session);
 if(paymentId){const pi=await sb.paymentIntents.retrieve(paymentId);if(pi.status==="succeeded")paymentMethod=typeof pi.payment_method==="string"?pi.payment_method:pi.payment_method?.id;}
 if(!paymentMethod&&session.setup_intent){const setup=await sb.setupIntents.retrieve(typeof session.setup_intent==="string"?session.setup_intent:session.setup_intent.id);if(setup.status==="succeeded")paymentMethod=typeof setup.payment_method==="string"?setup.payment_method:setup.payment_method?.id;}
 if(!paymentMethod&&session.subscription){const sub=await sb.subscriptions.retrieve(typeof session.subscription==="string"?session.subscription:session.subscription.id);paymentMethod=typeof sub.default_payment_method==="string"?sub.default_payment_method:sub.default_payment_method?.id;if(!paymentMethod&&sub.pending_setup_intent){const setup=await sb.setupIntents.retrieve(typeof sub.pending_setup_intent==="string"?sub.pending_setup_intent:sub.pending_setup_intent.id);if(setup.status==="succeeded")paymentMethod=typeof setup.payment_method==="string"?setup.payment_method:setup.payment_method?.id;}}
 if(!paymentMethod)throw Error("Your reusable card could not be saved. Open your rental account to complete card setup.");
 const method=await sb.paymentMethods.retrieve(paymentMethod);
 const attached=typeof method.customer==="string"?method.customer:method.customer?.id;
 if(method.type!=="card"||attached!==customerId)throw Error("The saved card is not attached to this rental customer.");
 return {customerId,paymentMethodId:paymentMethod};
}
export const preparePickupSecurity = internalAction({args:{bookingId:v.id("bookings")},handler:async(ctx,{bookingId})=>{
 const b:any=await ctx.runQuery(internal.pickupSecurity.context,{bookingId});
 if(b?.securityHoldPolicyVersion!==PICKUP_HOLD_POLICY||!["confirmed","active"].includes(b.status)||b.cancellationDecision||b.returnDecision||!b.depositHoldAmount||b.securityHoldPaymentMethodId)return;
 try{const session=await stripe().checkout.sessions.retrieve(b.stripeCheckoutSessionId);if(session.metadata?.bookingId!==bookingId||!checkoutCompleted(session))throw Error("Checkout payment is not confirmed.");const customerId=typeof session.customer==="string"?session.customer:session.customer?.id;if(customerId)await ctx.runMutation(internal.pickupSecurity.saveCustomer,{bookingId,sessionId:session.id,customerId});await ctx.runMutation(internal.pickupSecurity.saveCard,{bookingId,sessionId:session.id,...await checkoutSavedCard(session,stripe())});}
 catch(e:any){await ctx.runMutation(internal.pickupSecurity.prepareFailed,{bookingId,retry:["StripeConnectionError","StripeAPIError","StripeRateLimitError"].includes(e?.type)});}
}});
async function recoverPickupCard(ctx:any,session:Stripe.Checkout.Session){const bookingId=session.metadata?.pickupCardBookingId;if(!bookingId||!checkoutCompleted(session))return;const b:any=await ctx.runQuery(internal.pickupSecurity.context,{bookingId:bookingId as any});if(!b)return;
 const customerId=typeof session.customer==="string"?session.customer:session.customer?.id;
 if(customerId!==b.securityHoldCustomerId)return;
 if(b.securityHoldRecoveredSessionId===session.id)return bookingId;
 if(b.securityHoldRecoverySessionId!==session.id)return;
 const applied=await ctx.runMutation(internal.pickupSecurity.recoverCard,{bookingId:bookingId as any,sessionId:session.id,...await checkoutSavedCard(session,stripe())});
 return applied?bookingId:undefined;}

/** A separate manual-capture PaymentIntent is required for an actual card hold.
 * Checkout saves the card for off-session use, then this attempts the hold immediately.
 * Issuer authentication is still possible; the success page handles that in the same flow. */
async function authorizeHold(ctx: any, session: Stripe.Checkout.Session): Promise<{ status: string; clientSecret?: string }> {
  const bookingId = session.metadata?.bookingId;
  if (!bookingId || !checkoutCompleted(session)) return { status: "not_applicable" };
  const b: any = await ctx.runQuery(internal.bookings.holdContext, { bookingId: bookingId as any });
  if (!b || !b.amount || !["confirmed", "active"].includes(b.status)) return { status: "not_applicable" };
  const sb = stripe();
  if(b.securityHoldPolicyVersion===PICKUP_HOLD_POLICY){
    await ctx.runAction(internal.checkout.preparePickupSecurity,{bookingId:bookingId as any});
    const current:any=await ctx.runQuery(internal.pickupSecurity.context,{bookingId:bookingId as any});
    return {status:current?.depositHoldStatus??"scheduled"};
  }
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
    if (process.env.RENTAL_CHECKOUT_ENABLED !== "true") throw new ConvexError({code:"CHECKOUT_PAUSED",message:"Checkout is temporarily paused. Please check back soon."});
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
      const customerId = await ensureCheckoutCustomer(sb, acct, (customerId,expectedCustomerId)=>
        ctx.runMutation(internal.accounts._bindCheckoutCustomer,{accountId:acct._id,customerId,expectedCustomerId}));
      const priceId = await ensurePrice(sb, tier);
      const metadata = { membershipTier: tier.key, accountId: String(acct._id), accountEmail: acct.email, membershipCheckoutId: String(reservation._id), membershipTerms: MEMBERSHIP_TERMS_VERSION };
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

async function stripeMembershipAccount(ctx: any, sub: Stripe.Subscription, checkoutId?: string) {
  if (checkoutId && sub.metadata.membershipCheckoutId && checkoutId !== sub.metadata.membershipCheckoutId)
    throw Error("Membership checkout ownership mismatch.");
  return ctx.runQuery(internal.membershipBenefits.subscriptionAccount, {
    subscriptionId: sub.id, customerId: typeof sub.customer === "string" ? sub.customer : sub.customer.id,
    accountId: sub.metadata.accountId, checkoutId: checkoutId ?? sub.metadata.membershipCheckoutId, email: sub.metadata.accountEmail,
  });
}

export async function syncStripeMembership(ctx: any, sub: Stripe.Subscription, checkoutId?: string) {
  const tier = tierKeyFromSub(sub);
  if (!tier) return;
  const acct: any = await stripeMembershipAccount(ctx, sub, checkoutId);
  // Shared Stripe accounts deliver events for other projects/deployments too.
  if (!acct) return;
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
    accountId: acct._id, customerId: typeof sub.customer === "string" ? sub.customer : sub.customer.id, subscriptionId: sub.id, tier, status: sub.status, subscriptionCreatedAt: sub.created * 1000,
    trialEnd: sub.trial_end ? sub.trial_end * 1000 : undefined, cancelAtPeriodEnd: sub.cancel_at_period_end, paidThrough,
    ...(checkoutId && ["active","trialing"].includes(sub.status) ? { checkoutId } : {}),
  });
  return acct;
}

async function grantStripeMembershipInvoice(ctx: any, invoice: Stripe.Invoice, sub: Stripe.Subscription) {
  const acct: any = await stripeMembershipAccount(ctx, sub);
  if (!acct || acct.stripeSubscriptionId !== sub.id) return;
  const lines: Stripe.InvoiceLineItem[] = [];
  for await (const line of stripe().invoices.listLineItems(invoice.id, { limit: 100 })) lines.push(line);
  const grant = paidRecurringMembership(invoice, lines, sub);
  if (grant) {
    await ctx.runMutation(internal.membershipBenefits.grantPaidInvoice, { accountId: acct._id, customerId: typeof sub.customer === "string" ? sub.customer : sub.customer.id, subscriptionId: sub.id, invoiceId: invoice.id, ...(invoice.billing_reason === "subscription_create" && sub.metadata.membershipCheckoutId ? {checkoutId:sub.metadata.membershipCheckoutId as any} : {}), ...grant });
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

type ReturnSelection = { bookingId: any; damageKept?: number; damageNote?: string; actualReturnedAt?: number; chargeLate: boolean; lateWaiverReason?: string; inspection?: InspectionInput[] };
async function validateReturnSelection(ctx: any, b: any, args: ReturnSelection) {
  const { bookingId, damageKept, damageNote, actualReturnedAt, chargeLate, lateWaiverReason, inspection } = args;
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
    const inspected = inspection ? await ctx.runQuery(internal.returnInspections.validate, { bookingId, inspection, damage: damageKept ?? 0 }) : b.returnDecision?.inspection;
    if (!Number.isFinite(damageKept ?? 0) || (damageKept ?? 0) < 0 || (damageKept ?? 0) > (b.depositAmount ?? 0) + (b.depositHoldAmount ?? 0)) throw Error("The damage amount must be within the paid security payment and full authorised hold.");
    const sources = b.paymentSources ?? (b.paymentIntentId ? [{ paymentIntentId: b.paymentIntentId, securityPence: pence(b.depositAmount ?? 0) }] : []);
    securityReturnPlan(sources, 0);
    return { returned, quotedLate, late, waiver, inspected, sources };
}
function observedHoldAmounts(b: any, hold: Stripe.PaymentIntent | null) {
  if (!hold || !["requires_capture", "succeeded"].includes(hold.status)) return { available: 0, uncaptured: 0 };
  const value = hold.status === "requires_capture" ? hold.amount_capturable : hold.amount_received;
  if (!Number.isSafeInteger(value) || value < 0) throw Error("The provider returned an invalid security balance");
  const available = Math.min(b.depositHoldAmount ?? 0, value / 100);
  return { available, uncaptured: hold.status === "requires_capture" ? available : 0 };
}

function assertReturnRefund(refund:Stripe.Refund,job:any,allocation:any){
 const payment=typeof refund.payment_intent==="string"?refund.payment_intent:refund.payment_intent?.id;
 if(!refund.id||payment!==allocation.paymentIntentId||refund.currency!=="gbp"||refund.amount!==allocation.amountPence||refund.metadata?.returnSecurityId!==job._id||refund.metadata?.bookingId!==job.bookingId||refund.metadata?.returnPaymentIntent!==allocation.paymentIntentId||Number(refund.metadata?.returnAttempt??0)!==(allocation.attempt??0))
  throw Error("The deposit refund does not match its frozen original payment allocation.");
}

async function returnedRefundBalance(refund:Stripe.Refund){
 const id=typeof refund.failure_balance_transaction==="string"?refund.failure_balance_transaction:refund.failure_balance_transaction?.id;
 if(!["failed","canceled"].includes(refund.status??"")||!id)throw Error("The failed refund has no verified returned-money receipt. Reconcile it with Stripe before retrying.");
 const balance=await stripe().balanceTransactions.retrieve(id);
 const source=typeof balance?.source==="string"?balance.source:balance?.source?.id;
 if(!balance||balance.id!==id||source!==refund.id||balance.type!=="refund_failure"||balance.currency!=="gbp"||balance.amount!==refund.amount||balance.status!=="available")throw Error("The failed refund money is not verified as returned and available. No new payout was created.");
 return id;
}
async function assertPreviousReturnRefunds(job:any,allocation:any){
 for(const saved of allocation.history??[]){
  const refund=await stripe().refunds.retrieve(saved.stripeRefundId);
  if(refund.id!==saved.stripeRefundId)throw Error("Previous deposit refund identity mismatch.");
  assertReturnRefund(refund,job,{...allocation,attempt:saved.attempt});
  if(await returnedRefundBalance(refund)!==saved.failureBalanceId)throw Error("The previous bank-return receipt changed. Reconcile before continuing.");
 }
}

/** Review reads current receipts without settling, notifying or creating money. */
async function observeReturnRefundProgress(job:any){
 let confirmed=0,processing=0,unobserved=0,failed=false;
 for(const allocation of job.allocations){
  await assertPreviousReturnRefunds(job,allocation);
  let refund:Stripe.Refund|undefined;
  if(allocation.stripeRefundId){
   refund=await stripe().refunds.retrieve(allocation.stripeRefundId);
   if(refund.id!==allocation.stripeRefundId)throw Error("Deposit refund identity mismatch.");
  }else{
   let count=0;
   for await(const receipt of stripe().refunds.list({payment_intent:allocation.paymentIntentId,limit:100})){
    if(++count>1000)throw Error("The original security payment history needs review.");
    if(receipt.metadata?.returnSecurityId!==job._id||(allocation.history??[]).some((r:any)=>r.stripeRefundId===receipt.id))continue;
    assertReturnRefund(receipt,job,allocation);
    if(refund)throw Error("Multiple deposit refunds match the frozen payment allocation.");
    refund=receipt;
   }
  }
  if(!refund){unobserved+=allocation.amountPence;continue;}
  assertReturnRefund(refund,job,allocation);
  if(refund.status==="succeeded")confirmed+=refund.amount;
  else if(["failed","canceled"].includes(refund.status??""))failed=true;
  else processing+=refund.amount;
 }
 return {status:confirmed===job.amountPence?"succeeded":unobserved?"prepared":processing?"pending":failed?"failed":"prepared",expected:job.amountPence/100,confirmed:confirmed/100,processing:processing/100,unobserved:unobserved/100,checkedAt:Date.now(),...(job.error?{error:job.error}:{})};
}

/** Recover an existing provider request before creating money, even after the
 * provider's idempotency-key retention period. Callbacks never create refunds. */
async function settleReturnRefunds(ctx:any,job:any,create:boolean):Promise<{job:any;stale:boolean}>{
 const snapshot=await ctx.runMutation(internal.returnSecurity.begin,{id:job._id});
 job=snapshot.job;
 try{
  const receipts=[];
  for(const allocation of job.allocations){
   await assertPreviousReturnRefunds(job,allocation);
   let refund:Stripe.Refund|undefined;
   if(allocation.stripeRefundId){
    refund=await stripe().refunds.retrieve(allocation.stripeRefundId);
    if(refund.id!==allocation.stripeRefundId)throw Error("Deposit refund identity mismatch.");
   }else{
    const history:Stripe.Refund[]=[];let count=0;
    for await(const entry of stripe().refunds.list({payment_intent:allocation.paymentIntentId,limit:100})){
     if(++count>1000)throw Error("The original security payment history needs review.");
     history.push(entry);
     if(entry.metadata?.returnSecurityId!==job._id||(allocation.history??[]).some((r:any)=>r.stripeRefundId===entry.id))continue;
     assertReturnRefund(entry,job,allocation);
     if(refund)throw Error("Multiple deposit refunds match the frozen payment allocation.");
     refund=entry;
    }
    if(!refund){
     if(!create)throw Error("The deposit refund has no saved provider receipt. Resume the existing return settlement.");
     // An unlabelled old refund may already include this deposit. Never assume
     // the remaining rental money proves that the same deposit is unpaid.
     if(history.some(r=>!["failed","canceled"].includes(r.status??"")&&!r.metadata?.rentalRefundId))throw Error("An earlier original-payment refund needs reconciliation before returning this deposit.");
     const payment=await stripe().paymentIntents.retrieve(allocation.paymentIntentId);
     if(payment.id!==allocation.paymentIntentId||payment.currency!=="gbp"||payment.status!=="succeeded")throw Error("The original deposit payment is not a captured GBP payment.");
     const available=await remainingCancellationPayment(payment,undefined,history);
     if(allocation.amountPence>available)throw Error("The original captured payment cannot cover its saved deposit refund.");
     refund=await stripe().refunds.create({payment_intent:allocation.paymentIntentId,amount:allocation.amountPence,metadata:{returnSecurityId:job._id,bookingId:job.bookingId,returnPaymentIntent:allocation.paymentIntentId,...(allocation.attempt?{returnAttempt:String(allocation.attempt)}:{})}},
      {idempotencyKey:`dbc-deposit-release-${job.bookingId}-${allocation.paymentIntentId}${allocation.attempt?`-recovery-${allocation.attempt}`:""}`});
    }
   }
   assertReturnRefund(refund,job,allocation);
   receipts.push({paymentIntentId:allocation.paymentIntentId,stripeRefundId:refund.id,amountPence:refund.amount,status:refund.status==="succeeded"?"succeeded":refund.status==="failed"||refund.status==="canceled"?"failed":"pending",...(refund.failure_reason?{failureReason:refund.failure_reason}:{})});
  }
  const result=await ctx.runMutation(internal.returnSecurity.record,{id:job._id,generation:snapshot.generation,receipts});
  if(!result.stale&&result.job.status==="succeeded"){
   const b:any=await ctx.runQuery(internal.bookings.getForRefund,{bookingId:job.bookingId});
   const decision=b?.returnDecision;if(!decision)throw Error("The saved return decision is missing.");
   const quoted=lateFeeQuote(b.lineItems,b.returnTime,decision.actualReturnedAt);
   await ctx.runMutation(internal.bookings.recordLateFee,{bookingId:job.bookingId,actualReturnedAt:decision.actualReturnedAt,amount:decision.chargeLate?quoted.amount:0,breakdown:decision.chargeLate?quoted.breakdown:[],...(!decision.chargeLate&&quoted.amount>0?{waivedAmount:quoted.amount,waiverReason:decision.lateWaiverReason}:{})});
  }
  return result;
 }catch(error){await ctx.runMutation(internal.returnSecurity.defer,{id:job._id,generation:snapshot.generation});throw error;}
}

export const retryReturnDeposit = action({args:{token:v.string(),bookingId:v.id("bookings"),requestId:v.string(),reason:v.string()},handler:async(ctx,args):Promise<{status:string;confirmed:number;expected:number}>=>{
 await ctx.runMutation(internal.adminAuth.assertAdminInternal,{token:args.token,fn:"checkout.retryReturnDeposit"});
 let job:any=await ctx.runQuery(internal.returnSecurity.context,{bookingId:args.bookingId});
 if(!job)throw Error("No saved original-payment deposit refund exists.");
 const previous=job.recoveries?.find((r:any)=>r.requestId===args.requestId);
 if(previous){if(previous.reason!==args.reason.trim()||job.recoveries.at(-1).requestId!==args.requestId)throw Error("Resume the latest saved recovery without changing its reason.");}
 else{
  const observed=await settleReturnRefunds(ctx,job,false);
  if(observed.stale)throw Error("The deposit refund changed. Refresh before recovery.");
  job=observed.job;
  if(job.status!=="failed")throw Error("Only confirmed failed refunds can be retried; processing money must be reconciled.");
  const proofs=[];
  for(const a of job.allocations.filter((a:any)=>a.status==="failed")){
   const r=await stripe().refunds.retrieve(a.stripeRefundId);if(r.id!==a.stripeRefundId)throw Error("Deposit refund identity mismatch.");
   assertReturnRefund(r,job,a);
   proofs.push({paymentIntentId:a.paymentIntentId,stripeRefundId:r.id,failureBalanceId:await returnedRefundBalance(r)});
  }
  job=await ctx.runMutation(internal.returnSecurity.authorizeRecovery,{id:job._id,generation:job.generation,requestId:args.requestId,reason:args.reason,proofs});
 }
 const result=await settleReturnRefunds(ctx,job,true);
 if(result.stale)throw Error("A newer deposit observation exists. Refresh the current return review.");
 return {status:result.job.status,confirmed:result.job.allocations.filter((a:any)=>a.status==="succeeded").reduce((n:number,a:any)=>n+a.amountPence,0)/100,expected:result.job.amountPence/100};
}});

export const reconcileReturnSecurity = internalAction({args:{},handler:async(ctx)=>{
 const jobs:any[]=await ctx.runQuery(internal.returnSecurity.due,{});
 for(const job of jobs){try{await settleReturnRefunds(ctx,job,job.status==="prepared");}catch(error){console.error("Return deposit reconciliation needs review",job.bookingId,error);}}
}});

/** One existing five-minute schedule recovers cancellation and return refunds. */
export const reconcileFinancialReturns = internalAction({args:{},handler:async(ctx)=>{
 await ctx.runAction(internal.checkout.reconcileCancellations,{});
 await ctx.runAction(internal.checkout.reconcileReturnSecurity,{});
}});

/** Owner review only: provider reads and a draft PDF, never financial execution or email. */
export const previewReturned = action({
  args: { token: v.string(), bookingId: v.id("bookings"), damageKept: v.optional(v.number()), damageNote: v.optional(v.string()), actualReturnedAt: v.optional(v.number()), chargeLate: v.boolean(), lateWaiverReason: v.optional(v.string()), inspection: v.optional(v.array(inspectionInput)) },
  handler: async (ctx, args): Promise<any> => {
    await ctx.runMutation(internal.adminAuth.assertAdminInternal, { token: args.token, fn: "checkout.previewReturned" });
    const b: any = await ctx.runQuery(internal.bookings.getForRefund, { bookingId: args.bookingId });
    if (!b) throw Error("Booking not found.");
    const selection = await validateReturnSelection(ctx, b, args);
    const invoice: any = await ctx.runQuery(api.bookings.invoiceData, { bookingId: args.bookingId, token: args.token });
    if (!invoice) throw Error("The rental invoice details are unavailable");
    const hold = b.depositHoldIntentId ? await stripe().paymentIntents.retrieve(b.depositHoldIntentId, {}, { timeout: 20000 }) : null;
    const balance = observedHoldAmounts(b, hold);
    const damage = Math.round((args.damageKept ?? 0) * 100) / 100;
    const plan = b.depositRefunded ? { damageFromHold: invoice.returnStatement?.damageFromHold ?? b.depositHoldCapturedForDamage ?? 0, damageFromDeposit: Math.max(0, (b.depositKept ?? 0) - (invoice.returnStatement?.damageFromHold ?? b.depositHoldCapturedForDamage ?? 0)), depositRefund: b.depositRefundAmount ?? 0, holdRelease: 0, availableSecurity: 0 } : returnSecurityPlan({ deposit: b.depositAmount ?? 0, capturedSecurity: selection.sources.reduce((n: number, source: any) => n + source.securityPence, 0) / 100, damage, holdAvailable: balance.available, holdUncaptured: balance.uncaptured });
    const retainedForLate = selection.late.amount > 0 && (b.depositRefunded || damage === 0) ? balance.uncaptured : 0;
    const statement: ReturnStatementData = invoice.returnStatement ?? {
      number: `DBC-R-${String(args.bookingId).toUpperCase()}`, issuedAt: Date.now(), actualReturnedAt: selection.returned,
      ...(b.returnTime ? { agreedReturnTime: b.returnTime } : {}), supplierName: invoice.supplierName,
      ...(invoice.supplierAddress ? { supplierAddress: invoice.supplierAddress } : {}),
      ...(invoice.customerName ? { customerName: invoice.customerName } : {}), customerEmail: invoice.email ?? "",
      ...((invoice.billingAddress ?? invoice.address) ? { billingAddress: invoice.billingAddress ?? invoice.address } : {}), lineItems: invoice.lineItems,
      subtotal: invoice.subtotal, discount: invoice.discount, deliveryFee: invoice.deliveryFee, creditApplied: invoice.creditApplied,
      checkoutPaid: invoice.total, rentalRefunded: invoice.rentalRefunded ?? 0,
      securityPaid: b.depositAmount ?? 0, securityRefunded: plan.depositRefund,
      holdStatus: hold?.status === "requires_capture" ? damage > 0 ? "captured" : retainedForLate ? "held" : "released" : hold?.status === "canceled" ? "released" : hold?.status === "succeeded" ? "captured" : b.depositHoldStatus ?? undefined,
      damageTotal: b.depositRefunded ? b.depositKept ?? 0 : damage, damageFromHold: plan.damageFromHold,
      ...(args.damageNote ? { damageNote: args.damageNote.trim() } : {}), inspection: selection.inspected ?? [],
      lateAssessed: selection.late.amount, lateWaived: selection.waiver.waivedAmount ?? 0, lateBreakdown: selection.late.breakdown,
    };
    const draft = !invoice.returnStatement;
    const secret = process.env.INVOICE_SECRET;
    if (!secret) throw Error("Return statement PDF previews are not configured");
    const response = await invoiceRequest(`${process.env.APP_URL ?? "https://dbcinemarentals.com"}/api/invoice/${args.bookingId}?phase=return-preview`, {
      method: "POST", headers: { "content-type": "application/json", "x-invoice-key": secret }, body: JSON.stringify({ statement, draft }), signal: AbortSignal.timeout(20000),
    });
    if (!response.ok) throw Error("The return statement PDF preview is unavailable. No settlement has been executed.");
    const pdf = Buffer.from(await response.arrayBuffer());
    if (pdf.length > 1_000_000 || pdf.subarray(0, 5).toString() !== "%PDF-") throw Error("The return statement preview did not produce a valid PDF");
    const current: any = await ctx.runQuery(internal.bookings.getForRefund, { bookingId: args.bookingId });
    const refundJob:any=await ctx.runQuery(internal.returnSecurity.context,{bookingId:args.bookingId});
    const refundProgress=refundJob?await observeReturnRefundProgress(refundJob):null;
    const email = returnStatementEmail({...statement, customerEmail:current?.notificationEmail ?? ""}, draft);
    return { draft, observedAt: Date.now(), alreadySettled: !!invoice.returnStatement&&(!refundProgress||refundProgress.status==="succeeded"), securityAlreadySettled: refundProgress?refundProgress.status==="succeeded":!!b.depositRefunded, refundProgress,financial: { ...plan,...(refundJob?{depositRefund:refundJob.amountPence/100}:{}), holdRelease: retainedForLate ? 0 : plan.holdRelease, holdRetainedForLate: retainedForLate, lateAssessed: statement.lateAssessed, lateWaived: statement.lateWaived }, statement, email, pdf: { base64: pdf.toString("base64"), filename: `DbCinema-${draft ? "draft-" : ""}return-${String(args.bookingId).slice(-8)}.pdf` } };
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
  ): Promise<{ ok: boolean; released: number; kept: number; lateAmount: number; alreadyReleased: boolean; refundStatus?:string; refundExpected?:number }> => {
    await ctx.runMutation(internal.adminAuth.assertAdminInternal, { token, fn: "checkout.markReturned" });
    const b: any = await ctx.runQuery(internal.bookings.getForRefund, { bookingId });
    if (!b) throw new Error("Booking not found.");
    const { returned, quotedLate, late, waiver, sources } = await validateReturnSelection(ctx, b, { bookingId, damageKept, damageNote, actualReturnedAt, chargeLate, lateWaiverReason, inspection });
    const existingReturn:any=await ctx.runQuery(internal.returnSecurity.context,{bookingId});
    if(existingReturn){
      const result=await settleReturnRefunds(ctx,existingReturn,true);
      const confirmed=result.job.allocations.filter((a:any)=>a.status==="succeeded").reduce((n:number,a:any)=>n+a.amountPence,0)/100;
      return {ok:true,released:confirmed,kept:result.job.kept,lateAmount:late.amount,alreadyReleased:result.job.status==="succeeded",refundStatus:result.job.status,refundExpected:result.job.amountPence/100};
    }
    if ((damageKept ?? 0) > 0 && !b.depositRefunded && !b.notificationEmail)
      throw new Error("The associated rental account email needs review before a damage deduction can be collected.");
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
        holdAvailable = observedHoldAmounts(b, observed).available;
      }
      returnSecurityPlan({ deposit, capturedSecurity: sources.reduce((n: number, source: any) => n + source.securityPence, 0) / 100, damage: kept, holdAvailable, holdUncaptured: 0 });
    }
    await ctx.runMutation(internal.bookings.beginReturnDecision, {
      bookingId, actualReturnedAt: returned, damageKept: kept, damageNote: kept ? damageNote?.trim() : undefined,
      chargeLate, lateWaiverReason: !chargeLate && quotedLate.amount > 0 ? lateWaiverReason?.trim() : undefined,
      inspection,
    });
    if (kept > 0 && !b.depositRefunded && !b.damageNoticeSentAt) {
      // Resolve again after freezing the decision, never fall back to a linked
      // booking's historical email when its permanent account is missing.
      const noticeContext: any = await ctx.runQuery(internal.bookings.getForRefund, { bookingId });
      if (!noticeContext?.notificationEmail) throw Error("The associated rental account email needs review before a damage deduction can be collected.");
      const notice = damageDeductionEmail({to:noticeContext.notificationEmail,bookingId:String(bookingId),damage:kept,reason:damageNote?.trim()??"",
        url:`${process.env.APP_URL ?? "https://dbcinemarentals.com"}/account?rental=${encodeURIComponent(String(bookingId))}#chat`});
      const sent = await sendMail({
        ...notice,
        deliveryKey:`rental-damage-${createHash("sha256").update(JSON.stringify([bookingId,notice.to,noticeContext.returnDecision])).digest("hex")}`,
      });
      if (!sent) throw new Error("The itemised deduction notice could not be delivered. No damage amount was captured; please retry after fixing email delivery.");
      await ctx.runMutation(internal.bookings.markDamageNoticeSent, { bookingId, recipientEmail: notice.to });
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
        capturedFromHold = Math.min(kept, observedHoldAmounts(b, hold).available);
        if (capturedFromHold > 0) {
          const capture=await sb.paymentIntents.capture(hold.id, { amount_to_capture: pence(capturedFromHold) }, { idempotencyKey: `dbc-hold-capture-${bookingId}` });
          if(capture.id!==hold.id||capture.status!=="succeeded"||capture.currency!=="gbp"||capture.amount_received!==pence(capturedFromHold))throw Error("The damage capture is not confirmed. Resume this saved return after the original card authorisation is reconciled; no cash deposit refund has been requested.");
        } else if (late.amount === 0) {
          await sb.paymentIntents.cancel(hold.id, {}, { idempotencyKey: `dbc-hold-release-${bookingId}` });
        }
        if (capturedFromHold > 0 || late.amount === 0)
          await ctx.runMutation(internal.bookings.setHold, {
            bookingId, intentId: hold.id, status: capturedFromHold ? "captured" : "released",
          });
      } else if (hold.status === "succeeded") {
        capturedFromHold = Math.min(kept, observedHoldAmounts(b,hold).available);
      } else if (["processing","requires_action","requires_confirmation"].includes(hold.status)) {
        throw Error("The original security authorisation needs reconciliation before any cash deposit refund. Resume the saved return after the card status is resolved.");
      }
    }
    const capturedSecurity = sources.reduce((sum:number,source:any)=>sum+source.securityPence,0);
    const toRefund = returnSecurityPlan({ deposit, capturedSecurity: capturedSecurity / 100, damage: kept, holdAvailable: capturedFromHold, holdUncaptured: 0 }).depositRefund;
    const refundablePence = pence(toRefund);
    const job:any=await ctx.runMutation(internal.returnSecurity.prepare,{bookingId,kept,capturedFromHold,...(damageNote?.trim()?{note:damageNote.trim()}:{}),allocations:securityReturnPlan(sources,refundablePence)});
    const result=await settleReturnRefunds(ctx,job,true);
    const refunded=result.job.allocations.filter((a:any)=>a.status==="succeeded").reduce((n:number,a:any)=>n+a.amountPence,0)/100;
    return { ok: true, released: refunded, kept, lateAmount: late.amount, alreadyReleased: false,refundStatus:result.job.status,refundExpected:refundablePence/100 };
  },
});

export const finalize = action({
  args: { sessionId: v.string() },
  handler: async (
    ctx,
    { sessionId },
  ): Promise<{ bookingId: string | null; paid: boolean; closed?: boolean; membership?: string; holdStatus?: string; holdClientSecret?: string;cardSaved?:boolean;additionId?:string;updateApplied?:boolean;updateKind?:"swap"|"draft"|"addition" }> => {
    const session = await stripe().checkout.sessions.retrieve(sessionId);
    const m = session.metadata ?? {};
    const paid = checkoutCompleted(session);
    if(m.pickupCardBookingId){const bookingId=await recoverPickupCard(ctx,session);if(!bookingId)throw Error("This card update is no longer current. Refresh your rental account.");const b:any=await ctx.runQuery(internal.pickupSecurity.context,{bookingId:bookingId as any});return {bookingId,paid,holdStatus:b?.depositHoldStatus??"none",cardSaved:true};}
    if(m.filmFundEntryId){const r=await ctx.runAction(internal.filmFundPayments.fulfill,{sessionId});return {bookingId:null,paid:r.paid};}

    if(paid&&m.rentalAdditionId){const r=await ctx.runAction(internal.rentalAdditions.finalizePaid,{id:m.rentalAdditionId as any,sessionId});return {bookingId:r.bookingId,paid,closed:r.closed,holdStatus:r.status,holdClientSecret:r.clientSecret,additionId:m.rentalAdditionId,updateApplied:r.updateApplied,updateKind:r.updateKind};}
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
      if(m.pickupCardBookingId){await recoverPickupCard(ctx,await stripe().checkout.sessions.retrieve(s.id));return true;}
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
    if (["payment_intent.amount_capturable_updated","payment_intent.payment_failed","payment_intent.canceled"].includes(event.type)) {
      const intent=event.data.object as Stripe.PaymentIntent;
      if(intent.metadata?.purpose==="pickup_security_hold"&&intent.metadata.bookingId){
        await ctx.runAction(internal.holdRenewal.reconcilePickupWebhook,{bookingId:intent.metadata.bookingId as any,intentId:intent.id});
      }
      if(intent.metadata?.purpose==="security_hold_renewal"&&intent.metadata.bookingId){
        await ctx.runAction(internal.holdRenewal.reconcileRenewalWebhook,{bookingId:intent.metadata.bookingId as any,intentId:intent.id});
      }
    }
    if (["refund.created","refund.updated","refund.failed"].includes(event.type)) {
      const snapshot=event.data.object as Stripe.Refund;
      const refund=await stripe().refunds.retrieve(snapshot.id);
      if(refund.id!==snapshot.id)throw Error("Refund provider identity mismatch");
      if(refund.metadata?.returnSecurityId){
        const bookingId=refund.metadata.bookingId;if(!bookingId)throw Error("Missing deposit refund booking binding.");
        const job:any=await ctx.runQuery(internal.returnSecurity.context,{bookingId:bookingId as any});
        const allocation=job?.allocations.find((a:any)=>a.paymentIntentId===refund.metadata?.returnPaymentIntent);
        if(!job||job._id!==refund.metadata.returnSecurityId||!allocation)throw Error("Unknown deposit refund allocation.");
        const previous=allocation.history?.find((r:any)=>r.stripeRefundId===refund.id);
        assertReturnRefund(refund,job,previous?{...allocation,attempt:previous.attempt}:allocation);
        await settleReturnRefunds(ctx,job,false);
      }
      const id=refund.metadata?.rentalRefundId;
      if(id){
       const job:any=await ctx.runQuery(internal.rentalOperations.refundReceipt,{id:id as any});
       if(!job)throw Error("Unknown rental refund receipt");
       const source=refund.metadata?.rentalPaymentIntent;
       if(source){
        const allocation=job.allocations?.find((p:any)=>p.paymentIntentId===source);
        if(!allocation)throw Error("Unknown rental refund allocation");
        assertRentalRefundReceipt(refund,job,allocation);
       }else{
        const booking:any=await ctx.runQuery(internal.rentalOperations.refundContext,{bookingId:job.bookingId});
        const payment=typeof refund.payment_intent==="string"?refund.payment_intent:refund.payment_intent?.id;
        if(job.allocations||!booking||payment!==booking.stripePaymentIntentId||refund.amount!==job.amountPence||refund.currency!=="gbp"||refund.metadata?.bookingId!==job.bookingId)
         throw Error("The legacy refund receipt does not match its rental.");
       }
       await refreshRentalRefundReceipts(ctx,id,refund.id);
      }
      await reconcileFullyRefundedMembership(ctx,refund);
      await ctx.runAction(internal.filmFundPayments.reconcileRefund,{refundId:refund.id});
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
    let hold = await sb.paymentIntents.retrieve(id);
    if (["requires_capture", "requires_action", "requires_confirmation", "requires_payment_method"].includes(hold.status)) {
      hold = await sb.paymentIntents.cancel(id, {}, { idempotencyKey: `dbc-cancel-hold-${bookingId}-${id}` });
    }
    if (hold.status === "succeeded" || hold.amount_received > 0)
      throw new RefundReviewRequired("The security authorisation has a captured charge. The team must review its settlement before cancellation can finish.");
    if (hold.status !== "canceled") throw Error("The security hold is still processing. Cancellation will resume after settlement.");
    if (id === b.stripeDepositIntentId)
      await ctx.runMutation(internal.bookings.setHold, { bookingId, intentId: id, status: "released" });
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

async function remainingCancellationPayment(payment: Stripe.PaymentIntent, maxPaidPence?: number, knownRefunds?:Stripe.Refund[]) {
  const refunds:Stripe.Refund[]=knownRefunds??[];
  if(!knownRefunds)for await(const refund of stripe().refunds.list({payment_intent:payment.id,limit:100}))refunds.push(refund);
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

async function cancelRental(ctx:any,bookingId:any,b:any,accountId?:any,adminReason?:string,fullCreditOfferId?:any,changeRequestId?:any,expectedCancellationKind?:"full_refund"|"store_credit",customerInitiated=false){
 const requestId=changeRequestId??b.cancellationDecision?.changeRequestId;
 const decision=await ctx.runMutation(internal.bookings.prepareCancellation,{bookingId,fullCreditOfferId,customerInitiated,...(requestId?{changeRequestId:requestId}:{}),...(expectedCancellationKind?{expectedCancellationKind}:{})});
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
 const job:any=await ctx.runMutation(internal.cancellationRecovery.claim,{bookingId,accountId,adminReason,legacy:!!decision.quote});
 const pending=()=>new ConvexError({code:"CANCELLATION_PENDING",message:"Cancellation settlement is processing. Any required Stripe approval must be completed by the team. We will finish automatically once the refund and security release are confirmed."});
 if(!job)throw pending();
 let complete=false,review=false;
 try{
  for(const receipt of job.receipts){
   const persist=async(receipt:any)=>{await ctx.runMutation(internal.cancellationRecovery.receipt,{id:job._id,generation:job.generation,receipt});};
   const result=await recoverApprovedRefund(stripe(),receipt,{currency:b.currency,now:Date.now(),persist,
    idempotencyKey:receipt.paymentIntentId===quote.paymentIntentId?`dbc-cancel-refund-${bookingId}`:`dbc-cancel-refund-${bookingId}-${receipt.paymentIntentId}`,
    ...(!job.legacy?{metadata:{rentalCancellationId:job._id,bookingId:String(bookingId),rentalPaymentIntent:receipt.paymentIntentId}}:{})});
   await persist(result);
   if(result.status==="failed")throw new ConvexError({code:"CANCELLATION_REVIEW",message:"Stripe could not complete this refund. The team must review the existing request; no second refund has been issued."});
   if(result.status!=="succeeded")throw pending();
  }
  await releaseBookingHolds(ctx,bookingId,b);
  await ctx.runMutation(internal.bookings._finalizeCancellation,{bookingId,accountId:job.accountId,mode:quote.mode,refundAmount:quote.refundAmount,creditAmount:quote.creditAmount,currency:b.currency,adminReason:job.adminReason});
  if(decision.fullCreditOfferId)await ctx.runMutation(internal.rentalCreditOffers.accepted,{offerId:decision.fullCreditOfferId});
  complete=true;
  return {ok:true,mode:quote.mode,refundAmount:quote.refundAmount,creditAmount:quote.creditAmount};
 }catch(error){review=error instanceof RefundReviewRequired;throw error;}
 finally{await ctx.runMutation(internal.cancellationRecovery.finishAttempt,{id:job._id,generation:job.generation,complete,review});}
}

/** Retry only durable, already-requested cancellations; never initiate a new cancellation. */
export const reconcileCancellations=internalAction({args:{},handler:async(ctx)=>{
 const jobs:any[]=await ctx.runQuery(internal.cancellationRecovery.due,{});
 for(const job of jobs){
  try{
   const b:any=await ctx.runQuery(internal.bookings.getForCancel,{bookingId:job.bookingId});
   if(b?.status==="cancelled"){await ctx.runMutation(internal.cancellationRecovery.finishAttempt,{id:job._id,complete:true,generation:job.generation});continue;}
   const customerInitiated=!job.adminReason;
   if(customerInitiated&&b?.rentalStarted){
    await ctx.runMutation(internal.cancellationRecovery.finishAttempt,{id:job._id,complete:false,generation:job.generation,review:true});
    continue;
   }
   if(b?.cancellationDecision?.quote)await cancelRental(ctx,job.bookingId,b,job.accountId,job.adminReason,b.cancellationDecision.fullCreditOfferId,undefined,undefined,customerInitiated);
  }catch{/* The durable ledger retains provider receipts and the next retry. */}
 }
 return {checked:jobs.length};
}});
/** Read-only provider quote. Gaffer can offer, but only the renter can accept. */
export const offerFullCredit = internalAction({
 args:{accountId:v.id("accounts"),bookingId:v.id("bookings")},
 handler:async(ctx,args):Promise<any>=>{
  if(process.env.CUSTOMER_BOOKING_ACTIONS!=="true")return null;
  const booking:any=await ctx.runQuery(internal.rentalCreditOffers.context,{bookingId:args.bookingId});
  if(!booking)return null;
  try{assertCreditOffer({...args,fingerprint:creditOfferFingerprint(booking),expiresAt:Date.now()+1000},booking);}catch{return null;}
  const b:any=await ctx.runQuery(internal.bookings.getForCancel,{bookingId:args.bookingId});
  if(!b?.siteOnly||b.accountId!==args.accountId||b.cancellationDecision||b.rentalStarted)return null;
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
  if(b.rentalStarted)throw Error(STARTED_RENTAL_REFUND_MESSAGE);
  const result=await cancelRental(ctx,offer.bookingId,b,me._id,undefined,offerId,undefined,undefined,true);
  await ctx.runMutation(internal.rentalCreditOffers.accepted,{offerId});return result;
 }
});
/** Read-only provider-backed settlement preview; never expires checkout or releases a hold. */
export const cancellationPreview = action({
 args:{token:v.string(),bookingId:v.id("bookings")},
 handler:async(ctx,{token,bookingId}):Promise<{kind:"full_refund"|"store_credit";refundAmount:number;creditAmount:number;holdReleaseAmount:number;checkedAt:number}>=>{
  await ctx.runMutation(internal.adminAuth.assertAdminInternal,{token,fn:"checkout.cancellationPreview"});
  const b:any=await ctx.runQuery(internal.bookings.getForCancel,{bookingId});
  if(!b||!["confirmed","pending_payment"].includes(b.status)||!b.siteOnly)throw Error("Only unstarted direct bookings can be previewed here.");
  if(b.cancellationDecision?.fullCreditOfferId)throw Error("An accepted credit offer is already processing. Use its settlement controls.");
  let sources=b.paymentSources??[];
  if(!sources.length&&b.status==="pending_payment"&&b.stripeCheckoutSessionId){
   const session=await stripe().checkout.sessions.retrieve(b.stripeCheckoutSessionId);
   if(session.status==="complete"&&checkoutCompleted(session)){
    const intent=await checkoutPaymentIntent(session);
    if(intent)sources=[{paymentIntentId:intent,securityPence:pence(b.depositAmount)}];
   }else if(!["open","expired"].includes(session.status??""))throw Error("Checkout payment is still processing. Wait before cancellation.");
  }
  const balances=await Promise.all(sources.map(async(source:any)=>{
   const payment=await stripe().paymentIntents.retrieve(source.paymentIntentId);
   if(payment.status!=="succeeded"||payment.currency!=="gbp")throw Error("A rental payment needs review before settlement can be previewed.");
   return {...source,availablePence:await remainingCancellationPayment(payment,source.maxPaidPence)};
  }));
  const plan=cancellationPaymentPlan(b.cancellationKind,balances,b.status==="confirmed"?pence(b.creditApplied??0):0);
  let holdPence=0;
  const ids=[...new Set([b.stripeDepositIntentId,b.depositHoldRenewalIntentId,...(b.depositHoldPreviousIntentIds??[])].filter((id):id is string=>!!id))];
  for(const id of ids){
   const hold=await stripe().paymentIntents.retrieve(id);
   if(hold.status==="succeeded"||hold.amount_received>0)throw Error("The security authorisation has a captured charge. Review its settlement first.");
   if(hold.status==="requires_capture"){
    if(hold.currency!=="gbp"||!Number.isSafeInteger(hold.amount_capturable)||hold.amount_capturable<0)throw Error("The security authorisation needs review.");
    holdPence+=hold.amount_capturable;
   }else if(!["canceled","requires_action","requires_confirmation","requires_payment_method"].includes(hold.status))throw Error("The security authorisation is still processing.");
  }
  return {kind:b.cancellationKind,refundAmount:plan.refundPence/100,creditAmount:plan.creditPence/100,holdReleaseAmount:holdPence/100,checkedAt:Date.now()};
 }
});
export const cancelByAdmin = action({
 args:{token:v.string(),bookingId:v.id("bookings"),reason:v.string(),changeRequestId:v.optional(v.id("rental_change_requests")),expectedCancellationKind:v.optional(v.union(v.literal("full_refund"),v.literal("store_credit")))},
 handler:async(ctx,{token,bookingId,reason,changeRequestId,expectedCancellationKind}):Promise<{refundAmount:number;creditAmount:number;mode:string}>=>{
  await ctx.runMutation(internal.adminAuth.assertAdminInternal,{token,fn:"checkout.cancelByAdmin"});
  if(reason.trim().length<5)throw Error("Record the cancellation reason");
  const b:any=await ctx.runQuery(internal.bookings.getForCancel,{bookingId});
  if(changeRequestId && b?.status==="cancelled" && b.completedChangeRequestId===changeRequestId && b.cancellationDecision?.quote)return {refundAmount:b.cancellationDecision.quote.refundAmount,creditAmount:b.cancellationDecision.quote.creditAmount,mode:b.cancellationDecision.quote.mode};
  if(!b||!["confirmed","pending_payment"].includes(b.status)||!b.siteOnly)throw Error("Only unstarted direct bookings can be cancelled here");
  return cancelRental(ctx,bookingId,b,b.accountId??undefined,reason.trim().slice(0,400),undefined,changeRequestId,expectedCancellationKind);
 }
});
/** Abandoning an unpaid checkout remains available without enabling paid self-service actions. */
export const cancelUnpaidByCustomer = action({
 args:{token:v.string(),bookingId:v.id("bookings")},
 handler:async(ctx,{token,bookingId}):Promise<{ok:boolean;mode:string;refundAmount:number;creditAmount:number}>=>{
  const me:any=await ctx.runQuery(api.accounts.me,{token});if(!me)throw Error("Please sign in.");
  const b:any=await ctx.runQuery(internal.bookings.getForCancel,{bookingId});
  if(!belongsToRentalAccount(b,me))throw Error("unauthorized");
  if(b.status!=="pending_payment"||!b.siteOnly)throw Error("Only unpaid direct checkouts can be abandoned here.");
  if(b.rentalStarted)throw Error(STARTED_RENTAL_REFUND_MESSAGE);
  return cancelRental(ctx,bookingId,b,me._id,undefined,undefined,undefined,undefined,true);
 }
});
export const cancelByCustomer = action({
 args:{token:v.string(),bookingId:v.id("bookings")},
 handler:async(ctx,{token,bookingId}):Promise<{ok:boolean;mode:string;refundAmount:number;creditAmount:number}>=>{
  if(process.env.CUSTOMER_BOOKING_ACTIONS!=="true")throw Error("Online cancellation isn't available yet — please contact us to cancel.");
  const me:any=await ctx.runQuery(api.accounts.me,{token});if(!me)throw Error("Please sign in.");
  const b:any=await ctx.runQuery(internal.bookings.getForCancel,{bookingId});
  if(!belongsToRentalAccount(b,me))throw Error("unauthorized");
  if(b.cancelledAt||b.status==="cancelled")throw Error("This booking is already cancelled.");
  if(!["confirmed","pending_payment"].includes(b.status)||!b.siteOnly)throw Error("Please contact us to change this booking.");
  if(b.rentalStarted)throw Error(STARTED_RENTAL_REFUND_MESSAGE);
  return cancelRental(ctx,bookingId,b,me._id,undefined,undefined,undefined,undefined,true);
 }
});

function assertRentalRefundReceipt(refund: Stripe.Refund, job: any, allocation: any) {
 const payment=typeof refund.payment_intent==="string"?refund.payment_intent:refund.payment_intent?.id;
 if(payment!==allocation.paymentIntentId||refund.amount!==allocation.amountPence||refund.currency!=="gbp"||
    refund.metadata?.rentalRefundId!==job._id||refund.metadata?.bookingId!==job.bookingId||
    refund.metadata?.rentalPaymentIntent!==allocation.paymentIntentId)
  throw Error("The provider refund does not match its saved rental allocation. Reconcile the existing receipt before retrying.");
}
/** Recover an unrecorded result before creating money, including after Stripe's
 * idempotency retention expires. This is scoped to the original payment only. */
async function rentalRefundForAllocation(ctx:any,job:any,allocation:any,part:any,first:boolean) {
 if(part?.stripeRefundId){
  const refund=await stripe().refunds.retrieve(part.stripeRefundId);
  assertRentalRefundReceipt(refund,job,allocation);return refund;
 }
 let existing:Stripe.Refund|undefined,count=0;
 const history:Stripe.Refund[]=[];
 for await(const refund of stripe().refunds.list({payment_intent:allocation.paymentIntentId,limit:100})){
  if(++count>1000)throw Error("The original payment refund history needs reconciliation before another refund request.");
  history.push(refund);
  if(refund.metadata?.rentalRefundId!==job._id)continue;
  assertRentalRefundReceipt(refund,job,allocation);
  if(existing)throw Error("Multiple provider refunds match this rental allocation. Reconcile them before retrying.");
  existing=refund;
 }
 if(existing)return existing;
 const sources:any[]=await ctx.runQuery(internal.rentalOperations.paymentSources,{bookingId:job.bookingId});
 const source=sources.find(s=>s.paymentIntentId===allocation.paymentIntentId);
 if(!source)throw Error("The original refund payment no longer belongs to this rental. Reconcile the saved allocation.");
 const payment=await stripe().paymentIntents.retrieve(allocation.paymentIntentId);
 if(payment.id!==allocation.paymentIntentId||payment.currency!=="gbp"||payment.status!=="succeeded")
  throw Error("The original rental payment identity, currency or capture status needs review before a refund.");
 const available=await remainingCancellationPayment(payment,source.maxPaidPence,history);
 if(allocation.amountPence>Math.max(0,available-source.securityPence))
  throw Error("The original payment no longer covers this rental refund while protecting refundable security. Reconcile its existing refunds.");
 const refund=await stripe().refunds.create({payment_intent:allocation.paymentIntentId,amount:allocation.amountPence,
  metadata:{rentalRefundId:job._id,rentalPaymentIntent:allocation.paymentIntentId,bookingId:job.bookingId}},
  {idempotencyKey:first?`dbc-rental-refund-${job._id}`:`dbc-rental-refund-${job._id}-${allocation.paymentIntentId}`});
 assertRentalRefundReceipt(refund,job,allocation);return refund;
}

/** No new charge, refund creation or account credit. An existing accepted swap
 * can complete from confirmed receipts. Validate all parts before recording them. */
type RefundRefreshResult={status:string;amount:number;confirmed:number;processing:number;outstanding:number;stale:boolean};
async function refreshRentalRefundReceipts(ctx:any,id:any,callbackRefundId?:string):Promise<RefundRefreshResult>{
 const {job,generation}=await ctx.runMutation(internal.rentalOperations.beginRefundRefresh,{id});
 const observations:{paymentIntentId?:string;refund:Stripe.Refund}[]=[];
 if(job.allocations){
  if(!job.allocations.length||job.allocations.length>200||job.allocations.some((p:any)=>!Number.isSafeInteger(p.amountPence)||p.amountPence<=0)||new Set(job.allocations.map((p:any)=>p.paymentIntentId)).size!==job.allocations.length||
     job.allocations.reduce((sum:number,p:any)=>sum+p.amountPence,0)!==job.amountPence)throw Error("The saved refund allocations need reconciliation.");
  for(const allocation of job.allocations){
   const part=job.parts?.find((p:any)=>p.paymentIntentId===allocation.paymentIntentId);
   let refund:Stripe.Refund|undefined;
   if(part?.stripeRefundId)refund=await stripe().refunds.retrieve(part.stripeRefundId);
   else{
    let count=0;
    for await(const candidate of stripe().refunds.list({payment_intent:allocation.paymentIntentId,limit:100})){
     if(++count>1000)throw Error("The original payment refund history needs reconciliation.");
     if(candidate.metadata?.rentalRefundId!==job._id)continue;
     if(refund)throw Error("Multiple provider refunds match this rental allocation.");
     refund=candidate;
    }
   }
   if(!refund)continue;
   if(part?.stripeRefundId&&refund.id!==part.stripeRefundId)throw Error("Refund provider identity mismatch");
   assertRentalRefundReceipt(refund,job,allocation);observations.push({paymentIntentId:allocation.paymentIntentId,refund});
  }
 }else if(job.stripeRefundId||callbackRefundId){
  if(job.stripeRefundId&&callbackRefundId&&job.stripeRefundId!==callbackRefundId)throw Error("Refund identity mismatch");
  const receiptId=job.stripeRefundId??callbackRefundId;
  const refund=await stripe().refunds.retrieve(receiptId),booking=await ctx.runQuery(internal.rentalOperations.refundContext,{bookingId:job.bookingId});
  const payment=typeof refund.payment_intent==="string"?refund.payment_intent:refund.payment_intent?.id;
  if(refund.id!==receiptId||!booking||payment!==booking.stripePaymentIntentId||refund.amount!==job.amountPence||refund.currency!=="gbp"||
     refund.metadata?.rentalRefundId!==job._id||refund.metadata?.bookingId!==job.bookingId)throw Error("The legacy refund receipt does not match its rental.");
  observations.push({refund});
 }
 const receipts=observations.map(({paymentIntentId,refund})=>({...(paymentIntentId?{paymentIntentId}:{}),stripeRefundId:refund.id,
  status:refund.status==="succeeded"?"succeeded" as const:refund.status==="failed"||refund.status==="canceled"?"failed" as const:"pending" as const,...(refund.failure_reason?{failureReason:refund.failure_reason}:{})}));
 const {job:current,stale}=await ctx.runMutation(internal.rentalOperations.recordRefundObservation,{id:job._id,generation,receipts});
 const confirmed=current.parts?current.parts.filter((p:any)=>p.status==="succeeded").reduce((n:number,p:any)=>n+p.amountPence,0):current.status==="succeeded"?current.amountPence:0;
 const processing=current.parts?current.parts.filter((p:any)=>p.status==="pending").reduce((n:number,p:any)=>n+p.amountPence,0):current.status==="pending"?current.amountPence:0;
 return {status:current.status,amount:current.amountPence/100,confirmed:confirmed/100,processing:processing/100,outstanding:Math.max(0,current.amountPence-confirmed-processing)/100,stale};
}
export const refreshRentalRefund=action({args:{token:v.string(),bookingId:v.id("bookings"),id:v.id("rental_refunds")},handler:async(ctx,args):Promise<RefundRefreshResult>=>{
 await ctx.runMutation(internal.adminAuth.assertAdminInternal,{token:args.token,fn:"checkout.refreshRentalRefund"});
 const job=await ctx.runQuery(internal.rentalOperations.refundReceipt,{id:args.id});
 if(!job||job.bookingId!==args.bookingId)throw Error("The refund belongs to another rental.");
 return refreshRentalRefundReceipts(ctx,job._id);
}});

/** Owner-only, durable and idempotent rental refund. Security is handled by return/cancel. */
export const refundSwap=action({
 args:{token:v.string(),bookingId:v.id("bookings"),id:v.id("rental_change_requests"),quoteKey:v.string()},
 handler:async(ctx,args):Promise<any>=>{
  const job:any=await ctx.runMutation(internal.rentalSwaps.prepareRefundSwap,args);
  const result=await ctx.runAction(api.checkout.refundRental,{token:args.token,bookingId:job.bookingId,requestId:job.requestId,amountPence:job.amountPence,reason:job.reason});
  const kit=await ctx.runMutation(internal.rentalSwaps.finishRefundSwap,{id:job._id});
  return {...result,...kit};
 }
});
async function executePreparedRentalRefund(ctx:any,job:any):Promise<{status:string;amount:number}>{
  if(job.status==="succeeded"||job.status==="failed")return {status:job.status,amount:job.amountPence/100};
  const compound=job.swapProposalId?await ctx.runQuery(internal.rentalSwaps.compoundRefundContext,{id:job._id}):null;
  if(compound)await ctx.runAction(internal.rentalAdditions.attestCompoundPayment,{id:compound.addition._id});
  // Resume receipts produced by the previous single-payment implementation without charging again.
  if(job.stripeRefundId&&!job.allocations)return refreshRentalRefundReceipts(ctx,job._id);
  let allocations=job.allocations;
  if(!allocations){const sources=await ctx.runQuery(internal.rentalOperations.paymentSources,{bookingId:job.bookingId});const balances=await Promise.all(sources.map(async(source:any)=>{
   const payment=await stripe().paymentIntents.retrieve(source.paymentIntentId);
   if(payment.id!==source.paymentIntentId||payment.currency!=="gbp"||payment.status!=="succeeded")throw Error("The original rental payment identity, currency or capture status needs review before a refund.");
   return {...source,availablePence:await remainingCancellationPayment(payment,source.maxPaidPence)};
  }));allocations=await ctx.runMutation(internal.rentalOperations.bindRefundAllocations,{id:job._id,allocations:rentalRefundPlan(balances,job.amountPence)});}
  const observation=await ctx.runMutation(internal.rentalOperations.beginRefundRefresh,{id:job._id});
  const receipts:{paymentIntentId:string;stripeRefundId:string;status:"pending"|"succeeded"|"failed";failureReason?:string}[]=[];
  for(const allocation of allocations){
   const part=observation.job.parts?.find((p:any)=>p.paymentIntentId===allocation.paymentIntentId);
   const refund=await rentalRefundForAllocation(ctx,job,allocation,part,allocation.paymentIntentId===allocations[0].paymentIntentId);
   const result=refund.status==="succeeded"?"succeeded":refund.status==="failed"||refund.status==="canceled"?"failed":"pending";
   receipts.push({paymentIntentId:allocation.paymentIntentId,stripeRefundId:refund.id,status:result,...(refund.failure_reason?{failureReason:refund.failure_reason}:{})});
  }
  const recorded=await ctx.runMutation(internal.rentalOperations.recordRefundObservation,{id:job._id,generation:observation.generation,receipts});
  return {status:recorded.job!.status,amount:job.amountPence/100};
}
export const settleCompoundSwap=internalAction({args:{id:v.id("rental_additions")},handler:async(ctx,{id}):Promise<any>=>{
 const state:any=await ctx.runQuery(internal.rentalAdditionState.context,{id});
 const refundId=state?.swapProposal?.settlementRefundId;
 if(!refundId||state.swapProposal.settlementAdditionId!==id)throw Error("The combined swap settlement is not bound.");
 const job:any=await ctx.runQuery(internal.rentalOperations.refundReceipt,{id:refundId});
 if(!job||job.swapProposalId!==state.swapProposal._id||job.bookingId!==state.addition.bookingId)throw Error("The combined swap refund belongs to another rental.");
 const result=await executePreparedRentalRefund(ctx,job);
 const kit=await ctx.runMutation(internal.rentalSwaps.finishRefundSwap,{id:job._id});
 return {...result,...kit};
}});
export const refundRental=action({
 args:{token:v.string(),bookingId:v.id("bookings"),requestId:v.string(),amountPence:v.optional(v.number()),reason:v.string()},
 handler:async(ctx,args):Promise<{status:string;amount:number}>=>{
  const job:any=await ctx.runMutation(internal.rentalOperations.prepareRefund,args);
  return executePreparedRentalRefund(ctx,job);
 }
});
