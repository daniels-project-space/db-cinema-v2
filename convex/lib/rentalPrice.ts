"use node";

import Stripe from "stripe";
import { bestBenefit, SINGLE_BENEFIT_VERSION, type BenefitKind, loyaltyPercent } from "../../shared/rentalBenefits";
import { providerRepeatGate } from "./repeatRentalProvider";
import { membershipActiveNow } from "../../shared/membership";
import { checkoutMembershipCredit, membershipSignupOffer } from "../../shared/checkoutMembershipCredit";
import type { ActionCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import { api, internal } from "../_generated/api";
import { depositFor } from "./pricing";
import { londonMonth } from "./memberDelivery";
import { tierByKey, paidDepositExempt } from "./membership";

export type RentalPriceInput = {
  items: {
    listingId: Id<"listings">;
    title: string;
    start: number;
    end: number;
    qty: number;
    total: number;
    deposit: number;
    offerType?: string;
  }[];
  token?: string;
  selectedMembership?: { tier: string; intro: "trial" | "credit" | "none" };
  customer: { email: string };
  fulfilment: "pickup" | "delivery";
  address?: string;
  deliveryPostcode?: string;
  deliveryFee?: number;
  promoCode?: string;
  protection?: "verify" | "deposit";
};

type PricedItem = RentalPriceInput["items"][number] & { dailyRate: number };
export type RentalPrice = {
  pricingVersion: string;
  benefitKind: BenefitKind;
  refundCreditApplied: number;
  earnedCreditApplied: number;
  referralCode?: string;
  referralRewardId?: Id<"referral_rewards">;
  items: PricedItem[];
  customerEmail: string;
  acct: any;
  month: string;
  freedCount: number;
  subtotal: number;
  replacementSum: number;
  protection: "verify" | "deposit";
  depositHoldAmount: number;
  depositAmount: number;
  appliedCode?: string;
  totalReduction: number;
  reductionLabel?: string;
  quotedDeliveryFee: number;
  deliveryFee: number;
  totalBeforeCredit: number;
  creditApplied: number;
  membershipCreditApplied: number;
  membershipSignupOfferSaving: number;
  totalDue: number;
  deliveryBenefitMonth?: string;
  deliveryReduction: number;
  securityWaiverReason?: string;
  weekendSaving: number;
  rentalSaving: number;
  loyaltySaving: number;
  repeatSourceBookingId?: Id<"bookings">;
  repeatSourceFingerprint?: string;
  membershipFee: number;
  combinedTotalDue: number;
};

const postcodeFromAddress = (address: string) =>
  address.toUpperCase().match(/\b(?:GIR\s?0AA|[A-Z]{1,2}\d[A-Z\d]?\s?\d[A-Z]{2})\b/)?.[0].replace(/\s/g, "") ?? "";

/** One authoritative calculation for the on-page quote and Stripe checkout. */
export async function calculateRentalPrice(ctx: ActionCtx, a: RentalPriceInput): Promise<RentalPrice> {
  if (!a.items.length || a.items.some((item) => item.qty !== 1 || !Number.isSafeInteger(item.start) ||
      !Number.isSafeInteger(item.end) || item.end < item.start))
    throw new Error("Each rental line must be one item with valid dates. Please refresh your basket.");

  const customerEmail = a.customer.email.trim().toLowerCase();
  const acct: any = a.token ? await ctx.runQuery(internal.accounts._byToken, { token: a.token }) : null;
  if (acct && customerEmail !== acct.email.trim().toLowerCase())
    throw new Error("Use your signed-in account email for this booking, or sign out to book as a guest.");
  if (a.selectedMembership && membershipActiveNow(acct)) throw Error("Manage your existing membership in account settings.");
  const selected = a.selectedMembership ? tierByKey(a.selectedMembership.tier) : undefined;
  if (a.selectedMembership && !selected) throw Error("Unknown membership plan.");
  if (a.selectedMembership && a.selectedMembership.intro !== "none" && acct?.membershipIntroUsed) throw Error("Your introductory offer has already been used.");
  const membershipFee = selected && a.selectedMembership?.intro !== "trial" ? selected.monthlyGbp : 0;
  // A membership added here earns credit now; recurring perks start after this booking.
  const member = !selected && membershipActiveNow(acct) ? tierByKey(acct.membershipTier) : null;
  const raw: any[] = await ctx.runQuery(internal.catalog.repriceLines, {
    items: a.items.map(i => ({ listingId: i.listingId, start: i.start, end: i.end, offerType: i.offerType })), undiscounted: true,
  });
  const weekendCandidate = member?.weekend ? Math.min(100,raw.reduce((n,r)=>n+(r?.weekendSaving??0),0)) : 0;
  const items: PricedItem[] = a.items.map((it,idx)=>{const r=raw[idx];if(!r)throw Error(`"${it.title}" is no longer available.`);return {...it,title:r.title,total:r.total,deposit:r.deposit,dailyRate:r.dailyRate};});
  const subtotal=items.reduce((n,i)=>n+i.total,0);

  const protection = a.protection ?? "verify";
  const replacementSum = items.reduce((n, i) => n + i.deposit, 0);
  const depositHoldAmount = depositFor(protection, replacementSum);
  let repeatSourceBookingId: Id<"bookings"> | undefined;
  let repeatSourceFingerprint: string | undefined;
  if (acct && a.token && !selected && !paidDepositExempt(acct) && process.env.STRIPE_SECRET_KEY) {
    const previous: any = await ctx.runQuery(internal.repeatRentals.candidate,{token:a.token,kit:a.items.map(i=>({listingId:i.listingId,qty:i.qty}))});
    if (previous) {
      try { if (await providerRepeatGate(previous.booking,new Stripe(process.env.STRIPE_SECRET_KEY))) {repeatSourceBookingId=previous.booking._id;repeatSourceFingerprint=previous.fingerprint;} }
      catch { /* A provider outage retains the normal security payment, never an unproved waiver. */ }
    }
  }
  let securityWaiverReason = !selected && paidDepositExempt(acct) ? "paid_membership" : repeatSourceBookingId ? "safe_repeat_kit" : undefined;
  let depositAmount = securityWaiverReason ? 0 : Math.round(depositHoldAmount * 50) / 100;
  const month = londonMonth();
  const freedCount = 0;
  const discountable = items.filter(i => !i.offerType).reduce((n, i) => n + i.total, 0);
  let promoDiscount = 0, promoCode: string | undefined;
  let referral: any = null;
  if (a.promoCode?.trim().toUpperCase().startsWith("DBC-") || acct?.referralRewardGrantedAt)
    referral = await ctx.runQuery(internal.referrals.offers, {accountId:acct?._id, code:a.promoCode?.trim().toUpperCase().startsWith("DBC-") ? a.promoCode : undefined});
  if (a.promoCode?.trim().toUpperCase().startsWith("DBC-") && !referral?.friend?.valid)
    throw Error(referral?.friend?.reason ?? "Sign in or create an account to use a referral code.");
  if (a.promoCode && !a.promoCode.trim().toUpperCase().startsWith("DBC-")) {
    const res: any = await ctx.runQuery(api.promo.validate, {
      code:a.promoCode,eligibleSubtotal:discountable,rentalSubtotal:subtotal,
      tier:acct?.membershipTier ?? undefined,membershipActive:membershipActiveNow(acct),email:customerEmail,token:a.token,
    });
    if (res?.valid) {promoDiscount=res.discount;promoCode=res.code;}
  }
  let quotedDeliveryFee = 0;
  let isLondon = false;
  if (a.fulfilment === "delivery") {
    const postcode = postcodeFromAddress(a.deliveryPostcode ?? "");
    if (!postcode || postcode !== postcodeFromAddress(a.address ?? "") || (a.address ?? "").trim().length < 10)
      throw new Error("Enter the full delivery address with the same postcode used for the quote.");
    const quote: any = await ctx.runAction(api.delivery.quote, {
      postcode, listingIds: items.map((item) => item.listingId),
    });
    if (!quote.ok || !Number.isSafeInteger(quote.fee) || quote.fee < 0)
      throw new Error(quote.ok ? "Delivery is unavailable for this address." : quote.reason);
    quotedDeliveryFee = quote.fee;
    isLondon = quote.isLondon === true;
    if (a.deliveryFee !== undefined && Math.round(a.deliveryFee * 100) !== Math.round(quotedDeliveryFee * 100))
      throw new Error("Your delivery quote has changed. Please refresh it before paying.");
  }
  const studioAvailable = member?.key === "studio" && isLondon && quotedDeliveryFee > 0 && acct
    ? await ctx.runQuery(internal.membershipBenefits.deliveryAvailable, { accountId: acct._id, month, prospective: selected?.key === "studio" }) : false;
  const deliveryCandidate = studioAvailable ? quotedDeliveryFee : Math.round(quotedDeliveryFee * (member?.deliveryPct ?? 0)) / 100;
  const joiningCandidate = membershipSignupOffer(selected?.key,a.selectedMembership?.intro,subtotal+quotedDeliveryFee,!!(acct?.membershipSignupOfferUsed || acct?.starterRentalOfferUsed));
  const refundBalance = acct ? await ctx.runQuery(internal.bookings.availableCheckoutCredit,{accountId:acct._id,kind:"refund"}) : 0;
  const earnedBalance = acct ? await ctx.runQuery(internal.bookings.availableCheckoutCredit,{accountId:acct._id,kind:"earned"}) : 0;
  const refundBefore = Math.min(refundBalance,subtotal+quotedDeliveryFee);
  const existingBefore = Math.min(earnedBalance,Math.max(0,subtotal+quotedDeliveryFee-refundBefore));
  const immediate = checkoutMembershipCredit(selected?.key,a.selectedMembership?.intro,
    Math.round(Math.max(0,subtotal-refundBefore-existingBefore)*100),acct?.membershipCreditDebtPence);
  const pence = (n:number)=>Math.max(0,Math.round(n*100));
  const chosen = bestBenefit([
    {kind:"catalog_offer",savingPence:pence(subtotal-raw.reduce((n,r)=>n+(r.offerTotal??r.ordinaryTotal??r.total),0)),label:"Gear offer"},
    {kind:"quiet",savingPence:pence(subtotal-raw.reduce((n,r)=>n+(r.quietTotal??r.total),0)),label:"Quiet gear saving"},
    {kind:"promo",savingPence:pence(promoDiscount),label:promoCode?.toUpperCase()??"Promo saving"},
    {kind:"weekend",savingPence:pence(weekendCandidate),label:"Member weekend deal · £100 cap"},
    {kind:"delivery",savingPence:pence(deliveryCandidate),label:"Member delivery saving"},
    {kind:"loyalty",savingPence:!selected&&!membershipActiveNow(acct)?pence(subtotal*(acct?.loyaltyPercent??(acct?.loyaltyEligible?loyaltyPercent(3):0))/100):0,label:`Encore · ${acct?.loyaltyPercent??10}% rental saving`},
    {kind:"joining",savingPence:pence(joiningCandidate),label:`Membership welcome · £${joiningCandidate} off`},
    {kind:"earned_credit",savingPence:pence(existingBefore)+immediate.appliedPence,label:"Earned store credit"},
    {kind:"referral_friend",savingPence:referral?.friend?.valid?pence(Math.min(10,subtotal)):0,label:"Friend referral · £10 off your first rental"},
    {kind:"referral_reward",savingPence:referral?.reward?pence(subtotal*.4):0,label:"Referral reward · 40% off rentals"},
  ]);
  const benefitKind=chosen.kind;
  if(benefitKind==="referral_friend"||benefitKind==="referral_reward"){
    securityWaiverReason=undefined;repeatSourceBookingId=undefined;repeatSourceFingerprint=undefined;
    depositAmount=Math.round(depositHoldAmount*50)/100;
  }
  const deliveryReduction=benefitKind==="delivery"?chosen.savingPence/100:0;
  const deliveryFee=quotedDeliveryFee-deliveryReduction;
  const deliveryBenefitMonth=benefitKind==="delivery"&&studioAvailable?month:undefined;
  const totalReduction=["none","delivery","earned_credit"].includes(benefitKind)?0:chosen.savingPence/100;
  const appliedCode=benefitKind==="promo"?promoCode:undefined;
  const weekendSaving=benefitKind==="weekend"?totalReduction:0;
  const loyaltySaving=benefitKind==="loyalty"?totalReduction:0;
  const membershipSignupOfferSaving=benefitKind==="joining"?totalReduction:0;
  const totalBeforeCredit=Math.round((subtotal+deliveryFee+depositAmount-totalReduction)*100)/100;
  const refundCreditApplied=Math.min(refundBalance,Math.max(0,totalBeforeCredit-depositAmount));
  const earnedCreditApplied=benefitKind==="earned_credit"?existingBefore:0;
  const membershipCreditApplied=benefitKind==="earned_credit"?immediate.appliedPence/100:0;
  const creditApplied=Math.round((refundCreditApplied+earnedCreditApplied+membershipCreditApplied)*100)/100;
  const totalDue=Math.round((totalBeforeCredit-creditApplied)*100)/100;
  return {
    pricingVersion:SINGLE_BENEFIT_VERSION,benefitKind,refundCreditApplied,earnedCreditApplied,
    referralCode:benefitKind==="referral_friend"?referral.friend.code:undefined,
    referralRewardId:benefitKind==="referral_reward"?referral.reward.id:undefined,
    items,customerEmail,acct,month,freedCount,subtotal,replacementSum,protection,
    depositHoldAmount,depositAmount,appliedCode,totalReduction,reductionLabel:chosen.kind==="none"?undefined:chosen.label,
    quotedDeliveryFee,deliveryFee,deliveryBenefitMonth,deliveryReduction,securityWaiverReason,weekendSaving,
    rentalSaving:totalReduction,loyaltySaving,membershipSignupOfferSaving,repeatSourceBookingId,repeatSourceFingerprint,
    membershipFee,membershipCreditApplied,combinedTotalDue:Math.round((totalDue+membershipFee)*100)/100,totalBeforeCredit,creditApplied,totalDue,
  };
}
