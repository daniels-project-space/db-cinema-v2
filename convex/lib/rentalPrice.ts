"use node";

import Stripe from "stripe";
import { providerRepeatGate } from "./repeatRentalProvider";
import { membershipActiveNow } from "../../shared/membership";
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
  totalDue: number;
  deliveryBenefitMonth?: string;
  deliveryReduction: number;
  securityWaiverReason?: string;
  weekendSaving: number;
  rentalSaving: number;
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
  const member = selected ?? (membershipActiveNow(acct) ? tierByKey(acct.membershipTier) : null);
  const raw: any[] = await ctx.runQuery(internal.catalog.repriceLines, {
    items: a.items.map(i => ({ listingId: i.listingId, start: i.start, end: i.end, offerType: i.offerType })), undiscounted: true,
  });
  const weekendCandidate = member?.weekend ? Math.min(100,raw.reduce((n,r)=>n+(r?.weekendSaving??0),0)) : 0;
  let items: PricedItem[] = a.items.map((it,idx)=>{const r=raw[idx];if(!r)throw Error(`"${it.title}" is no longer available.`);return {...it,title:r.title,total:r.ordinaryTotal??r.total,deposit:r.deposit,dailyRate:r.dailyRate};});
  let subtotal=items.reduce((n,i)=>n+i.total,0);
  const ordinarySubtotal=subtotal;
  const protection = a.protection ?? "verify";
  const replacementSum = items.reduce((n, i) => n + i.deposit, 0);
  const depositHoldAmount = depositFor(protection, replacementSum);
  let repeatSourceBookingId: Id<"bookings"> | undefined;
  let repeatSourceFingerprint: string | undefined;
  if (acct && a.token && !paidDepositExempt(acct) && !(selected && a.selectedMembership?.intro !== "trial") && process.env.STRIPE_SECRET_KEY) {
    const previous: any = await ctx.runQuery(internal.repeatRentals.candidate,{token:a.token,kit:a.items.map(i=>({listingId:i.listingId,qty:i.qty}))});
    if (previous) {
      try { if (await providerRepeatGate(previous.booking,new Stripe(process.env.STRIPE_SECRET_KEY))) {repeatSourceBookingId=previous.booking._id;repeatSourceFingerprint=previous.fingerprint;} }
      catch { /* A provider outage retains the normal security payment, never an unproved waiver. */ }
    }
  }
  const securityWaiverReason = selected && a.selectedMembership?.intro !== "trial" ? "new_paid_membership" : paidDepositExempt(acct) ? "paid_membership" : repeatSourceBookingId ? "safe_repeat_kit" : undefined;
  const depositAmount = securityWaiverReason ? 0 : Math.round(depositHoldAmount * 50) / 100;
  const month = londonMonth();
  const freedCount = 0;
  const discountable = items.filter(i => !i.offerType).reduce((n, i) => n + i.total, 0);
  let promoDiscount = 0;
  let appliedCode: string | undefined;
  if (a.promoCode) {
    const res: any = await ctx.runQuery(api.promo.validate, {
      code: a.promoCode,
      eligibleSubtotal: discountable,
      rentalSubtotal: subtotal,
      tier: acct?.membershipTier ?? undefined,
      membershipActive: membershipActiveNow(acct),
      email: customerEmail,
    });
    if (res?.valid) {
      promoDiscount = res.discount;
      appliedCode = res.code;
    }
  }
  const rawSubtotal=raw.reduce((n,r)=>n+r.total,0);
  const weekendSaving = weekendCandidate>0 && rawSubtotal-weekendCandidate < ordinarySubtotal-promoDiscount ? weekendCandidate : 0;
  const rentalSaving = weekendSaving ? ordinarySubtotal-promoDiscount-(rawSubtotal-weekendSaving) : 0;
  if(weekendSaving){items=items.map((item,idx)=>({...item,total:raw[idx].total}));subtotal=rawSubtotal;appliedCode=undefined;}
  const totalReduction = weekendSaving || promoDiscount;
  const reductionLabel = weekendSaving > 0 ? "Member weekend deal · £100 cap" : appliedCode?.toUpperCase();

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
    ? await ctx.runQuery(internal.membershipBenefits.deliveryAvailable, { accountId: acct._id, month, prospective: selected?.key === "studio" }) : !!(selected?.key === "studio" && isLondon && quotedDeliveryFee > 0 && !acct);
  const deliveryBenefitMonth = studioAvailable ? month : undefined;
  const deliveryFee = studioAvailable ? 0 : Math.round(quotedDeliveryFee * (100 - (member?.deliveryPct ?? 0))) / 100;
  const deliveryReduction = quotedDeliveryFee - deliveryFee;
  const totalBeforeCredit = subtotal + deliveryFee + depositAmount - totalReduction;
  const availableCredit = acct
    ? await ctx.runQuery(internal.bookings.availableCheckoutCredit, { accountId: acct._id }) : 0;
  const creditApplied = Math.min(availableCredit, Math.max(0, totalBeforeCredit - depositAmount));

  return {
    items, customerEmail, acct, month, freedCount, subtotal, replacementSum, protection,
    depositHoldAmount, depositAmount, appliedCode, totalReduction, reductionLabel,
    quotedDeliveryFee, deliveryFee, deliveryBenefitMonth, deliveryReduction, securityWaiverReason, weekendSaving, rentalSaving, repeatSourceBookingId, repeatSourceFingerprint, membershipFee, combinedTotalDue: totalBeforeCredit - creditApplied + membershipFee, totalBeforeCredit, creditApplied, totalDue: totalBeforeCredit - creditApplied,
  };
}
