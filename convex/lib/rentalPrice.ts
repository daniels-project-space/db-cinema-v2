"use node";

import { FIRST_ORDER_VOUCHER_CODE } from "./firstOrderVoucher";
import { bestBenefit, memberRentalBenefitCandidates, membershipDeliveryBenefit, CREDIT_FUNDING_VERSION, type BenefitKind } from "../../shared/rentalBenefits";
import { membershipActiveNow, membershipRentalBenefitsActiveNow, membershipTierFor } from "../../shared/membership";
import { checkoutMembershipCredit, membershipSignupOffer } from "../../shared/checkoutMembershipCredit";
import type { ActionCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import { api, internal } from "../_generated/api";
import { depositFor, depositChargeFor } from "./pricing";
import { ASSESSMENT_SECURITY_POLICY_VERSION, assessmentDepositFor, cardHoldFor, cardLimitForPolicy, CARD_HOLD_SECURITY_POLICY_VERSION, SECURITY_POLICY_VERSION, REFUNDABLE_DEPOSIT_POLICY_VERSION, refundableDepositFor, savedCardChargeLimit, IMMEDIATE_CLAIM_SECURITY_POLICY_VERSION } from "../../shared/rentalSecurity";
import { londonMonth } from "./memberDelivery";
import { tierByKey } from "./membership";
import { groupDeliveryItems } from "../../shared/deliveryGroups";
import { CHECKOUT_ACCESSORY_OFFER, checkoutAccessoryTotals, validateCheckoutAccessoryOfferSet } from "../../shared/checkoutAccessoryOffer";
import { checkoutLineAllocation } from "../../shared/checkoutLineAllocation";
import { checkoutAccessoryLineAllocation } from "../../shared/checkoutAccessoryAllocation";
import { sameDayRentalFeePence } from "../../shared/sameDayRentalFee";
import type { EffectiveComponentAllocation } from "../../shared/componentReplacement";
import { agreementRequestFingerprint } from "../../shared/rentalAgreement";
import { replacementCatalogFingerprint } from "../../shared/componentReplacementStockFingerprint";
import { replacementMembershipFingerprint } from "../../shared/componentReplacementMembership";
import { normalizeRentalLineTimes } from "../../shared/rentalLineTimes";

export type RentalPriceInput = {
  items: {
    listingId: Id<"listings">;
    title: string;
    start: number;
    end: number;
    pickupTime?: string;
    returnTime?: string;
    qty: number;
    total: number;
    deposit: number;
    offerType?: string;
    componentReplacement?: { originalMasterItemId: string; replacementMasterItemId: string };
  }[];
  token?: string;
  useAccountCredit?:boolean;
  selectedMembership?: { tier: string; intro: "trial" | "credit" | "none" };
  customer: { email: string; name?: string; billingAddress?: string };
  fulfilment: "pickup" | "delivery";
  deliveryLegs?: "one_way" | "round_trip";
  address?: string;
  deliveryPostcode?: string;
  pickupTime?: string;
  returnTime?: string;
  deliveryFee?: number;
  promoCode?: string;
  protection?: "verify" | "deposit";
};

export function normalizeReplacementRentalTimes<T extends RentalPriceInput>(input: T): T {
  if (!input.items.some(item => item.componentReplacement)) return input;
  return { ...input, items: normalizeRentalLineTimes(input.items, input) };
}

type PricedItem = RentalPriceInput["items"][number] & { dailyRate: number; resolvedComponentAllocation?: EffectiveComponentAllocation; resolvedComponentNames?: {original:string;replacement:string}; resolvedDeliverySpec?: {sizeScore:number;weightKg:number;itemType:string} | null; resolvedPhysicalDemands?: { inventoryUnitId: Id<"inventory_units">; start: number; end: number; pickupTime?: string; returnTime?: string; qty: number }[]; accessoryOffer?: { percent: number; originalTotal: number; saving: number } };
export type RentalPrice = {
  componentReplacementPricingEvidence?: { version: 1; fingerprint: string };
  componentReplacementCatalogFingerprint?: string;
  componentReplacementCreditBalances?: { refundPence: number; earnedPence: number };
  componentReplacementMembershipFingerprint?: string;
  componentReplacementStudioCheck?: { month: string; available: boolean };
  componentReplacementDeliverySettings?: { marginPct: number; maxKm: number };
  securityPolicyVersion: string;
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
  savedCardLimit: number;
  protection: "verify" | "deposit";
  depositHoldAmount: number;
  depositAmount: number;
  appliedCode?: string;
  totalReduction: number;
  accessoryOfferDiscount: number;
  reductionLabel?: string;
  quotedDeliveryFee: number;
  deliveryFee: number;
  sameDayFee: number;
  deliveryGroups: Array<{ start:number;end:number;quotedFee:number;fee:number;oneWay:number;vehicle:string;vehicleLabel:string;km:number;load:number }>;
  totalBeforeCredit: number;
  creditApplied: number;
  availableAccountCredit:number;
  creditUseSelected:boolean;
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

function allocateDeliveryGroupFees(groups: RentalPrice["deliveryGroups"], totalNetFee: number) {
  let remainingGrossPence=groups.reduce((sum,group)=>sum+Math.round(group.quotedFee*100),0);
  let remainingNetPence=Math.round(totalNetFee*100);
  return groups.map((group,index)=>{
    const grossPence=Math.round(group.quotedFee*100);
    const netPence=index===groups.length-1?remainingNetPence:remainingGrossPence?Math.min(grossPence,Math.round(remainingNetPence*grossPence/remainingGrossPence)):0;
    remainingGrossPence-=grossPence;
    remainingNetPence-=netPence;
    return {...group,fee:netPence/100};
  });
}

/** One authoritative calculation for the on-page quote and Stripe checkout. */
export async function calculateRentalPrice(ctx: ActionCtx, a: RentalPriceInput): Promise<RentalPrice> {
  a = normalizeReplacementRentalTimes(a);
  if (!a.items.length || a.items.some((item) => item.qty !== 1 || !Number.isSafeInteger(item.start) ||
      !Number.isSafeInteger(item.end) || item.end < item.start))
    throw new Error("Each rental line must be one item with valid dates. Please refresh your basket.");

  const customerEmail = a.customer.email.trim().toLowerCase();
  const acct: any = a.token ? await ctx.runQuery(internal.accounts._byToken, { token: a.token }) : null;
  if (acct && customerEmail !== acct.email.trim().toLowerCase())
    throw new Error("Use your signed-in account email for this booking, or sign out to book as a guest.");
  const emailAccount: any = customerEmail ? await ctx.runQuery(internal.accounts._byEmail, {email: customerEmail}) : null;
  if (emailAccount?.blockedAt != null) throw Error("This account is blocked. Contact DB Cinema Rentals.");
  if (a.selectedMembership && membershipActiveNow(acct)) throw Error("Manage your existing membership in account settings.");
  const selected = a.selectedMembership ? tierByKey(a.selectedMembership.tier) : undefined;
  if (a.selectedMembership && !selected) throw Error("Unknown membership plan.");
  if (a.selectedMembership && a.selectedMembership.intro !== "none" && acct?.membershipIntroUsed) throw Error("Your introductory offer has already been used.");
  const membershipFee = selected && a.selectedMembership?.intro !== "trial" ? selected.monthlyGbp : 0;
  // A membership added here earns credit now; recurring perks start after this booking.
  const member = !selected && membershipRentalBenefitsActiveNow(acct) ? tierByKey(membershipTierFor(acct)) : null;
  const raw: any[] = await ctx.runQuery(internal.catalog.repriceLines, {
    items: a.items.map(i => ({ listingId: i.listingId, start: i.start, end: i.end, pickupTime: i.pickupTime, returnTime: i.returnTime, offerType: i.offerType })),
  });
  const canonical=raw.map((row:any,index:number)=>{
    if(!row)throw Error(`"${a.items[index].title}" is no longer available.`);
    return {...row,_id:String(a.items[index].listingId),listingId:String(a.items[index].listingId)};
  });
  const replacementIndexes = a.items.flatMap((item, index) => item.componentReplacement ? [index] : []);
  if (replacementIndexes.length > 1) throw Error("This replacement basket needs a fresh stock check.");
  if (replacementIndexes.length && a.items.some(item => item.offerType === CHECKOUT_ACCESSORY_OFFER))
    throw Error("This replacement quote is not available for accessory offers yet.");
  let replacementDeliverySpec: {sizeScore:number;weightKg:number;itemType:string} | undefined;
  if (replacementIndexes.length) {
    const index = replacementIndexes[0], line = a.items[index], selection = line.componentReplacement!;
    const resolved: any = await ctx.runQuery((internal as any).componentReplacementPreview.resolveForPricing, {
      listingId: line.listingId, ...selection, start: line.start, end: line.end, quantity: line.qty,
      ...(line.pickupTime ? { pickupTime: line.pickupTime } : {}), ...(line.returnTime ? { returnTime: line.returnTime } : {}),
      otherItems: a.items.filter((_, otherIndex) => otherIndex !== index).map(item => ({ listingId: item.listingId, start: item.start, end: item.end, qty: item.qty, ...(item.pickupTime ? { pickupTime: item.pickupTime } : {}), ...(item.returnTime ? { returnTime: item.returnTime } : {}) })),
    });
    if (!resolved?.kitStockAvailable || !resolved.providedBasketStockAvailable || !resolved.allocation || Math.round(canonical[index].total * 100) !== resolved.basePricePence)
      throw Error("The replacement or basket stock changed. Review it again.");
    const totalPence = resolved.basePricePence + resolved.allocation.priceAdjustmentPence;
    if (!Number.isSafeInteger(totalPence) || totalPence < 0 || !Number.isSafeInteger(resolved.allocation.replacementValuePence))
      throw Error("The replacement price or value needs a fresh check.");
    canonical[index] = { ...canonical[index], total: totalPence / 100, deposit: resolved.allocation.replacementValuePence / 100, resolvedComponentAllocation: resolved.allocation, resolvedComponentNames: resolved.componentNames, resolvedPhysicalDemands: resolved.physicalDemands, resolvedDeliverySpec: resolved.deliverySpec };
    if (a.fulfilment === "delivery") {
      if (!resolved.deliverySpec) throw Error("The replacement delivery dimensions need review.");
      replacementDeliverySpec = resolved.deliverySpec;
    }
  }
  const offerIndexes=a.items.flatMap((item,index)=>item.offerType===CHECKOUT_ACCESSORY_OFFER?[index]:[]);
  const compatibilityEvidence=offerIndexes.length?await ctx.runQuery(api.catalog.compatibilityKits,{}):[];
  const accessoryOffer=validateCheckoutAccessoryOfferSet(a.items,canonical,compatibilityEvidence);
  if (offerIndexes.length) {
    const availability=await ctx.runQuery(api.availability.forCart,{items:a.items.map(item=>({listingId:item.listingId,start:item.start,end:item.end,qty:item.qty,pickupTime:item.pickupTime,returnTime:item.returnTime}))});
    if (offerIndexes.some(index=>availability[String(a.items[index].listingId)]?.ok!==true))
      throw Error("A checkout accessory offer is no longer available. Refresh your basket or remove it to continue.");
  }
  const items: PricedItem[] = a.items.map((it,idx)=>{
    const r=canonical[idx],saving=accessoryOffer.savings.get(idx)??0;
    const accessoryOfferDetails=saving>0?{percent:accessoryOffer.percent!,originalTotal:r.total,saving}:undefined;
    const { resolvedComponentAllocation: _untrustedAllocation, resolvedComponentNames: _untrustedNames, resolvedPhysicalDemands: _untrustedDemands, resolvedDeliverySpec: _untrustedDelivery, ...safeItem } = it as typeof it & { resolvedComponentAllocation?: unknown; resolvedComponentNames?: unknown; resolvedPhysicalDemands?: unknown; resolvedDeliverySpec?: unknown };
    return {...safeItem,title:r.title,total:saving>0?checkoutAccessoryTotals(r.total,accessoryOffer.percent!).total:r.total,
      deposit:r.deposit,dailyRate:r.dailyRate,...(r.resolvedComponentAllocation?{resolvedComponentAllocation:r.resolvedComponentAllocation,resolvedComponentNames:r.resolvedComponentNames,resolvedPhysicalDemands:r.resolvedPhysicalDemands,resolvedDeliverySpec:r.resolvedDeliverySpec}:{}),...(accessoryOfferDetails?{accessoryOffer:accessoryOfferDetails}:{})};
  });
  const subtotal=items.reduce((n,i)=>n+i.total,0);
  const discountableSubtotal=accessoryOffer.baseSubtotal;
  const accessoryOfferDiscount=Math.round([...accessoryOffer.savings.values()].reduce((sum,saving)=>sum+saving,0)*100)/100;

  const protection = a.protection ?? "verify";
  const replacementSum = items.reduce((n, i) => n + Math.round(i.deposit*100), 0)/100;
  // Only enable after checkout, immutable terms and both admin surfaces qualify.
  const setupIntentPolicy=process.env.SETUP_INTENT_SECURITY_POLICY_ENABLED==="true";
  const cardHoldPolicy=!setupIntentPolicy&&process.env.CARD_HOLD_SECURITY_POLICY_ENABLED==="true";
  const assessmentPolicy=!setupIntentPolicy&&!cardHoldPolicy&&process.env.ASSESSMENT_SECURITY_POLICY_ENABLED==="true";
  const refundablePolicy = !setupIntentPolicy&&!cardHoldPolicy&&(assessmentPolicy || process.env.REFUNDABLE_DEPOSIT_POLICY_ENABLED === "true");
  const securityPolicyVersion = setupIntentPolicy?IMMEDIATE_CLAIM_SECURITY_POLICY_VERSION:cardHoldPolicy?CARD_HOLD_SECURITY_POLICY_VERSION:assessmentPolicy?ASSESSMENT_SECURITY_POLICY_VERSION:refundablePolicy ? REFUNDABLE_DEPOSIT_POLICY_VERSION : SECURITY_POLICY_VERSION;
  const cashDeposit = setupIntentPolicy||cardHoldPolicy?0:assessmentPolicy?assessmentDepositFor(replacementSum):refundablePolicy ? refundableDepositFor(replacementSum) : depositChargeFor(protection, replacementSum);
  let depositHoldAmount = setupIntentPolicy?0:cardHoldPolicy?cardHoldFor(replacementSum):refundablePolicy ? 0 : depositFor(protection, replacementSum);
  let repeatSourceBookingId: Id<"bookings"> | undefined;
  let repeatSourceFingerprint: string | undefined;
  let securityWaiverReason: string | undefined;
  if (!selected && acct && (cardHoldPolicy || assessmentPolicy || (!refundablePolicy && cashDeposit > 0))) {
    securityWaiverReason = (await ctx.runQuery(internal.bookings.depositWaiverEligibility, {
      accountId: acct._id,
      replacementValuePence: Math.round(replacementSum * 100),
      starts: a.items.map(item => item.start),
      agreementName: a.customer.name,
      billingAddress: a.customer.billingAddress,
    })) ?? undefined;
  }
  if(cardHoldPolicy&&securityWaiverReason)depositHoldAmount=0;
  let depositAmount = securityWaiverReason ? 0 : cashDeposit;
  const month = londonMonth();
  const freedCount = 0;
  const discountable = discountableSubtotal;
  let promoDiscount = 0, promoCode: string | undefined;
  let referral: any = null;
  if (a.promoCode?.trim().toUpperCase().startsWith("DBC-") || acct?.referralRewardGrantedAt)
    referral = await ctx.runQuery(internal.referrals.offers, {accountId:acct?._id, code:a.promoCode?.trim().toUpperCase().startsWith("DBC-") ? a.promoCode : undefined});
  if (a.promoCode?.trim().toUpperCase().startsWith("DBC-") && !referral?.friend?.valid)
    throw Error(referral?.friend?.reason ?? "Sign in or create an account to use a referral code.");
  if (a.promoCode && !a.promoCode.trim().toUpperCase().startsWith("DBC-")) {
    const res: any = await ctx.runQuery(api.promo.validate, {
      code:a.promoCode,eligibleSubtotal:discountable,rentalSubtotal:discountableSubtotal,
      tier:membershipTierFor(acct),membershipActive:membershipActiveNow(acct),email:customerEmail,token:a.token,
    });
    if (res?.valid) {promoDiscount=res.discount;promoCode=res.code;}
    else if (a.promoCode.trim().toLowerCase() === FIRST_ORDER_VOUCHER_CODE) throw Error(res?.reason ?? "Your first-order voucher is not available.");
  }
  let quotedDeliveryFee = 0;
  let isLondon = false;
  let replacementDeliverySettings: {marginPct:number;maxKm:number} | undefined;
  let deliveryGroups: RentalPrice["deliveryGroups"] = [];
  if (a.fulfilment === "delivery") {
    const postcode = postcodeFromAddress(a.deliveryPostcode ?? "");
    if (!postcode || postcode !== postcodeFromAddress(a.address ?? "") || (a.address ?? "").trim().length < 10)
      throw new Error("Enter the full delivery address with the same postcode used for the quote.");
    const groups=groupDeliveryItems(items);
    const deliveryLegs = a.deliveryLegs ?? "round_trip";
    const index = replacementIndexes[0];
    const replacementLine = index === undefined ? undefined : items[index];
    const groupIndex = replacementLine ? groups.findIndex(group => group.start === replacementLine.start && group.end === replacementLine.end) : -1;
    const itemIndex = replacementLine ? items.slice(0, index).filter(item => item.start === replacementLine.start && item.end === replacementLine.end).length : -1;
    if (replacementDeliverySpec && (groupIndex < 0 || itemIndex < 0)) throw Error("The replacement delivery group changed. Review it again.");
    const quote = replacementDeliverySpec
      ? await ctx.runAction(internal.delivery.quoteResolved, { postcode, groups, deliveryLegs, overrides: [{ groupIndex, itemIndex, ...replacementDeliverySpec }] })
      : await ctx.runAction(api.delivery.quote, { postcode, groups, deliveryLegs });
    if (!quote.ok || !Number.isSafeInteger(quote.fee) || quote.fee < 0)
      throw new Error(quote.ok ? "Delivery is unavailable for this address." : quote.reason);
    quotedDeliveryFee = quote.fee;
    if (replacementIndexes.length) replacementDeliverySettings = quote.pricingSettings;
    isLondon = quote.isLondon === true;
    deliveryGroups=quote.groups.map(group=>({...group,quotedFee:group.fee}));
    if (a.deliveryFee !== undefined && Math.round(a.deliveryFee * 100) !== Math.round(quotedDeliveryFee * 100))
      throw new Error("Your delivery quote has changed. Please refresh it before paying.");
  }
  const pence = (n:number)=>Math.max(0,Math.round(n*100));
  const studioAvailable = member?.key === "studio" && isLondon && quotedDeliveryFee > 0 && acct
    ? await ctx.runQuery(internal.membershipBenefits.deliveryAvailable, { accountId: acct._id, month, prospective: selected?.key === "studio" }) : false;
  const deliveryBenefit = membershipDeliveryBenefit(acct, pence(quotedDeliveryFee), studioAvailable);
  const deliveryCandidate = deliveryBenefit.discountPence / 100;
  const joiningCandidate = membershipSignupOffer(selected?.key,a.selectedMembership?.intro,discountableSubtotal+quotedDeliveryFee,!!(acct?.membershipSignupOfferUsed || acct?.starterRentalOfferUsed));
  const availableRefundBalance = acct ? await ctx.runQuery(internal.bookings.availableCheckoutCredit,{accountId:acct._id,kind:"refund"}) : 0;
  const availableEarnedBalance = acct ? await ctx.runQuery(internal.bookings.availableCheckoutCredit,{accountId:acct._id,kind:"earned"}) : 0;
  const creditUseSelected=a.useAccountCredit!==false;
  const refundBalance=creditUseSelected?availableRefundBalance:0,earnedBalance=creditUseSelected?availableEarnedBalance:0;
  const availableAccountCredit=Math.round((availableRefundBalance+availableEarnedBalance)*100)/100;
  const memberBenefitCandidates=memberRentalBenefitCandidates({
    account:acct,
    subtotalPence:pence(discountableSubtotal),
    weekendSavingPence:pence(raw.reduce((n,r,index)=>n+(offerIndexes.includes(index)?0:r?.weekendSaving??0),0)),
    includeLoyalty:true,
  });
  const chosen = bestBenefit([
    {kind:"promo",savingPence:pence(promoDiscount),label:promoCode?.toUpperCase()??"Promo saving"},
    ...memberBenefitCandidates,
    {kind:"delivery",savingPence:pence(deliveryCandidate),label:"Member delivery saving"},
    {kind:"referral_friend",savingPence:referral?.friend?.valid?pence(Math.min(10,discountableSubtotal)):0,label:"Friend referral · £10 off your first rental"},
    {kind:"referral_reward",savingPence:referral?.reward?pence(discountableSubtotal*.4):0,label:"Referral reward · 40% off rentals"},
  ]);
  const primaryReduction=["none","delivery","earned_credit"].includes(chosen.kind)?0:chosen.savingPence/100;
  // The one-time joining credit is the sole stacking exception. It can only
  // reduce rental charges, never the membership fee or refundable security.
  const membershipSignupOfferSaving=chosen.kind === "promo" && promoCode === FIRST_ORDER_VOUCHER_CODE
    ? 0 : Math.min(joiningCandidate,Math.max(0,discountableSubtotal-primaryReduction));
  const benefitKind=chosen.kind==="none"&&membershipSignupOfferSaving>0?"joining":chosen.kind;
  if(!assessmentPolicy&&(benefitKind==="referral_friend"||benefitKind==="referral_reward")){
    securityWaiverReason=undefined;repeatSourceBookingId=undefined;repeatSourceFingerprint=undefined;
    depositAmount=cashDeposit;
  }
  const deliveryReduction=benefitKind==="delivery"?chosen.savingPence/100:0;
  const deliveryFee=quotedDeliveryFee-deliveryReduction;
  deliveryGroups=allocateDeliveryGroupFees(deliveryGroups,deliveryFee);
  const deliveryBenefitMonth=benefitKind==="delivery"&&studioAvailable?month:undefined;
  const totalReduction=Math.round((primaryReduction+membershipSignupOfferSaving)*100)/100;
  const checkoutAccessories=items.flatMap((item,index)=>item.offerType===CHECKOUT_ACCESSORY_OFFER?[index]:[]);
  const discountedRentalLines=checkoutAccessories.length
    ?checkoutAccessoryLineAllocation(items.map(item=>item.total),checkoutAccessories,[],totalReduction,0,0)
    :checkoutLineAllocation(items.map(item=>item.total),[],totalReduction,0,0);
  const sameDayFee=sameDayRentalFeePence(items.map((item,index)=>({
    pickupAt:item.start,
    discountedEquipmentAmount:discountedRentalLines[index].gross-discountedRentalLines[index].discount,
  })),Date.now())/100;
  const discountedRentalSpend=Math.max(0,subtotal+deliveryFee+sameDayFee-totalReduction);
  const refundBefore=Math.min(refundBalance,discountedRentalSpend);
  const existingBefore=Math.min(earnedBalance,Math.max(0,discountedRentalSpend-refundBefore));
  const appliedCode=benefitKind==="promo"?promoCode:undefined;
  const weekendSaving=benefitKind==="weekend"?primaryReduction:0;
  const loyaltySaving=benefitKind==="loyalty"?primaryReduction:0;
  const totalBeforeCredit=Math.round((subtotal+deliveryFee+sameDayFee+depositAmount-totalReduction)*100)/100;
  const eligibleCreditPence=Math.max(0,pence(totalBeforeCredit)-pence(depositAmount));
  const refundCreditPence=Math.min(pence(refundBalance),eligibleCreditPence);
  const earnedCreditPence=Math.min(pence(existingBefore),eligibleCreditPence-refundCreditPence);
  const refundCreditApplied=refundCreditPence/100;
  const earnedCreditApplied=earnedCreditPence/100;
  const membershipCreditApplied=checkoutMembershipCredit(selected?.key,a.selectedMembership?.intro,
    pence(Math.max(0,subtotal-totalReduction-refundCreditApplied-earnedCreditApplied)),acct?.membershipCreditDebtPence).appliedPence/100;
  const creditApplied=Math.round((refundCreditApplied+earnedCreditApplied+membershipCreditApplied)*100)/100;
  const totalDue=Math.round((totalBeforeCredit-creditApplied)*100)/100;
  const componentReplacementPricingEvidence = replacementIndexes.length ? {
    version: 1 as const,
    fingerprint: agreementRequestFingerprint({
      version: 1, owner: { accountId: acct?._id ?? null, email: customerEmail },
      customer: { name: a.customer.name ?? null, billingAddress: a.customer.billingAddress ?? null },
      fulfilment: a.fulfilment, deliveryLegs: a.deliveryLegs ?? null, address: a.address ?? null, deliveryPostcode: a.deliveryPostcode ?? null, pickupTime: a.pickupTime ?? null, returnTime: a.returnTime ?? null,
      selectedMembership: a.selectedMembership ?? null, useAccountCredit: a.useAccountCredit ?? true, requestedPromoCode: a.promoCode ?? null,
      protection, pricingVersion: CREDIT_FUNDING_VERSION, securityPolicyVersion, benefitKind, month, freedCount,
      items: items.map(item => ({ listingId: item.listingId, start: item.start, end: item.end, qty: item.qty, pickupTime: item.pickupTime ?? null,
        returnTime: item.returnTime ?? null, total: item.total, deposit: item.deposit, offerType: item.offerType ?? null,
        allocation: item.resolvedComponentAllocation ?? null, physicalDemands: item.resolvedPhysicalDemands ?? null })),
      amounts: { subtotal, replacementSum, savedCardLimit: cardLimitForPolicy(securityPolicyVersion,replacementSum), depositHoldAmount, depositAmount, totalReduction, quotedDeliveryFee, deliveryFee, sameDayFee,
        deliveryGroups, deliveryBenefitMonth: deliveryBenefitMonth ?? null, refundCreditApplied, earnedCreditApplied, membershipCreditApplied, membershipSignupOfferSaving, membershipFee, totalDue },
      appliedCode: appliedCode ?? null, referralCode: benefitKind === "referral_friend" ? referral.friend.code : null,
      referralRewardId: benefitKind === "referral_reward" ? referral.reward.id : null,
      securityWaiverReason: securityWaiverReason ?? null, repeatSourceBookingId: repeatSourceBookingId ?? null, repeatSourceFingerprint: repeatSourceFingerprint ?? null,
    }),
  } : undefined;
  return {
    ...(componentReplacementPricingEvidence ? { componentReplacementPricingEvidence } : {}),
    ...(componentReplacementPricingEvidence ? { componentReplacementCatalogFingerprint: replacementCatalogFingerprint(a.items.map(item => ({ listingId: item.listingId, start: item.start, end: item.end, ...(item.pickupTime ? { pickupTime: item.pickupTime } : {}), ...(item.returnTime ? { returnTime: item.returnTime } : {}) })), raw) } : {}),
    ...(componentReplacementPricingEvidence ? { componentReplacementCreditBalances: { refundPence: pence(availableRefundBalance), earnedPence: pence(availableEarnedBalance) } } : {}),
    ...(componentReplacementPricingEvidence ? { componentReplacementMembershipFingerprint: replacementMembershipFingerprint(acct) } : {}),
    ...(componentReplacementPricingEvidence && member?.key === "studio" && isLondon && quotedDeliveryFee > 0 && acct ? { componentReplacementStudioCheck: { month, available: studioAvailable } } : {}),
    ...(componentReplacementPricingEvidence && replacementDeliverySettings ? { componentReplacementDeliverySettings: replacementDeliverySettings } : {}),
    pricingVersion:CREDIT_FUNDING_VERSION,benefitKind,refundCreditApplied,earnedCreditApplied,availableAccountCredit,creditUseSelected,
    referralCode:benefitKind==="referral_friend"?referral.friend.code:undefined,
    referralRewardId:benefitKind==="referral_reward"?referral.reward.id:undefined,
    items,customerEmail,acct,month,freedCount,subtotal,replacementSum,protection,savedCardLimit:cardLimitForPolicy(securityPolicyVersion,replacementSum),
    securityPolicyVersion,depositHoldAmount,depositAmount,appliedCode,totalReduction,accessoryOfferDiscount,reductionLabel:chosen.kind==="none"?undefined:chosen.label,
    quotedDeliveryFee,deliveryFee,sameDayFee,deliveryGroups,deliveryBenefitMonth,deliveryReduction,securityWaiverReason,weekendSaving,
    rentalSaving:totalReduction,loyaltySaving,membershipSignupOfferSaving,repeatSourceBookingId,repeatSourceFingerprint,
    membershipFee,membershipCreditApplied,combinedTotalDue:Math.round((totalDue+membershipFee)*100)/100,totalBeforeCredit,creditApplied,totalDue,
  };
}
