"use node";
import {depositRefundState,depositRefundStatementFields} from "../shared/depositRefundStatus";
import {isAllowedReturnTime} from "../src/lib/site";

import Stripe from "stripe";
import {operatorCancellationOptions} from "../shared/operatorCancellationCredit";
import { isPickupHoldPolicyVersion, pickupHoldEligible } from "../shared/pickupSecurity";
import { ASSESSMENT_SECURITY_POLICY_VERSION, CARD_HOLD_SECURITY_POLICY_VERSION, hasCashDepositPolicy, isCardHoldSecurityPolicy, SECURITY_POLICY_VERSION, REFUNDABLE_DEPOSIT_POLICY_VERSION, SETUP_INTENT_SECURITY_POLICY_VERSION, isSetupIntentSecurityPolicy } from "../shared/rentalSecurity";
import { isSavedCardRental, savedCardRentalValue } from "../shared/savedCardSecurity";
import { returnSecurityPlan, refundableDepositPlan } from "../shared/returnSettlement";
import { returnStatementEmail, type ReturnStatementData } from "../shared/returnStatement";
import type { InspectionInput } from "../shared/returnInspection";
import { rentalRefundBalance } from "./lib/rentalRefundBalance";
import { recoverApprovedRefund, RefundReviewRequired, type RefundReceipt } from "./lib/approvedRefund";
import { belongsToRentalAccount } from "./lib/rentalAccount";
import { createHash } from "node:crypto";
import { action, internalAction } from "./_generated/server";
import { internal, api } from "./_generated/api";
import { v, ConvexError } from "convex/values";
import { swapAuthorityAvailable } from "./lib/rentalSwapAuthority";
import { inspectionInput } from "./lib/returnInspectionFields";
import { assertCreditOffer, creditOfferFingerprint } from "./lib/rentalCreditPolicy";
import { cancellationPaymentPlan,rentalRefundPlan,securityReturnPlan } from "./lib/rentalPaymentPlan";
import { lateFeeQuote } from "./lib/lateFee";
import { assertCurrentAgreement, agreementRequestFingerprint } from "../shared/rentalAgreement";
import { sendMail } from "./lib/mailer";
import { assertDiditCheckoutCapacity } from "./lib/diditCapacity";
import { ensureCheckoutCustomer } from "./lib/stripeCustomer";
import { tierByKey, TIERS } from "./lib/membership";
import { checkoutLineAllocation } from "../shared/checkoutLineAllocation";
import { cancellationSettlement } from "../src/lib/cancellationPolicy";
import { MEMBERSHIP_BASKET_MINIMUM } from "../shared/checkoutMembershipCredit";
import { calculateRentalPrice } from "./lib/rentalPrice";
import { paidRecurringMembership } from "./lib/membershipBilling";
import { resolveMembershipInvoiceSnapshot, type MembershipPriceSnapshot } from "./lib/membershipInvoiceSnapshot";
import { MEMBERSHIP_TERMS_VERSION,membershipActiveNow,membershipTierFor } from "../shared/membership";

const pence = (gbp: number) => Math.round(gbp * 100);
const subActive = (status: string) => status === "active" || status === "trialing";
const deliveryDate = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "Europe/London" });
const deliveryPeriod = (start: number, end: number) => start === end
  ? deliveryDate.format(new Date(start))
  : `${deliveryDate.format(new Date(start))}–${deliveryDate.format(new Date(end))}`;

type PriceQuoteResult = {
  replacementValue: number;
  savedCardLimit: number;
  securityPolicyVersion: string;
  cancellationProtectionEnabled:boolean;
  benefitKind:string;refundCreditApplied:number;earnedCreditApplied:number;
  items: { title: string; total: number }[];
  subtotal: number;
  depositHoldAmount: number;
  depositAmount: number;
  quotedDeliveryFee: number;
  deliveryFee: number;
  deliveryGroups: {start:number;end:number;quotedFee:number;fee:number;oneWay:number;vehicle:string;vehicleLabel:string;km:number;load:number}[];
  reductionLabel?: string;
  totalReduction: number;
  creditApplied: number;
  availableAccountCredit:number;
  creditUseSelected:boolean;
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
    useAccountCredit:v.optional(v.boolean()),
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
        return {tier:tier.key,intro,membershipSignupOfferSaving:preview.membershipSignupOfferSaving,name:tier.name,monthlyFee:tier.monthlyGbp,monthlyCredit:tier.monthlyCredit,rentalSaving,deliverySaving,initialFee:preview.membershipFee,membershipCreditApplied:preview.membershipCreditApplied,netSaving:netSaving(preview),depositWaived:base.depositAmount>0&&preview.depositAmount===0};
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
      savedCardLimit: price.savedCardLimit,
      securityPolicyVersion: price.securityPolicyVersion,
      cancellationProtectionEnabled:process.env.CANCELLATION_PROTECTION_POLICY_ENABLED==="true"&&price.securityPolicyVersion===ASSESSMENT_SECURITY_POLICY_VERSION,
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
      deliveryGroups: price.deliveryGroups,
      reductionLabel: price.reductionLabel,
      totalReduction: price.totalReduction,
      benefitKind: price.benefitKind,
      refundCreditApplied: price.refundCreditApplied,
      earnedCreditApplied: price.earnedCreditApplied,
      creditApplied: price.creditApplied,
      availableAccountCredit:price.availableAccountCredit,creditUseSelected:price.creditUseSelected,
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
    useAccountCredit:v.optional(v.boolean()),
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
    expectedSavedCardLimit: v.optional(v.number()),
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
    if ((/^(sk|rk|rkcs)_live_/.test(process.env.STRIPE_SECRET_KEY??"") && process.env.DIDIT_ENVIRONMENT !== "live") ||
        (/^(sk|rk|rkcs)_test_/.test(process.env.STRIPE_SECRET_KEY??"") && process.env.DIDIT_ENVIRONMENT !== "sandbox"))
      throw new Error("Payment and identity verification environments do not match.");
    if (!process.env.STRIPE_WEBHOOK_SECRET || !process.env.INVOICE_SECRET || !process.env.APP_URL ||
        !process.env.BUSINESS_LEGAL_NAME || !process.env.BUSINESS_INVOICE_ADDRESS ||
        !((process.env.GMAIL_USER && process.env.GMAIL_APP_PASSWORD) || process.env.RESEND_API_KEY))
      throw new Error("Rental receipts and payment notifications are being configured. Please contact us before paying.");
    const cfg: any = await ctx.runQuery(api.settings.get, {});
    if (!cfg.acceptingOrders)
      throw new Error("We're not accepting new bookings right now — please check back soon.");
    const checkoutSecurityPolicyVersion=process.env.SETUP_INTENT_SECURITY_POLICY_ENABLED==="true"?SETUP_INTENT_SECURITY_POLICY_VERSION:process.env.CARD_HOLD_SECURITY_POLICY_ENABLED==="true"?CARD_HOLD_SECURITY_POLICY_VERSION:process.env.ASSESSMENT_SECURITY_POLICY_ENABLED==="true"?ASSESSMENT_SECURITY_POLICY_VERSION:process.env.REFUNDABLE_DEPOSIT_POLICY_ENABLED==="true"?REFUNDABLE_DEPOSIT_POLICY_VERSION:SECURITY_POLICY_VERSION;
    const cardHoldPolicy=isCardHoldSecurityPolicy(checkoutSecurityPolicyVersion);
    const setupIntentPolicy=isSetupIntentSecurityPolicy(checkoutSecurityPolicyVersion);
    if (!a.agreement || !a.agreement.name.trim() || !a.agreement.securityHoldConsent || (!cardHoldPolicy && !a.agreement.laterChargeConsent))
      throw new Error("Please sign the rental agreement to continue.");
    if (a.customer.billingAddress.trim().length < 10 || (a.customer.name ?? "").trim().length < 3)
      throw new Error("Enter your full name and billing address for the rental statement.");
    const slot = /^([01]\d|2[0-3]):[0-5]\d$/;
    if (!a.pickupTime || !slot.test(a.pickupTime) || !a.returnTime || !slot.test(a.returnTime) || !isAllowedReturnTime(a.pickupTime) || !isAllowedReturnTime(a.returnTime) || a.items.some(i=>i.pickupTime!==undefined&&!isAllowedReturnTime(i.pickupTime)||i.returnTime!==undefined&&!isAllowedReturnTime(i.returnTime)))
      throw new Error("Choose the agreed pickup and return times before paying.");
    if (!a.agreement?.requestId||!/^[a-zA-Z0-9-]{16,80}$/.test(a.agreement.requestId)) throw Error("Review and sign this booking before paying.");

    const checkoutInputFingerprint=createHash("sha256").update(agreementRequestFingerprint({...a,token:undefined})).digest("hex");
    const priorAttempt=await ctx.runQuery(internal.bookings.checkoutAttempt,{requestId:a.agreement.requestId,checkoutInputFingerprint});
    if(priorAttempt?.sessionId){
      await ctx.runQuery(internal.bookings.assertCheckoutReservation,{bookingId:priorAttempt.bookingId});
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
        if(existing.bookingId) await ctx.runQuery(internal.bookings.assertCheckoutReservation,{bookingId:existing.bookingId});
        const session = await stripe().checkout.sessions.retrieve(existing.sessionId);
        if(priorAttempt&&(session.id!==existing.sessionId||session.metadata?.bookingId!==String(priorAttempt.bookingId)))throw Error("This payment session does not match the saved booking. Contact us before retrying.");
        if (session.status === "open" && session.url) return {url:session.url};
        throw Error("This membership checkout is no longer open.");
      }
      if (existing?.sessionParams) {
        if(existing.bookingId) await ctx.runQuery(internal.bookings.assertCheckoutReservation,{bookingId:existing.bookingId});
        const savedParams=JSON.parse(existing.sessionParams);
        if(priorAttempt&&savedParams.metadata?.bookingId!==String(priorAttempt.bookingId))throw Error("This payment setup does not match the saved booking. Contact us before retrying.");
        const session = await stripe().checkout.sessions.create(savedParams,{idempotencyKey:`dbc-member-checkout-${existing._id}`});
        await ctx.runMutation(internal.membershipBenefits.bindCheckout,{id:existing._id,sessionId:session.id,bookingId:existing.bookingId});
        await ctx.runMutation(internal.bookings.bindCheckoutSession,{bookingId:existing.bookingId,sessionId:session.id});
        if (!session.url) throw Error("Stripe did not return a checkout URL");
        return {url:session.url};
      }
    }

    assertCurrentAgreement({...a.agreement,cancellationProtectionEnabled:process.env.CANCELLATION_PROTECTION_POLICY_ENABLED==="true",securityPolicyVersion:checkoutSecurityPolicyVersion}, a.fulfilment);

    // New checkout must read current upstream stock, not only the scheduled
    // mirror. Existing bound membership recovery above retains its saved URL.
    try { await ctx.runAction(internal.sync.syncHyggloReservations,{force:true}); }
    catch { throw new ConvexError({code:"STOCK_CHECK_UNAVAILABLE",message:"We couldn't check equipment availability. Please try again before paying."}); }

    // Recompute exactly what the renter reviewed, using current listing and account data.
    const price = await calculateRentalPrice(ctx, a);
    if (a.expectedSavedCardLimit !== price.savedCardLimit)
      throw new Error("The equipment value or saved-card limit changed. Review it and explicitly consent again before paying.");
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
    if (!Number.isSafeInteger(Math.round(a.expectedTotalDue * 100)) ||
        Math.round(a.expectedTotalDue * 100) !== Math.round(price.combinedTotalDue * 100))
      throw new Error("Your rental total has changed. Review the updated order summary before paying.");
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
      pricingVersion:price.pricingVersion,benefitKind:price.benefitKind,useAccountCredit:a.useAccountCredit,
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
      cancellationProtectionEnabled:process.env.CANCELLATION_PROTECTION_POLICY_ENABLED==="true"&&price.securityPolicyVersion===ASSESSMENT_SECURITY_POLICY_VERSION,
      savedCardLimit: price.savedCardLimit,
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

    const rentalLineItems: Stripe.Checkout.SessionCreateParams.LineItem[] = a.items.map(
      (i) => ({
        quantity: 1,
        price_data: {
          currency: "gbp",
          unit_amount: pence(i.total),
          product_data: { name: i.title.slice(0, 120) },
        },
      }),
    );
    const deliveryLineItems: Stripe.Checkout.SessionCreateParams.LineItem[] = price.deliveryGroups.map(group => ({
      quantity: 1,
      price_data: {
        currency: "gbp",
        unit_amount: pence(group.quotedFee),
        product_data: { name: `Delivery & collection · ${deliveryPeriod(group.start,group.end)}` },
      },
    }));
    const depositLineItem: Stripe.Checkout.SessionCreateParams.LineItem | null = depositAmount > 0 ? {
      quantity: 1,
      price_data: {
        currency: "gbp",
        unit_amount: pence(depositAmount),
        product_data: {
          name: "Refundable security deposit (refunded after safe return and settlement)",
        },
      },
    } : null;
    const line_items: Stripe.Checkout.SessionCreateParams.LineItem[] = [
      ...rentalLineItems,
      ...deliveryLineItems,
      ...(depositLineItem ? [depositLineItem] : []),
    ];

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
    const allocations=checkoutLineAllocation(a.items.map(i=>i.total),price.deliveryGroups.map(group=>group.fee),totalReduction,price.membershipCreditApplied,creditApplied-price.membershipCreditApplied);
    const net=allocations.map(line=>line.card);
    let checkoutLines:Stripe.Checkout.SessionCreateParams.LineItem[]=line_items.slice(0,allocations.length).map((line,index)=>({...line,price_data:{...line.price_data!,unit_amount:pence(net[index])}}));
    if(depositLineItem)checkoutLines.push(depositLineItem);
    checkoutLines=checkoutLines.filter(l=>(l.price_data?.unit_amount??0)>0);
    if(membershipCheckout)checkoutLines.push({price:await ensurePrice(sb,tierByKey(membershipCheckout.tier)!),quantity:1});
    const meta = {bookingId,rentalPaidPence:String(pence(price.totalDue)),securityPolicyVersion:price.securityPolicyVersion,savedCardLimitPence:String(pence(price.savedCardLimit)),...(membershipCheckout ? {membershipTier:membershipCheckout.tier,accountEmail:acct.email,membershipCheckoutId:String(membershipCheckout._id),membershipTerms:MEMBERSHIP_TERMS_VERSION}: {})};
    const submitMessage=cardHoldPolicy
      ?depositHoldAmount>0?`A temporary £${depositHoldAmount.toFixed(2)} card authorisation is requested separately. It is not a charge but may reduce your available balance. An issue-free return releases it automatically; any claim needs a recorded reason.`:"You qualify for the no-hold exemption. No security payment or card authorisation is requested."
      :setupIntentPolicy?`No deposit or funds are held. Stripe saves your card for itemised, evidenced post-return damage or late-fee claims up to £${price.savedCardLimit.toFixed(2)} combined. No charge on an on-time return without a reported issue. Later bank approval is not guaranteed; insurance claims are separate.`
      :`${depositAmount>0?`A refundable £${depositAmount.toFixed(2)} deposit is included; no extra funds are blocked. Retained deposit reduces later collection for the same loss.`:"No cash security deposit or additional card hold is taken."} You agreed to save this card for evidenced damage/loss and late-return payments ${price.securityPolicyVersion===ASSESSMENT_SECURITY_POLICY_VERSION?"for the itemised assessment,":`up to £${price.savedCardLimit.toFixed(2)} combined,`} after an itemised notice and at least seven days to raise a dispute. Bank approval may be required.`;
    const sessionParams: Stripe.Checkout.SessionCreateParams = {
      custom_text:{submit:{message:submitMessage}},
      mode: membershipCheckout ? "subscription" : price.totalDue === 0 ? "setup" : "payment",
      ...(!membershipCheckout&&price.totalDue===0?{currency:"gbp"}:{}),
      ...(membershipCheckout || price.totalDue > 0 ? {adaptive_pricing:{enabled:false}} : {}),
      expires_at: Math.floor(Date.now() / 1000) + 31 * 60,
      ...(membershipCheckout || price.totalDue > 0 ? {line_items:checkoutLines} : {}), payment_method_configuration: paymentConfigId,
      ...(membershipCheckout ? {payment_method_collection:"always" as const,subscription_data:{metadata:meta,...(membershipCheckout.intro === "trial" ? {trial_period_days:7,trial_settings:{end_behavior:{missing_payment_method:"cancel" as const}}} : {})}} : price.totalDue > 0 ? {payment_intent_data:{metadata:meta,setup_future_usage:"off_session" as const}} : {setup_intent_data:{metadata:meta}}),
      ...(stripeCustomerId ? {customer:stripeCustomerId} : {customer_email:a.customer.email,customer_creation:"always" as const}),
      success_url: `${new URL(process.env.APP_URL!).origin}/checkout/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${new URL(process.env.APP_URL!).origin}/cart`, metadata:meta,
    };
    if (membershipCheckout) await ctx.runMutation(internal.membershipBenefits.saveSessionParams,{id:membershipCheckout._id,bookingId,sessionParams:JSON.stringify(sessionParams)});
    const flagCheckoutFailure = async () => {
      try { await ctx.runMutation(internal.bookings.flagCheckoutSessionFailure,{bookingId}); }
      catch { console.error("Could not record checkout session failure", bookingId); }
    };
    let session:Stripe.Checkout.Session;
    try{session=await sb.checkout.sessions.create(sessionParams,{idempotencyKey:membershipCheckout?`dbc-member-checkout-${membershipCheckout._id}`:`dbc-rental-checkout-${bookingId}`});}
    catch(error){
      await flagCheckoutFailure();
      if(error instanceof Stripe.errors.StripeInvalidRequestError)await ctx.runMutation(internal.bookings.checkoutCreationRejected,{bookingId});
      throw error;
    }
    try {
      if (membershipCheckout) await ctx.runMutation(internal.membershipBenefits.bindCheckout,{id:membershipCheckout._id,sessionId:session.id,bookingId});
      if (!session.url) throw new Error("Stripe did not return a checkout URL");
      await ctx.runMutation(internal.bookings.bindCheckoutSession, { bookingId, sessionId: session.id });
    } catch (error) {
      await flagCheckoutFailure();
      throw error;
    }
    return { url: session.url };
  },
});

function checkoutCompleted(session: Stripe.Checkout.Session) {
  return session.payment_status === "paid" || (session.status === "complete" && session.payment_status === "no_payment_required");
}

async function confirmPaidBookingWithLiveStock(ctx: any, bookingId: any, session: Stripe.Checkout.Session) {
  if (!checkoutCompleted(session) || session.metadata?.bookingId !== String(bookingId))
    throw Error("Paid checkout does not match this booking.");
  const paymentIntentId = await checkoutPaymentIntent(session);
  if (session.payment_status === "paid" && !paymentIntentId)
    throw Error("The paid checkout has no identifiable payment. Review it before confirming the rental.");
  const receipt = await ctx.runMutation(internal.bookings.recordPaidCheckoutReceipt, { bookingId, sessionId: session.id, paymentIntentId });
  if (receipt.closed) return receipt;
  let stock: any;
  try {
    stock = await ctx.runAction(internal.sync.syncHyggloReservations, { force: true });
  } catch {
    throw new ConvexError({
      code: "STOCK_CHECK_UNAVAILABLE",
      message: "Payment was received, but live equipment availability could not be refreshed. The rental remains unconfirmed while we retry; please do not pay again.",
    });
  }
  if (!Number.isSafeInteger(stock?.checkedAt))
    throw new ConvexError({
      code: "STOCK_CHECK_UNAVAILABLE",
      message: "Payment was received, but live equipment availability could not be verified. The rental remains unconfirmed while we retry; please do not pay again.",
    });
  if(swapAuthorityAvailable()&&process.env.SHARED_STOCK_BRIDGE_EXPERIMENTAL==="true"){
    const refs=internal as any;
    const claim=await ctx.runMutation(refs.bookingStockClaims.prepare,{bookingId,sessionId:session.id,paymentIntentId});
    if(claim.ready){
      const result=await ctx.runAction(refs.bookingStockClaims.advance,{id:claim.id});
      if(result.status!=="executed"&&result.status!=="applied")throw Error("Payment is recorded; booking stock confirmation needs reconciliation.");
    }
  }
  return await ctx.runMutation(internal.bookings.confirm, {
    bookingId,
    paymentIntentId,
    rentalManagerCheckedAt: stock.checkedAt,
  });
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
export const prepareSavedCard = internalAction({args:{bookingId:v.id("bookings")},handler:async(ctx,{bookingId})=>{
 const b:any=await ctx.runQuery(internal.savedCardState.context,{bookingId});
 if(!isSavedCardRental(b)||!["confirmed","active"].includes(b.status)||b.cancellationDecision||b.returnDecision||b.savedCardStatus==="saved")return;
 try{
  const sb=stripe(),session=await sb.checkout.sessions.retrieve(b.stripeCheckoutSessionId);
  if(session.metadata?.bookingId!==String(bookingId)||!checkoutCompleted(session))throw Error("The rental checkout payment is not confirmed.");
  await ctx.runMutation(internal.savedCardState.save,{bookingId,sessionId:session.id,...await checkoutSavedCard(session,sb)});
 }catch(error){await ctx.runMutation(internal.savedCardState.failed,{bookingId});throw error;}
}});
export const retrySavedCard = action({args:{token:v.string(),bookingId:v.id("bookings"),admin:v.optional(v.boolean())},handler:async(ctx,a):Promise<void>=>{
 const b:any=await ctx.runQuery(internal.savedCardState.context,{bookingId:a.bookingId});
 if(a.admin)await ctx.runMutation(internal.adminAuth.assertAdminInternal,{token:a.token,fn:"checkout.retrySavedCard"});
 else{const account:any=await ctx.runQuery(internal.accounts._byToken,{token:a.token});if(!account||!belongsToRentalAccount(b,account))throw Error("Rental card access denied.");}
 if(!isSavedCardRental(b)||!["confirmed","active"].includes(b.status))throw Error("This rental is not awaiting card confirmation.");
 await ctx.runAction(internal.checkout.prepareSavedCard,{bookingId:a.bookingId});
}});
export const preparePickupSecurity = internalAction({args:{bookingId:v.id("bookings")},handler:async(ctx,{bookingId})=>{
 const b:any=await ctx.runQuery(internal.pickupSecurity.context,{bookingId});
 if(!pickupHoldEligible(b)||b.cancellationDecision||b.returnDecision||b.securityHoldPaymentMethodId)return;
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
  const rental:any=await ctx.runQuery(internal.savedCardState.context,{bookingId:bookingId as any});
  if(isSavedCardRental(rental)){
    await ctx.runAction(internal.checkout.prepareSavedCard,{bookingId:bookingId as any});
    const saved:any=await ctx.runQuery(internal.savedCardState.context,{bookingId:bookingId as any});
    return {status:saved?.savedCardStatus??"needs_setup"};
  }
  const b: any = await ctx.runQuery(internal.bookings.holdContext, { bookingId: bookingId as any });
  if (!b || !b.amount || !["pending_verification", "confirmed", "active"].includes(b.status)) return { status: "not_applicable" };
  const sb = stripe();
  if(isPickupHoldPolicyVersion(b.securityHoldPolicyVersion)){
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
      const metadata = { membershipTier: tier.key, accountEmail: acct.email, membershipCheckoutId: String(reservation._id), membershipTerms: MEMBERSHIP_TERMS_VERSION };
      const session = await sb.checkout.sessions.create({
        adaptive_pricing: {enabled:false},
        mode: "subscription", line_items: [{ price: priceId, quantity: 1 }], customer: customerId,
        expires_at: Math.floor(reservation.createdAt / 1000) + 31 * 60,
        success_url: `${base}/checkout/success?session_id={CHECKOUT_SESSION_ID}`, cancel_url: `${base}/membership`,
        metadata, subscription_data: { metadata, ...(reservation.intro === "trial" ? { trial_period_days: 7, trial_settings: { end_behavior: { missing_payment_method: "cancel" as const } } } : {}) },
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
  if (requested !== configured && !(/^(sk|rk|rkcs)_test_/.test(process.env.STRIPE_SECRET_KEY??"") && /^https?:\/\/localhost(?::\d+)?$/.test(requested))) throw Error("Invalid checkout origin.");
  return requested;
}

export async function syncStripeMembership(ctx: any, sub: Stripe.Subscription, checkoutId?: string, expected?: {accountId: string; customerId: string; subscriptionId: string; membershipSnapshot: string; adminRefreshToken?: string}) {
  const tier = tierKeyFromSub(sub);
  const email = sub.metadata.accountEmail;
  if (!tier || !email) return;
  const acct: any = await ctx.runQuery(internal.accounts._byEmail, { email });
  const customerId = typeof sub.customer === "string" ? sub.customer : sub.customer.id;
  // Shared Stripe accounts deliver events for other projects/deployments too.
  if (!acct) return;
  if (acct.stripeCustomerId !== customerId) throw Error("Stripe membership customer does not match the account.");
  if (expected && (String(acct._id) !== expected.accountId || customerId !== expected.customerId || sub.id !== expected.subscriptionId)) throw Error("The Stripe subscription does not match this account.");
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
    ...(expected ? { expectedCustomerId: expected.customerId, expectedSubscriptionId: expected.subscriptionId, expectedMembershipSnapshot: expected.membershipSnapshot } : {}),
    ...(expected?.adminRefreshToken ? { adminRefreshToken: expected.adminRefreshToken } : {}),
    ...(checkoutId && ["active","trialing"].includes(sub.status) ? { checkoutId } : {}),
  });
  return acct;
}

export async function grantStripeMembershipInvoice(ctx: any, invoice: Stripe.Invoice, sub: Stripe.Subscription, adminRetryToken?: string, fullRefundRecovery?: {id:any;token:string}) {
  const acct: any = await ctx.runQuery(internal.accounts._byEmail, { email: sub.metadata.accountEmail ?? "" });
  if (!acct || acct.stripeSubscriptionId !== sub.id) return;
  if (process.env.MEMBERSHIP_HISTORICAL_INVOICE_CREDIT_V1 === "enabled") {
    if (invoice.status !== "paid" || invoice.amount_paid <= 0 || !["subscription_create", "subscription_cycle"].includes(invoice.billing_reason ?? "")) return;
    const reviewArgs = { accountId: acct._id, subscriptionId: sub.id, invoiceId: invoice.id };
    if (!adminRetryToken && !fullRefundRecovery && !await ctx.runQuery(internal.membershipInvoiceReviews.mayProcess, reviewArgs)) return;
    const customerId = typeof sub.customer === "string" ? sub.customer : sub.customer?.id;
    if (!customerId || acct.stripeCustomerId !== customerId) throw Error("Stripe membership customer does not match the account.");
    const existing = await ctx.runQuery(internal.accountAdmin.membershipInvoiceReceipt, { ...reviewArgs, customerId });
    if (existing) {
      try { if (!existing.historicalPriceId) throw Error("Historical invoice price requires review."); await reconcileMembershipCreditNotes(ctx, invoice, sub, existing.historicalPriceId); await ctx.runMutation(internal.membershipInvoiceReviews.resolve, reviewArgs); }
      catch (error) { console.error("Membership invoice reconciliation requires review", invoice.id, error); await ctx.runMutation(internal.membershipInvoiceReviews.record, { ...reviewArgs, reason: "processing_error" }); }
      return;
    }
    let reason: string | undefined;
    try {
      let snapshots: MembershipPriceSnapshot[] = [];
      try { const parsed = JSON.parse(process.env.MEMBERSHIP_INVOICE_PRICE_SNAPSHOTS ?? "[]"); if (Array.isArray(parsed) && parsed.length <= 100) snapshots = parsed; } catch {}
      if (!snapshots.length) reason = "snapshot_not_configured";
      else {
        const client = stripe();
        const stripeAccount = await client.accounts.retrieve(null);
        const lines: Stripe.InvoiceLineItem[] = [];
        for await (const line of client.invoices.listLineItems(invoice.id, { limit: 100 })) { lines.push(line); if (lines.length > 100) break; }
        if (lines.length > 100) reason = "too_many_lines";
        else {
          const result = resolveMembershipInvoiceSnapshot(invoice, lines, sub.id, customerId, stripeAccount.id, snapshots);
          if (result.state === "not_applicable") return;
          if (result.state === "review") reason = result.reason;
          else {
            const noteRefundedPence = await membershipCreditNotesRefunded(invoice, sub, result.snapshot.priceId);
            const initialRefundedPence = fullRefundRecovery ? result.paidMembershipPence : noteRefundedPence;
            await ctx.runMutation(internal.membershipBenefits.grantPaidInvoice, { ...reviewArgs, paidMembershipPence: result.paidMembershipPence, periodEnd: result.periodEnd, historicalBonusPercent: result.snapshot.bonusPercent, historicalPriceId: result.snapshot.priceId, historicalTermsVersion: result.snapshot.termsVersion, initialRefundedPence, ...(fullRefundRecovery ? {refundJobId:fullRefundRecovery.id,refundLeaseToken:fullRefundRecovery.token} : {}), ...(adminRetryToken ? { adminRetryToken } : {}), ...(invoice.billing_reason === "subscription_create" && sub.metadata.membershipCheckoutId ? { checkoutId: sub.metadata.membershipCheckoutId } : {}) });
            await ctx.runMutation(internal.membershipInvoiceReviews.resolve, reviewArgs);
            return;
          }
        }
      }
    } catch (error) { console.error("Membership invoice requires review", invoice.id, error); reason = "processing_error"; }
    await ctx.runMutation(internal.membershipInvoiceReviews.record, { ...reviewArgs, reason });
    return;
  }
  const lines: Stripe.InvoiceLineItem[] = [];
  for await (const line of stripe().invoices.listLineItems(invoice.id, { limit: 100 })) lines.push(line);
  const grant = paidRecurringMembership(invoice, lines, sub);
  if (grant) {
    await ctx.runMutation(internal.membershipBenefits.grantPaidInvoice, { accountId: acct._id, subscriptionId: sub.id, invoiceId: invoice.id, ...(invoice.billing_reason === "subscription_create" && sub.metadata.membershipCheckoutId ? {checkoutId:sub.metadata.membershipCheckoutId as any} : {}), ...grant });
    await reconcileMembershipCreditNotes(ctx,invoice,sub);
  }
}

async function reconcileMembershipCreditNotes(ctx:any, invoice:Stripe.Invoice, sub:Stripe.Subscription, historicalPriceId?:string) {
  const refunded = await membershipCreditNotesRefunded(invoice, sub, historicalPriceId);
  if(refunded>0)await ctx.runMutation(internal.membershipBenefits.revokeRefundedInvoice,{invoiceId:invoice.id,membershipRefundedPence:refunded});
}

async function membershipCreditNotesRefunded(invoice:Stripe.Invoice, sub:Stripe.Subscription, historicalPriceId?:string) {
  const lines:Stripe.InvoiceLineItem[]=[];
  for await (const line of stripe().invoices.listLineItems(invoice.id,{limit:100})) { lines.push(line); if(lines.length>100)throw Error("Invoice lines require review."); }
  const memberItems=new Set(sub.items.data.map(i=>i.id));
  const memberLines=new Set(lines.filter(l=>{
    const details=l.parent?.subscription_item_details;
    if(l.parent?.type!=="subscription_item_details"||details?.proration)return false;
    if(!historicalPriceId)return memberItems.has(details?.subscription_item??"");
    const price=l.pricing?.price_details?.price;
    return details?.subscription===sub.id&&(typeof price==="string"?price:price?.id)===historicalPriceId&&l.amount>0;
  }).map(l=>l.id));
  if(historicalPriceId&&memberLines.size!==1)throw Error("Historical membership invoice line requires review.");
  let refunded=0;
  let noteCount=0;
  for await (const note of stripe().creditNotes.list({invoice:invoice.id,limit:100})) {
    if(++noteCount>100)throw Error("Credit notes require review.");
    if(note.status!=="issued")continue;
    let lineCount=0;
    for await (const line of stripe().creditNotes.listLineItems(note.id,{limit:100})) {if(++lineCount>100)throw Error("Credit note lines require review.");if(line.invoice_line_item&&memberLines.has(line.invoice_line_item)){if(!Number.isSafeInteger(line.amount)||line.amount<0)throw Error("Credit note amount requires review.");refunded+=line.amount;if(!Number.isSafeInteger(refunded))throw Error("Credit note total requires review.");}}
  }
  return refunded;
}

export async function reconcileFullyRefundedMembership(ctx:any, refund:Stripe.Refund, job?:{id:any,token:string,accountId:any,subscriptionId:string,invoiceId:string}) {
  if(refund.metadata?.dbc_deposit_return_booking||refund.metadata?.rentalRefundId)return;
  if(refund.status!=="succeeded"||!refund.payment_intent){if(job)throw Error("Membership refund is no longer confirmed.");return;}
  const pi=await stripe().paymentIntents.retrieve(typeof refund.payment_intent==="string"?refund.payment_intent:refund.payment_intent.id);
  let refunded=0, refundCount=0;for await(const r of stripe().refunds.list({payment_intent:pi.id,limit:100})){if(++refundCount>100)throw Error("Membership refund history requires review.");if(r.status==="succeeded"){if(!Number.isSafeInteger(r.amount)||r.amount<0||r.currency!==pi.currency)throw Error("Membership refund amount requires review.");refunded+=r.amount;if(!Number.isSafeInteger(refunded))throw Error("Membership refund total requires review.");}}
  if(refunded<pi.amount_received&&process.env.MEMBERSHIP_HISTORICAL_INVOICE_CREDIT_V1!=="enabled"){if(job)throw Error("Membership refund is no longer fully allocated.");return;}
  const payments=await stripe().invoicePayments.list({payment:{type:"payment_intent",payment_intent:pi.id},status:"paid",limit:100});
  if(process.env.MEMBERSHIP_HISTORICAL_INVOICE_CREDIT_V1 === "enabled") {
    if(!payments.has_more&&!payments.data.length){if(job)throw Error("Membership refund invoice no longer found.");return;}
    if(payments.has_more||payments.data.length!==1)throw Error("Membership refund allocation requires review.");
    const payment=payments.data[0], id=typeof payment.invoice==="string"?payment.invoice:payment.invoice.id;
    const invoice=await stripe().invoices.retrieve(id);
    const parent=invoice.parent?.subscription_details?.subscription,subId=typeof parent==="string"?parent:parent?.id;
    if(!subId){if(job)throw Error("Membership refund subscription no longer found.");return;}
    if(pi.currency!=="gbp"||!Number.isSafeInteger(pi.amount_received)||pi.amount_received<=0||refunded>pi.amount_received||invoice.status!=="paid"||invoice.currency!==pi.currency||invoice.amount_paid!==pi.amount_received||payment.amount_paid!==pi.amount_received)throw Error("Membership invoice payment allocation requires review.");
    const sub=await stripe().subscriptions.retrieve(subId),account:any=await ctx.runQuery(internal.accounts._byEmail,{email:sub.metadata.accountEmail??""});
    if(!account||account.stripeSubscriptionId!==sub.id){if(job)throw Error("Membership refund account no longer matched.");return;}
    if(job&&(job.accountId!==account._id||job.subscriptionId!==sub.id||job.invoiceId!==id))throw Error("Membership refund ownership changed.");
    const customerId=typeof sub.customer==="string"?sub.customer:sub.customer.id,invoiceCustomerId=typeof invoice.customer==="string"?invoice.customer:invoice.customer?.id,piCustomerId=typeof pi.customer==="string"?pi.customer:pi.customer?.id;
    if(account.stripeCustomerId!==customerId||invoiceCustomerId!==customerId||piCustomerId!==customerId)throw Error("Membership refund customer requires review.");
    if(refunded<pi.amount_received){
      if(!refund.id)throw Error("Membership refund identity requires review.");
      await ctx.runMutation((internal as any).membershipRefundJobs.flagUnallocated,{refundId:refund.id,accountId:account._id,subscriptionId:sub.id,invoiceId:id});
      return {waiting:true};
    }
    const receipt=await ctx.runQuery(internal.accountAdmin.membershipInvoiceReceipt,{accountId:account._id,customerId,subscriptionId:sub.id,invoiceId:id});
    if(!receipt){
      if(["subscription_create","subscription_cycle"].includes(invoice.billing_reason??"")){
        if(!refund.id)throw Error("Membership refund receipt requires review.");
        if(!job)await ctx.runMutation((internal as any).membershipRefundJobs.enqueue,{refundId:refund.id,accountId:account._id,subscriptionId:sub.id,invoiceId:id});
        else {
          await grantStripeMembershipInvoice(ctx,invoice,sub,undefined,{id:job.id,token:job.token});
          const recovered=await ctx.runQuery(internal.accountAdmin.membershipInvoiceReceipt,{accountId:account._id,customerId,subscriptionId:sub.id,invoiceId:id});
          if(recovered && recovered.membershipRefundedPence===recovered.paidMembershipPence)return;
        }
      }
      return {waiting:true};
    }
    await ctx.runMutation(internal.membershipBenefits.revokeRefundedInvoice,{invoiceId:id,membershipRefundedPence:receipt.paidMembershipPence,...(job?{refundJobId:job.id,leaseToken:job.token}:{})});
    return;
  }
  for(const p of payments.data){const id=typeof p.invoice==="string"?p.invoice:p.invoice.id;const invoice=await stripe().invoices.retrieve(id);const parent=invoice.parent?.subscription_details?.subscription;const subId=typeof parent==="string"?parent:parent?.id;if(!subId)continue;const sub=await stripe().subscriptions.retrieve(subId);const lines:Stripe.InvoiceLineItem[]=[];for await(const line of stripe().invoices.listLineItems(id,{limit:100}))lines.push(line);const grant=paidRecurringMembership(invoice,lines,sub);if(grant)await ctx.runMutation(internal.membershipBenefits.revokeRefundedInvoice,{invoiceId:id,membershipRefundedPence:grant.paidMembershipPence});}
}

export const retryMembershipRefund=internalAction({
  args:{jobId:v.id("membership_refund_jobs")},
  handler:async(ctx,{jobId})=>{
    const refs=internal as any,token=crypto.randomUUID(),job=await ctx.runMutation(refs.membershipRefundJobs.claim,{id:jobId,token});
    if(!job)return;
    let done=false;
    try { const result=await reconcileFullyRefundedMembership(ctx,await stripe().refunds.retrieve(job.refundId),{...job,id:jobId,token});done=!result?.waiting; }
    catch(error){console.error("Membership refund retry deferred",job.refundId,error);}
    finally {await ctx.runMutation(refs.membershipRefundJobs.finish,{id:jobId,token,done});}
  },
});

async function fulfillMembership(ctx: any, session: Stripe.Checkout.Session) {
  const subId = typeof session.subscription === "string" ? session.subscription : session.subscription?.id;
  if (!session.metadata?.membershipTier || session.status !== "complete") return;
  if (!subId) throw Error("Completed membership checkout has no subscription.");
  const sub = await stripe().subscriptions.retrieve(subId);
  if (!await syncStripeMembership(ctx, sub, session.metadata.membershipCheckoutId)) throw Error("Membership account or plan could not be matched.");
  const invoiceId = typeof session.invoice === "string" ? session.invoice : session.invoice?.id;
  if (invoiceId) await grantStripeMembershipInvoice(ctx, await stripe().invoices.retrieve(invoiceId), sub);
}

export async function fulfillMembershipForBooking(ctx: any, session: Stripe.Checkout.Session) {
  try {
    await fulfillMembership(ctx, session);
  } catch (error) {
    if (process.env.MEMBERSHIP_HISTORICAL_INVOICE_CREDIT_V1 !== "enabled" || !session.metadata?.bookingId) throw error;
    await ctx.scheduler.runAfter(60_000, internal.checkout.retryMembershipCheckout, { sessionId: session.id, bookingId: session.metadata.bookingId, attempt: 0 });
    console.error("Membership processing deferred; rental confirmation remains independently gated", session.id, error);
  }
}

export const retryMembershipCheckout = internalAction({
  args: { sessionId: v.string(), bookingId: v.id("bookings"), attempt: v.number() },
  handler: async (ctx, { sessionId, bookingId, attempt }) => {
    if (!Number.isSafeInteger(attempt) || attempt < 0 || attempt > 3) throw Error("Invalid retry attempt.");
    try {
      const session = await stripe().checkout.sessions.retrieve(sessionId);
      if (session.metadata?.bookingId !== String(bookingId) || !session.metadata?.membershipTier || session.status !== "complete") throw Error("Membership checkout no longer matches this booking.");
      await fulfillMembership(ctx, session);
    } catch (error) {
      console.error("Membership checkout retry failed", sessionId, error);
      if (attempt < 3) await ctx.scheduler.runAfter(2 ** attempt * 5 * 60_000, internal.checkout.retryMembershipCheckout, { sessionId, bookingId, attempt: attempt + 1 });
      else await ctx.runMutation(internal.membershipInvoiceReviews.recordCheckoutFailure, { bookingId, sessionId });
    }
  },
});

/** Open the Stripe billing portal to manage/cancel the membership. */
export const billingPortal = action({
  args: { token: v.string(), origin: v.string() },
  handler: async (ctx, a): Promise<{ url: string }> => {
    const target:{accountId:string;customerId:string;subscriptionId:string|null}|null=await ctx.runQuery(internal.accounts._billingPortalTarget,{token:a.token});
    if (!target) throw new Error("Billing account unavailable.");
    const client=stripe(),customer=await client.customers.retrieve(target.customerId);
    if(customer.id!==target.customerId||customer.deleted||customer.metadata?.dbcAccountId&&customer.metadata.dbcAccountId!==String(target.accountId))throw Error("Billing account needs review.");
    if(target.subscriptionId){const subscription=await client.subscriptions.retrieve(target.subscriptionId);const owner=typeof subscription.customer==="string"?subscription.customer:subscription.customer?.id;if(subscription.id!==target.subscriptionId||owner!==target.customerId)throw Error("Billing subscription needs review.");}
    const assertCurrent=async()=>{const current:{accountId:string;customerId:string;subscriptionId:string|null}|null=await ctx.runQuery(internal.accounts._billingPortalTarget,{token:a.token});if(!current||String(current.accountId)!==String(target.accountId)||current.customerId!==target.customerId||current.subscriptionId!==target.subscriptionId)throw Error("Billing account changed. Try again.");};
    await assertCurrent();
    const ps = await client.billingPortal.sessions.create({
      customer: target.customerId,
      return_url: `${checkoutOrigin(a.origin)}/account`,
    });
    await assertCurrent();
    const url=new URL(ps.url);if(url.protocol!=="https:"||url.username||url.password)throw Error("Billing link unavailable.");
    return { url: url.toString() };
  },
});

export const adminBillingPortal = action({
  args: { token: v.string(), accountId: v.id("accounts") },
  handler: async (ctx, args): Promise<{ url: string }> => {
    const target: { customerId: string; subscriptionId: string } = await ctx.runMutation(
      internal.accountAdmin.billingPortalTarget, { ...args, purpose: "portal" },
    );
    const client = stripe();
    const subscription = await client.subscriptions.retrieve(target.subscriptionId);
    const customerId = typeof subscription.customer === "string" ? subscription.customer : subscription.customer?.id;
    if (subscription.id !== target.subscriptionId || customerId !== target.customerId)
      throw Error("The Stripe subscription does not match this account. Review the billing link before proceeding.");
    const assertCurrentTarget = async () => {
      const current: { customerId: string; subscriptionId: string } = await ctx.runMutation(internal.accountAdmin.billingPortalTarget, { ...args, purpose: "portal" });
      if (current.customerId !== target.customerId || current.subscriptionId !== target.subscriptionId)
        throw Error("The billing link changed while opening Stripe. Review the account and try again.");
    };
    await assertCurrentTarget();
    const origin = new URL(process.env.APP_URL ?? "https://dbcinemarentals.com").origin;
    const session = await client.billingPortal.sessions.create({ customer: target.customerId, return_url: `${origin}/admin` });
    await assertCurrentTarget();
    const url = new URL(session.url);
    if (url.protocol !== "https:" || url.username || url.password) throw Error("Stripe returned an invalid billing link.");
    return { url: url.toString() };
  },
});

export const adminRefreshMembership = action({
  args: { token: v.string(), accountId: v.id("accounts") },
  handler: async (ctx, args): Promise<{status: string}> => {
    const target: {customerId: string; subscriptionId: string; membershipSnapshot: string} = await ctx.runMutation(internal.accountAdmin.billingPortalTarget, { ...args, purpose: "membership_refresh" });
    const sub = await stripe().subscriptions.retrieve(target.subscriptionId);
    const account = await syncStripeMembership(ctx, sub, undefined, {accountId: String(args.accountId), ...target, adminRefreshToken: args.token});
    if (!account) throw Error("Stripe membership details are incomplete. Review the subscription in Stripe.");
    return {status: sub.status};
  },
});

export const adminInspectMembershipInvoice = action({
  args:{token:v.string(),accountId:v.id("accounts"),selection:v.optional(v.union(v.literal("latest"),v.literal("paid"))),inspectTier:v.optional(v.boolean())},
  handler:async(ctx,args):Promise<{invoice:null|{id:string;status:string|null;amountPaidPence:number;currency:string;createdAt:number};receipt:null|{creditPence:number;bonusPence:number;revokedPence:number;paidMembershipPence:number;createdAt:number};tierCheck?:{state:string;tier?:string;earnedCreditPence?:number;reason?:string}} >=>{
    const target:{customerId:string;subscriptionId:string}=await ctx.runMutation(internal.accountAdmin.billingPortalTarget,{token:args.token,accountId:args.accountId});
    const client=stripe(),sub=await client.subscriptions.retrieve(target.subscriptionId);
    const customerId=typeof sub.customer==="string"?sub.customer:sub.customer?.id;
    if(sub.id!==target.subscriptionId||customerId!==target.customerId)throw Error("The Stripe subscription does not match this account.");
    let invoiceId:string|undefined;
    if(args.selection==="paid"){
      const recent=await client.invoices.list({subscription:target.subscriptionId,status:"paid",limit:100});
      invoiceId=recent.data.find(item=>item.status==="paid"&&Number.isSafeInteger(item.amount_paid)&&item.amount_paid>0)?.id;
      if(!invoiceId&&recent.has_more)throw Error("More invoice history needs review in Stripe before a paid invoice can be identified.");
    }else invoiceId=typeof sub.latest_invoice==="string"?sub.latest_invoice:sub.latest_invoice?.id;
    let invoice:null|{id:string;status:string|null;amountPaidPence:number;currency:string;createdAt:number}=null;
    let receipt:null|{creditPence:number;bonusPence:number;revokedPence:number;paidMembershipPence:number;createdAt:number}=null;
    let tierCheck:{state:string;tier?:string;earnedCreditPence?:number;reason?:string}|undefined;
    if(invoiceId){
      const current=await client.invoices.retrieve(invoiceId);
      const invoiceCustomer=typeof current.customer==="string"?current.customer:current.customer?.id;
      const parent=current.parent?.subscription_details?.subscription;
      const invoiceSubscription=typeof parent==="string"?parent:parent?.id;
      if(current.id!==invoiceId||invoiceCustomer!==target.customerId||invoiceSubscription!==target.subscriptionId||current.currency!=="gbp"||!Number.isSafeInteger(current.amount_paid)||current.amount_paid<0||!Number.isSafeInteger(current.created))throw Error("The Stripe invoice does not match this subscription. Review it in Stripe.");
      if(args.selection==="paid"&&(current.status!=="paid"||current.amount_paid<=0))throw Error("The selected paid invoice changed. Check again.");
      invoice={id:current.id,status:current.status,amountPaidPence:current.amount_paid,currency:current.currency,createdAt:current.created*1000};
      receipt=await ctx.runQuery(internal.accountAdmin.membershipInvoiceReceipt,{accountId:args.accountId,customerId:target.customerId,subscriptionId:target.subscriptionId,invoiceId});
      if(args.inspectTier){
        let snapshots:MembershipPriceSnapshot[]=[];
        try {const parsed=JSON.parse(process.env.MEMBERSHIP_INVOICE_PRICE_SNAPSHOTS ?? "[]");if(Array.isArray(parsed)&&parsed.length<=100)snapshots=parsed;} catch {}
        if(!snapshots.length) tierCheck={state:"review",reason:"snapshot_not_configured"};
        else {
          const connectedAccount=await client.accounts.retrieve(null);
          const lines:Stripe.InvoiceLineItem[]=[];
          for await(const line of client.invoices.listLineItems(invoiceId,{limit:100})){lines.push(line);if(lines.length>100)break;}
          if(lines.length>100) tierCheck={state:"review",reason:"too_many_lines"};
          else {const result=resolveMembershipInvoiceSnapshot(current,lines,target.subscriptionId,target.customerId,connectedAccount.id,snapshots);tierCheck=result.state==="ready"?{state:"ready",tier:result.snapshot.tier,earnedCreditPence:result.earnedCreditPence}:result;}
        }
      }
    }
    const latest:{customerId:string;subscriptionId:string}=await ctx.runMutation(internal.accountAdmin.billingPortalTarget,{token:args.token,accountId:args.accountId});
    if(latest.customerId!==target.customerId||latest.subscriptionId!==target.subscriptionId)throw Error("The billing link changed while checking. Review the account and try again.");
    return {invoice,receipt,...(tierCheck?{tierCheck}:{})};
  },
});

export const adminRetryMembershipInvoice = action({
  args: { token: v.string(), accountId: v.id("accounts"), invoiceId: v.string() },
  handler: async (ctx, args): Promise<{ state: "review" | "resolved" }> => {
    if (process.env.MEMBERSHIP_HISTORICAL_INVOICE_CREDIT_V1 !== "enabled") throw Error("Historical invoice recovery is not enabled.");
    const target: { customerId: string; subscriptionId: string } = await ctx.runMutation(internal.accountAdmin.billingPortalTarget, { token: args.token, accountId: args.accountId, purpose: "portal" });
    await ctx.runMutation(api.membershipInvoiceReviews.adminReserveRetry, { ...args, subscriptionId: target.subscriptionId });
    const client = stripe();
    const [invoice, sub] = await Promise.all([client.invoices.retrieve(args.invoiceId), client.subscriptions.retrieve(target.subscriptionId)]);
    const invoiceCustomer = typeof invoice.customer === "string" ? invoice.customer : invoice.customer?.id;
    const parent = invoice.parent?.subscription_details?.subscription;
    const invoiceSubscription = typeof parent === "string" ? parent : parent?.id;
    const subCustomer = typeof sub.customer === "string" ? sub.customer : sub.customer?.id;
    if (invoiceCustomer !== target.customerId || subCustomer !== target.customerId || invoiceSubscription !== target.subscriptionId) throw Error("The invoice does not match this account.");
    const latest: { customerId: string; subscriptionId: string } = await ctx.runMutation(internal.accountAdmin.billingPortalTarget, { token: args.token, accountId: args.accountId, purpose: "portal" });
    if (latest.customerId !== target.customerId || latest.subscriptionId !== target.subscriptionId) throw Error("The billing link changed while checking.");
    await grantStripeMembershipInvoice(ctx, invoice, sub, args.token);
    return await ctx.runQuery(internal.membershipInvoiceReviews.byInvoice, { accountId: args.accountId, invoiceId: args.invoiceId });
  },
});

type ReturnSelection = { bookingId: any; damageKept?: number; depositKept?: number; expectedSnapshot?: string; damageNote?: string; actualReturnedAt?: number; chargeLate: boolean; lateWaiverReason?: string; lateClaimReason?: string; inspection?: InspectionInput[] };
async function validateReturnSelection(ctx: any, b: any, args: ReturnSelection) {
  if (args.expectedSnapshot && (b.returnDecision?.expectedSnapshot ? args.expectedSnapshot !== b.returnDecision.expectedSnapshot : !b.returnDecision && args.expectedSnapshot !== b.controlsSnapshot)) throw new ConvexError({code:"RETURN_REVIEW_STALE",message:"The rental changed after review. Refresh and review the deposit decision again."});
  const { bookingId, damageKept, damageNote, actualReturnedAt, chargeLate, lateWaiverReason, lateClaimReason, inspection } = args;
    const legacyReturnDecision = !!b.returnDecision && b.returnDecision.lateClaimPolicyVersion !== "owner-claim-v1";
    if (args.depositKept !== undefined && !hasCashDepositPolicy(b.securityPolicyVersion)) throw Error("This rental does not use the refundable-deposit policy.");
    const depositKept = hasCashDepositPolicy(b.securityPolicyVersion) ? (args.depositKept ?? Math.min(b.depositAmount ?? 0, damageKept ?? 0)) : undefined;
    if (b.returnDecision && b.returnDecision.depositKept !== depositKept) throw Error("Resume the saved deposit decision before changing retained amounts.");
    if(!["confirmed","active","returned"].includes(b.status))throw Error("Booking is not available for return.");
    const returned = actualReturnedAt ?? Date.now();
    if (!Number.isFinite(returned) || returned > Date.now() + 60000 || (returned < Date.now() - 45 * 86400000 && returned !== b.returnDecision?.actualReturnedAt))
      throw new Error("Actual return time must be within the last 45 days.");
    if(b.returnDecision && (b.returnDecision.actualReturnedAt!==returned || b.returnDecision.damageKept!==(damageKept??0) || (b.returnDecision.damageNote??"")!==(damageNote??"") || b.returnDecision.chargeLate!==chargeLate || (b.returnDecision.lateWaiverReason??"")!==(lateWaiverReason??"") || (b.returnDecision.lateClaimReason??"")!==(lateClaimReason??"")))throw Error("Resume the saved return decision; its amounts and return time cannot be changed during settlement.");
    const quotedLate = lateFeeQuote(b.lineItems, b.returnTime, returned);
    if (chargeLate && quotedLate.amount <= 0)
      throw new Error("There is no calculated late amount to claim. Leave the claim unchecked.");
    if (chargeLate && quotedLate.amount > 0 && !legacyReturnDecision && (lateClaimReason ?? "").trim().length < 10)
      throw Error("Record your reason for claiming the calculated late amount.");
    if (!chargeLate && quotedLate.amount > 0 && legacyReturnDecision && (lateWaiverReason ?? "").trim().length < 5)
      throw Error("Resume the saved return decision with its recorded waiver reason.");
    if (!chargeLate && lateClaimReason?.trim()) throw Error("A late claim reason requires an explicit late amount claim.");
    const late = chargeLate ? quotedLate : { amount: 0, breakdown: [] };
    const waiver = !chargeLate && legacyReturnDecision && quotedLate.amount > 0
      ? { waivedAmount: quotedLate.amount, waiverReason: lateWaiverReason?.trim() } : {};
    if (((damageKept ?? 0) > 0 || (depositKept ?? 0) > 0) && (!damageNote || damageNote.trim().length < 10))
      throw new Error("Record the evidence and reason for a damage deduction.");
    if(!inspection && !b.returnDecision)throw Error("Inspect every individual item before settling this rental.");
    const inspected = inspection ? await ctx.runQuery(internal.returnInspections.validate, { bookingId, inspection, damage: damageKept ?? 0 }) : b.returnDecision?.inspection;
    const damageLimit=isSavedCardRental(b)?savedCardRentalValue(b):(b.depositAmount??0)+(b.depositHoldAmount??0);
    if (!Number.isFinite(damageKept ?? 0) || (damageKept ?? 0) < 0 || (damageKept ?? 0) > damageLimit) throw Error("The damage assessment exceeds the retained equipment value or agreed security. Record fair, evidenced repair or loss costs.");
    const sources = b.paymentSources ?? (b.paymentIntentId ? [{ paymentIntentId: b.paymentIntentId, securityPence: pence(b.depositAmount ?? 0) }] : []);
    securityReturnPlan(sources, 0);
    return { returned, quotedLate, late, waiver, inspected, sources, depositKept };
}
function observedHoldAmounts(b: any, hold: Stripe.PaymentIntent | null) {
  if (!hold || !["requires_capture", "succeeded"].includes(hold.status)) return { available: 0, uncaptured: 0 };
  const value = hold.status === "requires_capture" ? hold.amount_capturable : hold.amount_received;
  if (!Number.isSafeInteger(value) || value < 0) throw Error("The provider returned an invalid security balance");
  const available = Math.min(b.depositHoldAmount ?? 0, value / 100);
  return { available, uncaptured: hold.status === "requires_capture" ? available : 0 };
}

/** Owner review only: provider reads and a draft PDF, never financial execution or email. */
export const previewReturned = action({
  args: { token: v.string(), bookingId: v.id("bookings"), damageKept: v.optional(v.number()), depositKept: v.optional(v.number()), expectedSnapshot: v.optional(v.string()), damageNote: v.optional(v.string()), actualReturnedAt: v.optional(v.number()), chargeLate: v.boolean(), lateWaiverReason: v.optional(v.string()), lateClaimReason: v.optional(v.string()), inspection: v.optional(v.array(inspectionInput)) },
  handler: async (ctx, args): Promise<any> => {
    await ctx.runMutation(internal.adminAuth.assertAdminInternal, { token: args.token, fn: "checkout.previewReturned" });
    const b: any = await ctx.runQuery(internal.bookings.getForRefund, { bookingId: args.bookingId,includeControlsSnapshot:true });
    if (!b) throw Error("Booking not found.");
    const selection = await validateReturnSelection(ctx, b, args);
    const invoice: any = await ctx.runQuery(api.bookings.invoiceData, { bookingId: args.bookingId, token: args.token });
    if (!invoice) throw Error("The rental invoice details are unavailable");
    const holdIntentId = b.stripeDepositIntentId ?? b.depositHoldIntentId;
    const hold = holdIntentId ? await stripe().paymentIntents.retrieve(holdIntentId, {}, { timeout: 20000 }) : null;
    const balance = observedHoldAmounts(b, hold);
    const damage = Math.round((args.damageKept ?? 0) * 100) / 100;
    const plan = hasCashDepositPolicy(b.securityPolicyVersion) ? refundableDepositPlan({deposit:b.depositAmount??0,capturedSecurity:selection.sources.reduce((n:number,source:any)=>n+source.securityPence,0)/100,assessedDamage:damage,keptDeposit:selection.depositKept}) : isSavedCardRental(b) ? {damageFromHold:0,damageFromDeposit:0,depositRefund:0,holdRelease:0,availableSecurity:0} : b.depositRefunded ? { damageFromHold: invoice.returnStatement?.damageFromHold ?? b.depositHoldCapturedForDamage ?? 0, damageFromDeposit: Math.max(0, (b.depositKept ?? 0) - (invoice.returnStatement?.damageFromHold ?? b.depositHoldCapturedForDamage ?? 0)), depositRefund: b.depositRefundAmount ?? 0, holdRelease: 0, availableSecurity: 0 } : returnSecurityPlan({ deposit: b.depositAmount ?? 0, capturedSecurity: selection.sources.reduce((n: number, source: any) => n + source.securityPence, 0) / 100, damage, holdAvailable: balance.available, holdUncaptured: balance.uncaptured });
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
      lateAssessed: selection.late.amount, lateWaived: selection.waiver.waivedAmount ?? 0,
      ...(selection.late.amount > 0 && args.lateClaimReason ? { lateClaimReason: args.lateClaimReason.trim() } : {}),
      lateBreakdown: selection.late.breakdown,
    };
    if(hasCashDepositPolicy(b.securityPolicyVersion))Object.assign(statement,depositRefundStatementFields(b));
    if(isSavedCardRental(b)){statement.securityPolicyVersion=b.securityPolicyVersion;if(b.securityPolicyVersion!==ASSESSMENT_SECURITY_POLICY_VERSION)statement.savedCardLimit=b.savedCardLimit;statement.damageAssessed=damage;statement.damageTotal=hasCashDepositPolicy(b.securityPolicyVersion)?plan.damageFromDeposit:0;}
    const draft = !invoice.returnStatement;
    const secret = process.env.INVOICE_SECRET;
    if (!secret) throw Error("Return statement PDF previews are not configured");
    const response = await fetch(`${process.env.APP_URL ?? "https://dbcinemarentals.com"}/api/invoice/${args.bookingId}?phase=return-preview`, {
      method: "POST", headers: { "content-type": "application/json", "x-invoice-key": secret }, body: JSON.stringify({ statement, draft }), signal: AbortSignal.timeout(20000),
    });
    if (!response.ok) throw Error("The return statement PDF preview is unavailable. No settlement has been executed.");
    const pdf = Buffer.from(await response.arrayBuffer());
    if (pdf.length > 1_000_000 || pdf.subarray(0, 5).toString() !== "%PDF-") throw Error("The return statement preview did not produce a valid PDF");
    return { snapshot:b.returnDecision?.expectedSnapshot??b.controlsSnapshot, draft, observedAt: Date.now(), alreadySettled: !!invoice.returnStatement, securityAlreadySettled: !!b.depositRefunded, financial: { ...plan, ...(isSavedCardRental(b)?{...(b.securityPolicyVersion===ASSESSMENT_SECURITY_POLICY_VERSION?{}:{savedCardLimit:b.savedCardLimit}),damageAssessed:damage}:{}), holdRelease: retainedForLate ? 0 : plan.holdRelease, holdRetainedForLate: retainedForLate, lateAssessed: statement.lateAssessed, lateWaived: statement.lateWaived }, statement, email: returnStatementEmail(statement, draft), pdf: { base64: pdf.toString("base64"), filename: `DbCinema-${draft ? "draft-" : ""}return-${String(args.bookingId).slice(-8)}.pdf` } };
  },
});

/** Admin: mark a rental RETURNED and release its security deposit in one step. Pass damageKept to
 *  retain part of the deposit for damage (that portion stays captured; the rest is refunded to the
 *  card). Idempotent — the depositRefunded flag plus a Stripe idempotency key prevent a double refund. */
export const markReturned = action({
  args: { token: v.string(), bookingId: v.id("bookings"), damageKept: v.optional(v.number()), depositKept: v.optional(v.number()), expectedSnapshot: v.optional(v.string()), damageNote: v.optional(v.string()), actualReturnedAt: v.optional(v.number()), chargeLate: v.boolean(), lateWaiverReason: v.optional(v.string()), lateClaimReason: v.optional(v.string()), inspection: v.optional(v.array(inspectionInput)) },
  handler: async (
    ctx,
    { token, bookingId, damageKept, depositKept, expectedSnapshot, damageNote, actualReturnedAt, chargeLate, lateWaiverReason, lateClaimReason, inspection },
  ): Promise<{ ok: boolean; released: number; kept: number; lateAmount: number; alreadyReleased: boolean;refundState?:string }> => {
    await ctx.runMutation(internal.adminAuth.assertAdminInternal, { token, fn: "checkout.markReturned" });
    const b: any = await ctx.runQuery(internal.bookings.getForRefund, { bookingId, includeControlsSnapshot:true });
    if (!b) throw new Error("Booking not found.");
    const { returned, quotedLate, late, waiver, sources, depositKept: retainedDeposit } = await validateReturnSelection(ctx, b, { bookingId, damageKept, depositKept, expectedSnapshot, damageNote, actualReturnedAt, chargeLate, lateWaiverReason, lateClaimReason, inspection });
    const hasSecurityClaim=(damageKept??0)>0||(retainedDeposit??0)>0||late.amount>0;
    if (hasCashDepositPolicy(b.securityPolicyVersion)) {
      const plan = refundableDepositPlan({deposit:b.depositAmount??0,capturedSecurity:sources.reduce((n:number,source:any)=>n+source.securityPence,0)/100,assessedDamage:damageKept??0,keptDeposit:retainedDeposit});
      await ctx.runMutation(internal.bookings.beginReturnDecision,{bookingId,actualReturnedAt:returned,damageKept:damageKept??0,depositKept:plan.damageFromDeposit,expectedSnapshot,damageNote:(damageKept??0)>0?damageNote?.trim():undefined,chargeLate,lateWaiverReason:!chargeLate&&b.returnDecision?.lateClaimPolicyVersion!="owner-claim-v1"&&quotedLate.amount>0?lateWaiverReason?.trim():undefined,lateClaimReason:chargeLate&&quotedLate.amount>0?lateClaimReason?.trim():undefined,inspection});
      await releaseUnclaimedReturnHolds(ctx,bookingId,b,hasSecurityClaim);
      await ctx.runMutation(internal.bookings.markReturnedStatus,{bookingId});
      let settlementReceipts:RefundReceipt[]=b.depositReturnReceipts??[];
      if (!b.depositRefunded) {
        for (const allocation of securityReturnPlan(sources,pence(plan.depositRefund))) {
          const persist=async(receipt:RefundReceipt)=>{await ctx.runMutation(internal.bookings.recordDepositReturnReceipt,{bookingId,receipt});};
          const initial:RefundReceipt=b.depositReturnReceipts?.find((row:RefundReceipt)=>row.paymentIntentId===allocation.paymentIntentId)??{paymentIntentId:allocation.paymentIntentId,amountPence:allocation.amountPence,attemptedAt:Date.now(),status:"unknown"};
          await persist(initial);
          const refund=await recoverApprovedRefund(stripe(),initial,{currency:"GBP",idempotencyKey:`dbc-deposit-release-${bookingId}-${allocation.paymentIntentId}${initial.attemptKey?`-${initial.attemptKey}`:""}`,metadata:{dbc_deposit_return_booking:String(bookingId),dbc_deposit_return_source:allocation.paymentIntentId,dbc_deposit_return_pence:String(allocation.amountPence),...(initial.attemptKey?{dbc_deposit_return_attempt:initial.attemptKey}:{})},now:Date.now(),maxRefunds:100,persist});
          await persist(refund);
          settlementReceipts=[...settlementReceipts.filter(row=>row.paymentIntentId!==refund.paymentIntentId),refund];
          if (!['succeeded','pending'].includes(refund.status)) throw new ConvexError({code:"DEPOSIT_REFUND_REVIEW",message:"The original deposit refund requires provider review before completion. Resume the saved decision after review; no second refund was issued.",...(refund.approvalUrl?{approvalUrl:refund.approvalUrl}:{})});
        }
        await ctx.runMutation(internal.bookings.markDepositReleased,{bookingId,kept:plan.damageFromDeposit,refunded:plan.depositRefund,capturedFromHold:0,note:damageNote?.trim()});
      }
      await ctx.runMutation(internal.savedCardState.markReturn,{bookingId,damageNote:damageNote?.trim()});
      await ctx.runMutation(internal.bookings.recordLateFee,{bookingId,actualReturnedAt:returned,...late,...waiver});
      return {ok:true,released:b.depositRefunded?b.depositRefundAmount??0:plan.depositRefund,kept:b.depositRefunded?b.depositKept??0:plan.damageFromDeposit,lateAmount:late.amount,alreadyReleased:!!b.depositRefunded,refundState:depositRefundState(settlementReceipts,pence(plan.depositRefund))};
    }
    if(isSavedCardRental(b)){
      await ctx.runMutation(internal.bookings.beginReturnDecision,{bookingId,actualReturnedAt:returned,damageKept:damageKept??0,damageNote:(damageKept??0)>0?damageNote?.trim():undefined,chargeLate,lateWaiverReason:!chargeLate&&b.returnDecision?.lateClaimPolicyVersion!="owner-claim-v1"&&quotedLate.amount>0?lateWaiverReason?.trim():undefined,lateClaimReason:chargeLate&&quotedLate.amount>0?lateClaimReason?.trim():undefined,inspection});
      await releaseUnclaimedReturnHolds(ctx,bookingId,b,hasSecurityClaim);
      await ctx.runMutation(internal.bookings.markReturnedStatus,{bookingId});
      await ctx.runMutation(internal.savedCardState.markReturn,{bookingId,damageNote:damageNote?.trim()});
      await ctx.runMutation(internal.bookings.recordLateFee,{bookingId,actualReturnedAt:returned,...late,...waiver});
      return {ok:true,released:0,kept:0,lateAmount:late.amount,alreadyReleased:!!b.depositRefunded};
    }
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
      const holdIntentId = b.stripeDepositIntentId ?? b.depositHoldIntentId;
      if (holdIntentId) {
        const observed = await stripe().paymentIntents.retrieve(holdIntentId);
        holdAvailable = observedHoldAmounts(b, observed).available;
      }
      returnSecurityPlan({ deposit, capturedSecurity: sources.reduce((n: number, source: any) => n + source.securityPence, 0) / 100, damage: kept, holdAvailable, holdUncaptured: 0 });
      if (!b.guestEmail) throw new Error("Customer email is required for an itemised damage notice.");
    }
    await ctx.runMutation(internal.bookings.beginReturnDecision, {
      bookingId, actualReturnedAt: returned, damageKept: kept, damageNote: kept ? damageNote?.trim() : undefined,
      chargeLate,
      lateWaiverReason: !chargeLate && b.returnDecision?.lateClaimPolicyVersion !== "owner-claim-v1" && quotedLate.amount > 0 ? lateWaiverReason?.trim() : undefined,
      lateClaimReason: chargeLate && quotedLate.amount > 0 ? lateClaimReason?.trim() : undefined,
      inspection,
    });
    await releaseUnclaimedReturnHolds(ctx,bookingId,b,hasSecurityClaim);
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

    if (b.depositRefunded || (deposit <= 0 && !hasSecurityClaim)) {
      await ctx.runMutation(internal.bookings.recordLateFee, { bookingId, actualReturnedAt: returned, ...late, ...waiver });
      return { ok: true, released: b.depositRefundAmount ?? 0, kept: b.depositKept ?? 0, lateAmount: late.amount, alreadyReleased: !!b.depositRefunded };
    }
    let capturedFromHold = 0;
    const holdIntentId = b.stripeDepositIntentId ?? b.depositHoldIntentId;
    if (holdIntentId) {
      const sb = stripe();
      const hold = await sb.paymentIntents.retrieve(holdIntentId);
      if (hold.status === "requires_capture") {
        capturedFromHold = Math.min(kept, observedHoldAmounts(b, hold).available);
        if (capturedFromHold > 0) {
          await sb.paymentIntents.capture(hold.id, { amount_to_capture: pence(capturedFromHold), final_capture: true }, { idempotencyKey: `dbc-hold-capture-${bookingId}` });
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
    const capturedSecurity = sources.reduce((sum:number,source:any)=>sum+source.securityPence,0);
    const toRefund = returnSecurityPlan({ deposit, capturedSecurity: capturedSecurity / 100, damage: kept, holdAvailable: capturedFromHold, holdUncaptured: 0 }).depositRefund;
    const refundablePence = pence(toRefund);
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
  ): Promise<{ bookingId: string | null; paid: boolean; closed?: boolean; membership?: string; holdStatus?: string; holdClientSecret?: string;cardSaved?:boolean;additionId?:string;verificationPending?:boolean;swapStatus?:string }> => {
    const session = await stripe().checkout.sessions.retrieve(sessionId);
    const m = session.metadata ?? {};
    const paid = checkoutCompleted(session);
    if(m.pickupCardBookingId){const bookingId=await recoverPickupCard(ctx,session);if(!bookingId)throw Error("This card update is no longer current. Refresh your rental account.");const b:any=await ctx.runQuery(internal.pickupSecurity.context,{bookingId:bookingId as any});return {bookingId,paid,holdStatus:b?.depositHoldStatus??"none",cardSaved:true};}
    if(m.filmFundEntryId){const r=await ctx.runAction(internal.filmFundPayments.fulfill,{sessionId});return {bookingId:null,paid:r.paid};}
    if(m.rentalDeliveryQuoteId){if(paid)await ctx.runAction(internal.rentalDelivery.finalizePaid,{id:m.rentalDeliveryQuoteId as any,sessionId});else if(session.status==="expired")await ctx.runAction(internal.rentalDelivery.expire,{id:m.rentalDeliveryQuoteId as any,sessionId});return {bookingId:m.bookingId??null,paid};}
    if(m.itemSwapId)return await ctx.runAction(internal.rentalSwapPayments.finalize,{sessionId});

    if(paid&&m.rentalAdditionId){const r=await ctx.runAction(internal.rentalAdditions.finalizePaid,{id:m.rentalAdditionId as any,sessionId});return {bookingId:r.bookingId,paid,closed:r.closed,holdStatus:r.status,holdClientSecret:r.clientSecret,additionId:m.rentalAdditionId};}
    if(paid&&m.pendingAdditionId){const r=await ctx.runAction(internal.rentalAdditions.finalizePaid,{id:m.pendingAdditionId as any,sessionId});if(r.closed)return {bookingId:r.bookingId,paid,closed:true};}

    if (m.membershipTier && session.status === "complete") {
      await fulfillMembershipForBooking(ctx, session);
      if (!m.bookingId) return { bookingId: null, paid: paid || session.payment_status === "no_payment_required", membership: m.membershipTier };
    }

    // add-on payment → attach to the existing booking
    if (paid && m.addonBookingId) {
      const result=await fulfillLegacyAddon(ctx,session);
      return {bookingId:m.addonBookingId,paid,closed:result.closed};
    }

    // extend payment → apply the extra days to the targeted item(s)
    if (paid && m.priceAdjustmentId) return ctx.runAction(internal.rentalPricePayments.finalize,{sessionId:session.id});
    if (paid && m.changeRequestId) {
      return ctx.runAction(internal.rentalExtensionPayments.finalize, { sessionId: session.id });
    }

    const bookingId = (m.bookingId as string) ?? null;
    if (paid && bookingId) {
      let confirmation: any;
      try {
        confirmation = await confirmPaidBookingWithLiveStock(
          ctx,
          bookingId as any,
          session,
        );
      } catch (error) {
        await ctx.scheduler.runAfter(60_000, internal.checkout.reconcilePendingPayments, {});
        throw error;
      }
      if (confirmation.closed) {if(confirmation.duplicatePayment)await refundDuplicateCheckout(session);return { bookingId, paid, closed: true };}
      if (confirmation.awaitingVerification) {
        const hold = await authorizeHold(ctx, session);
        return { bookingId, paid, verificationPending: true, holdStatus: hold.status, holdClientSecret: hold.clientSecret };
      }
      if (confirmation.awaitingInventoryReview) {
        await ctx.scheduler.runAfter(15 * 60000, internal.checkout.confirmAfterVerification, { bookingId: bookingId as any, attempt: 1 });
        return { bookingId, paid, verificationPending: true };
      }
      if (!confirmation.already) await ctx.runMutation(api.analytics.track, { type: "purchase" });
      const hold = await authorizeHold(ctx, session);
      return { bookingId, paid, holdStatus: hold.status, holdClientSecret: hold.clientSecret };
    }
    return { bookingId, paid };
  },
});

export const confirmAfterVerification = internalAction({
  args: { bookingId: v.id("bookings"), attempt: v.optional(v.number()) },
  handler: async (ctx, { bookingId, attempt = 0 }) => {
    const retry = async () => {
      if (attempt < 3) await ctx.scheduler.runAfter(15 * 60000, internal.checkout.confirmAfterVerification, { bookingId, attempt: attempt + 1 });
      else await ctx.runMutation(internal.bookings.markVerificationConfirmationFailure, { bookingId });
    };
    let booking: any;
    try { booking = await ctx.runQuery(internal.bookings.verificationAccess, { bookingId }); }
    catch (error) { console.error("Paid Didit booking lookup failed", bookingId, error); await retry(); return; }
    if (!booking || !["pending_payment", "pending_verification"].includes(booking.status) || booking.verificationProvider !== "didit" ||
        booking.idVerifyStatus !== "verified") return;
    if (!booking.stripeCheckoutSessionId) {
      await ctx.runMutation(internal.bookings.markVerificationConfirmationFailure, { bookingId });
      return;
    }
    let session: Stripe.Checkout.Session;
    try { session = await stripe().checkout.sessions.retrieve(booking.stripeCheckoutSessionId); }
    catch (error) { console.error("Paid Didit checkout retrieval failed", bookingId, error); await retry(); return; }
    if (session.metadata?.bookingId !== String(bookingId) || !checkoutCompleted(session)) {
      await ctx.runMutation(internal.bookings.markVerificationConfirmationFailure, { bookingId });
      return;
    }
    let confirmation: any;
    try {
      confirmation = await confirmPaidBookingWithLiveStock(ctx, bookingId as any, session);
    } catch (error) { console.error("Paid Didit booking confirmation failed", bookingId, error); await retry(); return; }
    if (confirmation.closed) {
      if (confirmation.duplicatePayment) await refundDuplicateCheckout(session);
      return;
    }
    if (confirmation.awaitingInventoryReview) {
      if (attempt < 3) await ctx.scheduler.runAfter(15 * 60000, internal.checkout.confirmAfterVerification, { bookingId, attempt: attempt + 1 });
      return;
    }
    if (confirmation.awaitingVerification || confirmation.already) return;
    await ctx.runMutation(api.analytics.track, { type: "purchase" });
    await authorizeHold(ctx, session);
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
          if (session.metadata?.membershipTier) await fulfillMembershipForBooking(ctx, session);
          const result = await confirmPaidBookingWithLiveStock(ctx, booking.bookingId, session);
          if (result.closed) {
            if(result.duplicatePayment)await refundDuplicateCheckout(session);
            console.error("Paid checkout was already closed", booking.bookingId);
            failures++;
            continue;
          }
          if (result.awaitingInventoryReview) {
            await ctx.scheduler.runAfter(15 * 60000, internal.checkout.confirmAfterVerification, { bookingId: booking.bookingId, attempt: 1 });
            failures++;
            continue;
          }
          if (result.awaitingVerification) {
            try { await authorizeHold(ctx, session); }
            catch (error) { console.error("Card hold authorization failed during verification", error); }
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
    if (event.type === "charge.dispute.created" || event.type === "charge.dispute.updated" || event.type === "charge.dispute.closed") {
      const dispute = event.data.object as Stripe.Dispute;
      const intent = typeof dispute.payment_intent === "string" ? dispute.payment_intent : dispute.payment_intent?.id;
      await ctx.runMutation((internal as any).stripeDisputes.record, { eventId: event.id, eventType: event.type, paymentIntentId: intent ?? undefined });
      return true;
    }
    if (event.type === "checkout.session.completed" || event.type === "checkout.session.async_payment_succeeded") {
      const s = event.data.object as Stripe.Checkout.Session;
      const m = s.metadata ?? {};
      if(m.pickupCardBookingId){await recoverPickupCard(ctx,await stripe().checkout.sessions.retrieve(s.id));return true;}
      if(m.filmFundEntryId){await ctx.runAction(internal.filmFundPayments.fulfill,{sessionId:s.id});return true;}
      if(m.rentalDeliveryQuoteId){if(checkoutCompleted(s))await ctx.runAction(internal.rentalDelivery.finalizePaid,{id:m.rentalDeliveryQuoteId as any,sessionId:s.id});return true;}
      if(m.itemSwapId){if(checkoutCompleted(s))await ctx.runAction(internal.rentalSwapPayments.finalize,{sessionId:s.id});return true;}
      const pi = await checkoutPaymentIntent(s);
      if (m.membershipTier) await fulfillMembershipForBooking(ctx, s);
      if (checkoutCompleted(s)) {
        if(m.rentalAdditionId){await ctx.runAction(internal.rentalAdditions.finalizePaid,{id:m.rentalAdditionId as any,sessionId:s.id});return true;}
        if(m.pendingAdditionId){const r=await ctx.runAction(internal.rentalAdditions.finalizePaid,{id:m.pendingAdditionId as any,sessionId:s.id});if(r.closed)return true;}
        if (m.bookingId) {
          const confirmation = await confirmPaidBookingWithLiveStock(ctx, m.bookingId as any, s);
          if (confirmation.closed) {if(confirmation.duplicatePayment)await refundDuplicateCheckout(s);return true;}
          if (confirmation.awaitingInventoryReview) {
            await ctx.scheduler.runAfter(15 * 60000, internal.checkout.confirmAfterVerification, { bookingId: m.bookingId as any, attempt: 1 });
            return true;
          }
          try { await authorizeHold(ctx, s); }
          catch (e) { console.error("Card hold authorization failed", e); }
        } else if (m.addonBookingId) {
          await fulfillLegacyAddon(ctx,s);
        } else if (m.membershipTier) {
          await fulfillMembership(ctx, await stripe().checkout.sessions.retrieve(s.id));
        } else if (m.priceAdjustmentId) {
          await ctx.runAction(internal.rentalPricePayments.finalize,{sessionId:s.id});
        } else if (m.changeRequestId) {
          await ctx.runAction(internal.rentalExtensionPayments.finalize, { sessionId: s.id });
        }
      }
    }
    if (event.type === "checkout.session.async_payment_failed" || event.type === "checkout.session.expired") {
      const s = event.data.object as Stripe.Checkout.Session;
      if(s.metadata?.itemSwapId){
        if(event.type==="checkout.session.async_payment_failed"&&typeof s.amount_total==="number"&&typeof s.currency==="string")await ctx.runMutation(internal.rentalSwapState.asyncPaymentFailed,{id:s.metadata.itemSwapId as any,sessionId:s.id,amountPence:s.amount_total,currency:s.currency});
        return true;
      }
      if (s.metadata?.rentalDeliveryQuoteId) {
        if (event.type === "checkout.session.expired") await ctx.runAction(internal.rentalDelivery.expire, { id: s.metadata.rentalDeliveryQuoteId as any, sessionId: s.id });
        else await ctx.runAction(internal.rentalDelivery.markFailed, { id: s.metadata.rentalDeliveryQuoteId as any, sessionId: s.id });
        return true;
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
    if (["payment_intent.succeeded","payment_intent.processing","payment_intent.payment_failed","payment_intent.canceled"].includes(event.type)) {
      const intent=event.data.object as Stripe.PaymentIntent;
      if(intent.metadata?.purpose==="rental_saved_card_charge"&&intent.metadata.securityChargeId)
        await ctx.runAction(internal.securityCharges.reconcileWebhook,{id:intent.metadata.securityChargeId,intentId:intent.id});
    }
    if (["refund.created","refund.updated","refund.failed"].includes(event.type)) {
      const refund=await stripe().refunds.retrieve((event.data.object as Stripe.Refund).id);
      if(refund.metadata?.dbc_deposit_return_booking)await ctx.runAction(internal.checkout.reconcileDepositRefund,{refundId:refund.id});
      const feePayment = typeof refund.payment_intent === "string" ? refund.payment_intent : refund.payment_intent?.id;
      if (feePayment) await ctx.runAction(internal.securityCharges.refundWebhook, {paymentIntentId:feePayment});
      await reconcileFullyRefundedMembership(ctx,refund);
      await ctx.runAction(internal.filmFundPayments.reconcileRefund,{refundId:refund.id});
      if(refund.metadata?.rentalRefundId)await ctx.runAction(internal.checkout.reconcileRentalRefund,{refundId:refund.id});
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
      if(subId){const sub=await stripe().subscriptions.retrieve(subId);if(process.env.MEMBERSHIP_HISTORICAL_INVOICE_CREDIT_V1 === "enabled")await grantStripeMembershipInvoice(ctx,invoice,sub);else await reconcileMembershipCreditNotes(ctx,invoice,sub);}
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
        const applied = await ctx.runMutation(internal.accounts._applyMembershipReconcile, { accountId: s.accountId, subscriptionId: s.subscriptionId, active: false });
        if (applied) changed++;
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
async function releaseUnclaimedReturnHolds(ctx:any,bookingId:any,b:any,hasSecurityClaim:boolean) {
  if(hasSecurityClaim)return;
  const primaryIntentId=b.stripeDepositIntentId??b.depositHoldIntentId;
  const ids=[primaryIntentId,b.depositHoldRenewalIntentId,...(b.depositHoldPreviousIntentIds??[])].filter((id):id is string=>!!id);
  if(ids.length)await releaseBookingHolds(ctx,bookingId,b);
}

async function releaseBookingHolds(ctx: any, bookingId: any, b: any) {
  const sb = stripe();
  const primaryIntentId=b.stripeDepositIntentId??b.depositHoldIntentId;
  const previousIds=new Set<string>(b.depositHoldPreviousIntentIds??[]);
  const ids = [...new Set([
    primaryIntentId,
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
    if (id === primaryIntentId)
      await ctx.runMutation(internal.bookings.setHold, { bookingId, intentId: id, status: "released" });
    else if (previousIds.has(id))
      await ctx.runMutation(internal.bookings.clearPreviousHold,{bookingId,intentId:id});
    else if (id === b.depositHoldRenewalIntentId && primaryIntentId)
      await ctx.runMutation(internal.bookings.setRenewalResult,{bookingId,oldIntentId:primaryIntentId,intentId:id,status:"released"});
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
  const refunds:Stripe.Refund[]=[];for await(const refund of stripe().refunds.list({payment_intent:payment.id,limit:100})){if(refunds.length>=100)throw new RefundReviewRequired("Refund history exceeds the safe review bound. No new refund was issued.");refunds.push(refund);}
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

async function cancellationSourceBalance(source:any,b:any,bookingId:any,strict=false){
 const payment=await stripe().paymentIntents.retrieve(source.paymentIntentId);
 if(strict&&(payment.id!==source.paymentIntentId||payment.status!=="succeeded"||payment.currency!==(b.currency??"GBP").toLowerCase()||!Number.isSafeInteger(payment.amount_received)||payment.amount_received<0||payment.metadata?.bookingId&&payment.metadata.bookingId!==String(bookingId)))throw new RefundReviewRequired("The payment does not match this rental's captured currency or ownership. Review before settlement.");
 return {...source,availablePence:await remainingCancellationPayment(payment,source.maxPaidPence)};
}
async function cancelRental(ctx:any,bookingId:any,b:any,accountId?:any,adminReason?:string,fullCreditOfferId?:any,changeRequestId?:any,expectedCancellationKind?:"full_refund"|"store_credit"|"no_refund",customerChoice?:"refund"|"credit"){
 const requestId=changeRequestId??b.cancellationDecision?.changeRequestId;
 const resolvedCustomerChoice=customerChoice??b.cancellationDecision?.customerChoice;
 const decision=await ctx.runMutation(internal.bookings.prepareCancellation,{bookingId,fullCreditOfferId,...(b.cancellationDecision?.operatorOfferId?{operatorOfferId:b.cancellationDecision.operatorOfferId}:{}),...(requestId?{changeRequestId:requestId}:{}),...(expectedCancellationKind?{expectedCancellationKind}:{}),...(resolvedCustomerChoice?{customerChoice:resolvedCustomerChoice}:{})});
 const operatorContext:any=decision.operatorOfferId?await ctx.runQuery(internal.operatorCancellationState.byId,{offerId:decision.operatorOfferId}):null;
 const operator:any=operatorContext?.offer??null;
 if(decision.operatorOfferId&&(!operator||operator.state!=="chosen"||!operator.choice))throw Error("The cancellation settlement choice is not ready.");
 if(operator?.choice==="credit"&&(!operatorContext.account||operatorContext.account.blockedAt!=null))throw new RefundReviewRequired("The account was restricted after its cancellation choice. Review the agreed terms and settlement before issuing credit or changing the choice.");
 let quote=decision.quote;
 if(!quote){
  const paidIntentId=await paymentBeforeCancellation(b);
  let mode:"none"|"refund"|"credit"|"no_refund"="none",refundAmount=0,creditAmount=0,bonusCreditAmount=0,allocations:any[]=[];
  if(paidIntentId || (b.status==="confirmed"||operator)&&(b.creditApplied??0)>0){
   const sources=paidIntentId?(b.paymentSources?.length?b.paymentSources:[{paymentIntentId:paidIntentId,securityPence:pence(b.depositAmount)}]):[];
   const balances=await Promise.all(sources.map((source:any)=>cancellationSourceBalance(source,b,bookingId,!!operator||!!decision.inventoryConflictRefund)));
   if(decision.inventoryConflictRefund&&(balances.length!==1||balances[0].paymentIntentId!==paidIntentId||balances[0].availablePence!==pence(b.total)))throw new RefundReviewRequired("The original payment balance changed. Review it before refunding.");
   const spent=(b.status==="confirmed"||operator)?pence(b.creditApplied??0):0;
   const settlement = decision.fullCreditOfferId
    ? { allocations: [], refundPence: 0, creditPence: balances.reduce((sum:number, source:any) => sum + source.availablePence, 0) + pence(b.creditApplied ?? 0) }
    : cancellationPaymentPlan(operator?(operator.choice==="credit"?"store_credit":"full_refund"):decision.customerChoice==="credit"?"store_credit":decision.kind,balances,spent);
   if(operator){
    const security=cancellationPaymentPlan("store_credit",balances,0).refundPence,cash=balances.reduce((n:number,s:any)=>n+s.availablePence,0);
    if(cash!==operator.cashRemainingPence||security!==operator.securityRemainingPence||spent!==operator.spentCreditPence)throw new RefundReviewRequired("The provider balance changed after the cancellation offer. Review the settlement before execution.");
    if(operator.choice==="credit"){const options=operatorCancellationOptions({cashRemainingPence:cash,securityRemainingPence:security,spentCreditPence:spent});bonusCreditAmount=options.credit.bonusPence/100;settlement.creditPence=options.credit.creditPence;}
   }
   if(decision.fullCreditOfferId){
    const offer:any=await ctx.runQuery(internal.rentalCreditOffers.byId,{offerId:decision.fullCreditOfferId});
    if(!offer||settlement.creditPence!==offer.amountPence)throw Error("The payment balance changed. The team must review the credit quote before cancellation.");
   }
   allocations=settlement.allocations;
   mode=operator?(operator.choice==="credit"?"credit":"refund"):decision.fullCreditOfferId||decision.customerChoice==="credit"?"credit":decision.kind==="full_refund"?"refund":decision.kind==="no_refund"?"no_refund":"credit";refundAmount=settlement.refundPence/100;creditAmount=settlement.creditPence/100;
   if(creditAmount>0&&!accountId)throw Error("The renter needs an account with their booking email before account credit can be issued. Resume this cancellation after account creation.");
  }
  quote=await ctx.runMutation(internal.bookings.recordCancellationQuote,{bookingId,quote:{mode,refundAmount,creditAmount,...(operator?{bonusCreditAmount}:{}),paymentIntentId:paidIntentId??undefined,allocations}});
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
 }catch(error){review=error instanceof RefundReviewRequired||(error as any)?.data?.code==="CANCELLATION_REVIEW";throw error;}
 finally{await ctx.runMutation(internal.cancellationRecovery.finishAttempt,{id:job._id,generation:job.generation,complete,review});}
}

/** Retry only durable, already-requested cancellations; never initiate a new cancellation. */
/** Read-only source balance for a prepared operator cancellation. */
export const operatorCancellationBalance=internalAction({args:{offerId:v.id("operator_cancellation_offers")},handler:async(ctx,a):Promise<any>=>{
 try{
 const context:any=await ctx.runQuery(internal.operatorCancellationState.byId,a),offer=context?.offer;
 const b:any=offer?await ctx.runQuery(internal.bookings.getForCancel,{bookingId:offer.bookingId}):null;
 if(!b||!offer||b.cancellationDecision?.operatorOfferId!==offer._id||Date.now()<offer.decisionAfter)throw Error("The cancellation decision window is still open or changed.");
 if((context.account?.membershipCreditDebtPence??0)>0&&(b.creditApplied??0)>0)throw new RefundReviewRequired("Reversed membership credit must be reconciled before offering this settlement.");
 const id=await paymentBeforeCancellation(b),sources=id?(b.paymentSources?.length?b.paymentSources:[{paymentIntentId:id,securityPence:pence(b.depositAmount)}]):[];
 const balances=await Promise.all(sources.map((source:any)=>cancellationSourceBalance(source,b,offer.bookingId,true)));
 const cashRemainingPence=balances.reduce((n:number,s:any)=>n+s.availablePence,0),securityRemainingPence=cancellationPaymentPlan("store_credit",balances,0).refundPence,spentCreditPence=pence(b.creditApplied??0);
 operatorCancellationOptions({cashRemainingPence,securityRemainingPence,spentCreditPence});return {cashRemainingPence,securityRemainingPence,spentCreditPence};
 }catch(error){if(error instanceof RefundReviewRequired)throw new ConvexError({code:"OPERATOR_CANCELLATION_REVIEW",message:error.message});throw error;}
}});
export const settleOperatorCancellation=internalAction({args:{offerId:v.id("operator_cancellation_offers")},handler:async(ctx,a):Promise<any>=>{
 const context:any=await ctx.runQuery(internal.operatorCancellationState.byId,a);
 if(context?.offer.state==="settled")return {already:true};
 if(context?.offer.state!=="chosen")throw Error("The renter settlement choice is not ready.");
 const b:any=await ctx.runQuery(internal.bookings.getForCancel,{bookingId:context.offer.bookingId});
 try{return await cancelRental(ctx,context.offer.bookingId,b,context.offer.accountId,context.offer.reason);}catch(error){if(error instanceof RefundReviewRequired)throw new ConvexError({code:"OPERATOR_CANCELLATION_REVIEW",message:error.message});throw error;}
}});
export const reconcileCancellations=internalAction({args:{},handler:async(ctx)=>{
 await ctx.runAction(internal.operatorCancellation.reconcile,{});
 const jobs:any[]=await ctx.runQuery(internal.cancellationRecovery.due,{});
 for(const job of jobs){
  try{
   const b:any=await ctx.runQuery(internal.bookings.getForCancel,{bookingId:job.bookingId});
   if(b?.status==="cancelled"&&!b.cancellationDecision?.operatorOfferId){await ctx.runMutation(internal.cancellationRecovery.finishAttempt,{id:job._id,complete:true});continue;}
   if(b?.cancellationDecision?.quote)await cancelRental(ctx,job.bookingId,b,job.accountId,job.adminReason,b.cancellationDecision.fullCreditOfferId);
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
 args:{token:v.string(),bookingId:v.id("bookings"),reason:v.optional(v.string()),changeRequestId:v.optional(v.id("rental_change_requests")),expectedCancellationKind:v.optional(v.union(v.literal("full_refund"),v.literal("store_credit"),v.literal("no_refund")))},
 handler:async(ctx,{token,bookingId,reason,changeRequestId,expectedCancellationKind}):Promise<{refundAmount:number;creditAmount:number;mode:string}>=>{
  await ctx.runMutation(internal.adminAuth.assertAdminInternal,{token,fn:"checkout.cancelByAdmin"});
  reason=reason?.trim()||(changeRequestId?"Requested cancellation approved":"Equipment unexpectedly unavailable");
  const b:any=await ctx.runQuery(internal.bookings.getForCancel,{bookingId});
  if(!changeRequestId&&(b?.cancellationDecision?.operatorOfferId||process.env.CANCELLATION_PROTECTION_POLICY_ENABLED==="true"&&b?.status==="confirmed")){
   const offer:any=await ctx.runMutation(internal.operatorCancellationState.begin,{bookingId,reason});
   return {refundAmount:0,creditAmount:0,mode:offer.state==="settled"?"settled":"waiting"};
  }
  if(changeRequestId && b?.status==="cancelled" && b.completedChangeRequestId===changeRequestId && b.cancellationDecision?.quote)return {refundAmount:b.cancellationDecision.quote.refundAmount,creditAmount:b.cancellationDecision.quote.creditAmount,mode:b.cancellationDecision.quote.mode};
  if(!b||!["confirmed","pending_payment"].includes(b.status)||!b.siteOnly)throw Error("Only unstarted direct bookings can be cancelled here");
  return cancelRental(ctx,bookingId,b,b.accountId??undefined,reason.trim().slice(0,400),undefined,changeRequestId,expectedCancellationKind);
 }
});
export const refundInventoryConflict = action({
 args:{token:v.string(),bookingId:v.id("bookings"),confirmed:v.boolean(),reason:v.string()},
 handler:async(ctx,{token,bookingId,confirmed,reason}):Promise<any>=>{
  await ctx.runMutation(internal.adminAuth.assertAdminInternal,{token,fn:"checkout.refundInventoryConflict"});
  if(process.env.INVENTORY_CONFLICT_REFUND_ENABLED!=="true")throw Error("This settlement is not enabled; review it with the team.");
  if(!confirmed)throw Error("Review the original payment and confirm the refund first.");
  const b:any=await ctx.runQuery(internal.bookings.getForCancel,{bookingId});
  if(b?.status==="cancelled"&&b.cancellationDecision?.inventoryConflictRefund)return {ok:true,already:true};
  if(!b||b.status!=="pending_verification"||b.verificationConfirmationIssue!=="inventory_unavailable"||!b.siteOnly||!b.stripeCheckoutSessionId||!b.stripePaymentIntentId)throw Error("A paid unconfirmed rental with an inventory conflict is required.");
  const session=await stripe().checkout.sessions.retrieve(b.stripeCheckoutSessionId);
  const paymentId=await checkoutPaymentIntent(session);
  if(!paymentId||session.id!==b.stripeCheckoutSessionId||session.status!=="complete"||session.payment_status!=="paid"||session.metadata?.bookingId!==String(bookingId)||paymentId!==b.stripePaymentIntentId||session.currency?.toLowerCase()!==(b.currency??"GBP").toLowerCase()||session.amount_total!==pence(b.total))throw Error("The original checkout payment does not match this rental. No refund was issued.");
  await ctx.runMutation(internal.bookings.prepareInventoryConflictRefund,{bookingId,sessionId:session.id,paymentIntentId:paymentId,reason});
  const frozen:any=await ctx.runQuery(internal.bookings.getForCancel,{bookingId});
  return cancelRental(ctx,bookingId,frozen,frozen.accountId??undefined,frozen.cancellationDecision.inventoryConflictReason,undefined,undefined,"full_refund");
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
  return cancelRental(ctx,bookingId,b,me._id);
 }
});
export const cancelByCustomer = action({
 args:{token:v.string(),bookingId:v.id("bookings"),expectedCancellationKind:v.optional(v.union(v.literal("full_refund"),v.literal("store_credit"),v.literal("no_refund"))),customerChoice:v.optional(v.union(v.literal("refund"),v.literal("credit")))},
 handler:async(ctx,{token,bookingId,expectedCancellationKind,customerChoice}):Promise<{ok:boolean;mode:string;refundAmount:number;creditAmount:number}>=>{
  if(process.env.CUSTOMER_BOOKING_ACTIONS!=="true")throw Error("Online cancellation isn't available yet — please contact us to cancel.");
  const me:any=await ctx.runQuery(api.accounts.me,{token});if(!me)throw Error("Please sign in.");
  const b:any=await ctx.runQuery(internal.bookings.getForCancel,{bookingId});
  if(!belongsToRentalAccount(b,me))throw Error("unauthorized");
  if(b.status==="cancelled"&&b.cancellationDecision?.quote&&!b.cancellationDecision.operatorOfferId){const quote=b.cancellationDecision.quote;return {ok:true,mode:quote.mode,refundAmount:quote.refundAmount,creditAmount:quote.creditAmount};}
  if(b.cancelledAt||b.status==="cancelled")throw Error("This booking is already cancelled.");
  if(!["confirmed","pending_payment"].includes(b.status)||!b.siteOnly)throw Error("Please contact us to change this booking.");
  return cancelRental(ctx,bookingId,b,me._id,undefined,undefined,undefined,expectedCancellationKind,customerChoice);
 }
});

/** Owner-only, durable and idempotent rental refund. Security is handled by return/cancel. */
export const refundRental=action({
 args:{token:v.string(),bookingId:v.id("bookings"),requestId:v.string(),amountPence:v.optional(v.number()),reason:v.string(),expectedSnapshot:v.optional(v.string())},
 handler:async(ctx,args):Promise<{status:string;amount:number;approvalUrl?:string}>=>{
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
  for(const allocation of allocations){
   const part=job.parts?.find((p:any)=>p.paymentIntentId===allocation.paymentIntentId);
   const initial:RefundReceipt=job.refundReceipts?.find((r:RefundReceipt)=>r.paymentIntentId===allocation.paymentIntentId)??{paymentIntentId:allocation.paymentIntentId,amountPence:allocation.amountPence,attemptedAt:job.createdAt,status:"unknown",...(part?.stripeRefundId?{stripeRefundId:part.stripeRefundId}:{})};
   const persist=async(receipt:RefundReceipt)=>{await ctx.runMutation(internal.rentalOperations.recordRefundReceipt,{id:job._id,receipt})};await persist(initial);
   const receipt=await recoverApprovedRefund(stripe(),initial,{currency:"GBP",now:Date.now(),maxRefunds:100,persist,idempotencyKey:allocation.paymentIntentId===allocations[0].paymentIntentId?`dbc-rental-refund-${job._id}`:`dbc-rental-refund-${job._id}-${allocation.paymentIntentId}`,metadata:{rentalRefundId:job._id,rentalPaymentIntent:allocation.paymentIntentId,bookingId:args.bookingId}});await persist(receipt);
   if(receipt.status==="awaiting_approval")return {status:receipt.status,amount:job.amountPence/100,...(receipt.approvalUrl?{approvalUrl:receipt.approvalUrl}:{})};
   if(!receipt.stripeRefundId)throw Error("Refund provider receipt requires review.");
   const result=receipt.status==="succeeded"?"succeeded":receipt.status==="failed"?"failed":"pending";if(result!=="succeeded")status=result;
   await ctx.runMutation(internal.rentalOperations.recordRefundPart,{id:job._id,paymentIntentId:allocation.paymentIntentId,stripeRefundId:receipt.stripeRefundId,status:result});
  }
  return {status,amount:job.amountPence/100};
 }
});

function savedReturnArguments(bookingId:any,d:any){
 return {token:process.env.ADMIN_TOKEN??"",bookingId,actualReturnedAt:d.actualReturnedAt,damageKept:d.damageKept,depositKept:d.depositKept,expectedSnapshot:d.expectedSnapshot,damageNote:d.damageNote,chargeLate:d.chargeLate,lateWaiverReason:d.lateWaiverReason,inspection:d.inspection?.map(({key,condition,details,openCase}:any)=>({key,condition,details,openCase}))};
}
async function resumeDepositDecision(ctx:any,bookingId:any,b:any){
 if(!b.returnDecision||b.depositRefunded)return {ok:true,alreadyReleased:!!b.depositRefunded};
 return ctx.runAction(api.checkout.markReturned,savedReturnArguments(bookingId,b.returnDecision));
}
export const recoverDepositReturn=internalAction({args:{bookingId:v.id("bookings"),attempt:v.number()},handler:async(ctx,{bookingId,attempt}):Promise<void>=>{
 if(!Number.isInteger(attempt)||attempt<0||attempt>5)return;
 const delays=[900000,3600000,21600000,86400000,86400000];
 let b:any;
 try{b=await ctx.runQuery(internal.bookings.getForRefund,{bookingId,includeControlsSnapshot:true});}catch{if(attempt<delays.length)await ctx.scheduler.runAfter(delays[attempt],internal.checkout.recoverDepositReturn,{bookingId,attempt:attempt+1});await ctx.runMutation(internal.bookings.alertDepositRecovery,{bookingId});return;}
 if(!b?.returnDecision)return;
 const cashPolicy=hasCashDepositPolicy(b.securityPolicyVersion);
 const unclaimedHoldRelease=!cashPolicy&&!b.returnDecision.chargeLate&&(b.returnDecision.damageKept??0)===0&&(b.returnDecision.depositKept??0)===0&&!!(b.stripeDepositIntentId||b.depositHoldIntentId||b.depositHoldRenewalIntentId||(b.depositHoldPreviousIntentIds??[]).length);
 if(!cashPolicy&&!unclaimedHoldRelease)return;
 if(unclaimedHoldRelease){
  try{await ctx.runAction(api.checkout.markReturned,savedReturnArguments(bookingId,b.returnDecision));}
  catch{if(attempt<delays.length)await ctx.scheduler.runAfter(delays[attempt],internal.checkout.recoverDepositReturn,{bookingId,attempt:attempt+1});await ctx.runMutation(internal.bookings.alertDepositRecovery,{bookingId});}
  return;
 }
 const expected=pence(Math.max(0,(b.depositAmount??0)-(b.returnDecision.depositKept??0)));
 const state=depositRefundState(b.depositReturnReceipts??[],expected);
 if(b.actualReturnedAt&&b.depositRefunded&&state==="succeeded")return;
 if(state==="failed"){await ctx.runMutation(internal.bookings.alertDepositRecovery,{bookingId});return;}
 if(attempt<delays.length)await ctx.scheduler.runAfter(delays[attempt],internal.checkout.recoverDepositReturn,{bookingId,attempt:attempt+1});
 try{
  if(!b.depositRefunded||!b.actualReturnedAt)await ctx.runAction(api.checkout.markReturned,savedReturnArguments(bookingId,b.returnDecision));
  else for(const receipt of b.depositReturnReceipts??[])if(receipt.status==="pending"&&receipt.stripeRefundId)await ctx.runAction(internal.checkout.reconcileDepositRefund,{refundId:receipt.stripeRefundId});
 }catch{await ctx.runMutation(internal.bookings.alertDepositRecovery,{bookingId});return;}
 if(attempt>=2)await ctx.runMutation(internal.bookings.alertDepositRecovery,{bookingId});
}});
export const reconcileDepositRefund=internalAction({args:{refundId:v.string()},handler:async(ctx,{refundId}):Promise<any>=>{
 const refund=await stripe().refunds.retrieve(refundId),bookingId=refund.metadata?.dbc_deposit_return_booking;if(!bookingId)return {ignored:true};
 const b:any=await ctx.runQuery(internal.bookings.getForRefund,{bookingId:bookingId as any,includeControlsSnapshot:true});if(!b||!hasCashDepositPolicy(b.securityPolicyVersion)||!b.returnDecision)return {ignored:true};
 const pi=typeof refund.payment_intent==="string"?refund.payment_intent:refund.payment_intent?.id;
 const receipt=b.depositReturnReceipts.find((r:RefundReceipt)=>r.paymentIntentId===pi);
 if(!receipt||(receipt.stripeRefundId&&receipt.stripeRefundId!==refund.id)||receipt.attemptKey!==(refund.metadata?.dbc_deposit_return_attempt||undefined))return {ignored:true};
 if(refund.currency!=="gbp"||refund.amount!==receipt.amountPence||refund.metadata?.dbc_deposit_return_source!==pi||refund.metadata?.dbc_deposit_return_pence!==String(receipt.amountPence))throw Error("Deposit refund provider receipt mismatch.");
 const updated={...receipt,stripeRefundId:refund.id,status:refund.status==="succeeded"?"succeeded":refund.status==="failed"||refund.status==="canceled"?"failed":"pending"};
 await ctx.runMutation(internal.bookings.recordDepositReturnReceipt,{bookingId:bookingId as any,receipt:updated});
 if(updated.status==="failed")return {needsReview:true};
 const fresh:any=await ctx.runQuery(internal.bookings.getForRefund,{bookingId:bookingId as any,includeControlsSnapshot:true});
 // Resolve only the saved operator decision; this action never makes a new retention choice.
 try{return await resumeDepositDecision(ctx,bookingId,fresh);}catch(e){if(e instanceof RefundReviewRequired||e instanceof ConvexError&&(e.data as any)?.code==="DEPOSIT_REFUND_REVIEW")return {needsReview:true};throw e;}
}});
export const resumeDepositRefund=action({args:{token:v.string(),bookingId:v.id("bookings"),confirmed:v.boolean()},handler:async(ctx,a):Promise<any>=>{await ctx.runMutation(internal.adminAuth.assertAdminInternal,{token:a.token,fn:"checkout.resumeDepositRefund"});if(!a.confirmed)throw Error("Confirm resuming the saved deposit decision first.");const b:any=await ctx.runQuery(internal.bookings.getForRefund,{bookingId:a.bookingId,includeControlsSnapshot:true});if(!b||!hasCashDepositPolicy(b.securityPolicyVersion))throw Error("Refundable-deposit rental required.");return resumeDepositDecision(ctx,a.bookingId,b);}});
export const retryDepositRefund=action({args:{token:v.string(),bookingId:v.id("bookings"),refundId:v.string(),requestId:v.string(),expectedSnapshot:v.string(),confirmed:v.boolean()},handler:async(ctx,a):Promise<any>=>{
 await ctx.runMutation(internal.adminAuth.assertAdminInternal,{token:a.token,fn:"checkout.retryDepositRefund"});if(!a.confirmed)throw Error("Review and confirm the failed deposit refund first.");
 const b:any=await ctx.runQuery(internal.bookings.getForRefund,{bookingId:a.bookingId,includeControlsSnapshot:true});if(!b||!hasCashDepositPolicy(b.securityPolicyVersion)||!b.returnDecision)throw Error("A saved refundable-deposit decision is required.");
 const replay=b.depositReturnReceipts.find((r:RefundReceipt)=>r.attemptKey===a.requestId);
 if(!replay){const receipt=b.depositReturnReceipts.find((r:RefundReceipt)=>r.stripeRefundId===a.refundId);if(!receipt||receipt.status!=="failed")throw Error("Only a failed original-card refund can be retried.");const original=await stripe().refunds.retrieve(a.refundId);const pi=typeof original.payment_intent==="string"?original.payment_intent:original.payment_intent?.id;if(!["failed","canceled"].includes(original.status??"")||pi!==receipt.paymentIntentId||original.currency!=="gbp"||original.amount!==receipt.amountPence)throw Error("The original refund is not confirmed failed. No new refund was issued.");}
 await ctx.runMutation(internal.bookings.beginDepositRefundRetry,{bookingId:a.bookingId,refundId:a.refundId,requestId:a.requestId,expectedSnapshot:a.expectedSnapshot});
 const fresh:any=await ctx.runQuery(internal.bookings.getForRefund,{bookingId:a.bookingId,includeControlsSnapshot:true});return resumeDepositDecision(ctx,a.bookingId,fresh);
}});

export const resumeRentalRefund=action({args:{token:v.string(),refundId:v.id("rental_refunds"),confirmed:v.boolean()},handler:async(ctx,a):Promise<any>=>{await ctx.runMutation(internal.adminAuth.assertAdminInternal,{token:a.token,fn:"checkout.resumeRentalRefund"});if(!a.confirmed)throw Error("Confirm resuming the original refund first.");const r:any=await ctx.runQuery(internal.rentalOperations.refundJob,{id:a.refundId});if(!r)throw Error("Refund missing");return ctx.runAction(api.checkout.refundRental,{token:a.token,bookingId:r.bookingId,requestId:r.requestId,amountPence:r.amountPence,reason:r.reason});}});

export const reconcileRentalRefund=internalAction({args:{refundId:v.string()},handler:async(ctx,{refundId}):Promise<any>=>{const refund=await stripe().refunds.retrieve(refundId),id=refund.metadata?.rentalRefundId;if(!id)return {ignored:true};const r:any=await ctx.runQuery(internal.rentalOperations.refundJob,{id:id as any});if(!r)return {ignored:true};const pi=typeof refund.payment_intent==="string"?refund.payment_intent:refund.payment_intent?.id,status=refund.status==="succeeded"?"succeeded":refund.status==="failed"||refund.status==="canceled"?"failed":"pending";if(!pi||refund.currency!=="gbp"||(refund.metadata?.bookingId&&refund.metadata.bookingId!==r.bookingId))throw Error("Rental refund receipt mismatch.");if(r.allocations){const a=r.allocations.find((p:any)=>p.paymentIntentId===pi);if(!a||a.amountPence!==refund.amount||refund.metadata?.rentalPaymentIntent!==pi||refund.metadata?.bookingId!==r.bookingId)throw Error("Rental refund allocation mismatch.");const old=r.refundReceipts?.find((p:any)=>p.paymentIntentId===pi);if(old)await ctx.runMutation(internal.rentalOperations.recordRefundReceipt,{id:r._id,receipt:{...old,stripeRefundId:refund.id,status}});return ctx.runMutation(internal.rentalOperations.recordRefundPart,{id:r._id,paymentIntentId:pi,stripeRefundId:refund.id,status});}if(r.stripeRefundId!==refund.id||r.amountPence!==refund.amount)throw Error("Legacy rental refund receipt mismatch.");return ctx.runMutation(internal.rentalOperations.recordRefund,{id:r._id,stripeRefundId:refund.id,status});}});
