import { hasFirstEligibleRentalConfirmation, membershipRentalBenefitsActiveNow, membershipTierFor, tierByKey } from "./membership";
import { deliveryDiscountPence } from "./rentalDeliveryQuote";

export const SINGLE_BENEFIT_VERSION = "single-benefit-v1";
export const CREDIT_FUNDING_VERSION = "credit-funding-v2";
export type BenefitKind = "none"|"catalog_offer"|"quiet"|"promo"|"weekend"|"delivery"|"loyalty"|"joining"|"earned_credit"|"referral_friend"|"referral_reward";
export type Benefit = {kind:BenefitKind; savingPence:number; label:string};
export function memberRentalBenefitCandidates(input:{account:any;subtotalPence:number;weekendSavingPence:number;includeLoyalty?:boolean}) {
  const {account,subtotalPence,weekendSavingPence}=input;
  const active=membershipRentalBenefitsActiveNow(account);
  const tier=active?tierByKey(membershipTierFor(account)):undefined;
  const assignedLevel=account?.adminEncoreLevel ?? (account?.loyaltyAdminAssigned===true ? account?.loyaltyLevel : undefined);
  const validAssignedLevel=[1,2,3].includes(assignedLevel) ? assignedLevel : undefined;
  const assignedPercent=validAssignedLevel!==undefined&&account?.loyaltyEligible===true ? loyaltyPercent(validAssignedLevel) : 0;
  const earnedPercent=hasFirstEligibleRentalConfirmation(account)&&account?.loyaltyEligible===true&&Number.isFinite(account?.loyaltyPercent)
    ? account.loyaltyPercent
    : 0;
  const encorePercent=input.includeLoyalty!==false&&account?.blockedAt==null
    ? validAssignedLevel!==undefined ? assignedPercent : earnedPercent
    : 0;
  return [
    {kind:"weekend" as const,savingPence:tier?.weekend?Math.min(10000,Math.max(0,weekendSavingPence)):0,label:"Member weekend deal · £100 cap"},
    {kind:"loyalty" as const,savingPence:encorePercent>0?Math.min(Math.max(0,subtotalPence),Math.round(subtotalPence*Math.min(encorePercent,100)/100)):0,label:`Encore · ${encorePercent}% rental saving`},
  ];
}
/** Canonical delivery entitlement shared by checkout and chat-created quotes. */
export function membershipDeliveryBenefit(account:any, amountPence:number, studioMonthlyAvailable=false) {
  if (!Number.isSafeInteger(amountPence) || amountPence < 0) throw Error("Delivery amount is invalid.");
  const tier=membershipRentalBenefitsActiveNow(account)?tierByKey(membershipTierFor(account)):undefined;
  const isStudioBenefit=tier?.key==="studio"&&studioMonthlyAvailable&&amountPence>0;
  const discountPence=deliveryDiscountPence(amountPence,isStudioBenefit?100:tier?.deliveryPct??0);
  return {membershipTier:tier?.key,discountPence,isStudioBenefit};
}
/** Exactly one price benefit, independent of client totals or input order. */
export function bestBenefit(candidates: Benefit[]): Benefit {
  return candidates.filter(x=>Number.isSafeInteger(x.savingPence)&&x.savingPence>0)
    .sort((a,b)=>b.savingPence-a.savingPence || a.kind.localeCompare(b.kind))[0]
    ?? {kind:"none",savingPence:0,label:"Standard rental price"};
}
export function loyaltyLevel(completed:number){return Math.min(3,Math.max(0,Math.floor(completed)));}
export function loyaltyPercent(level:number){return [0,2,4,10][loyaltyLevel(level)];}
export function threeMonthsAfter(time:number){
  const d=new Date(time), day=d.getUTCDate();d.setUTCDate(1);d.setUTCMonth(d.getUTCMonth()+3);
  const max=new Date(Date.UTC(d.getUTCFullYear(),d.getUTCMonth()+1,0)).getUTCDate();d.setUTCDate(Math.min(day,max));return d.getTime();
}
export function referralCodeFor(id:string,salt=0){
  let a=2166136261,b=2246822519;
  for(const c of `${id}:${salt}`){a=Math.imul(a^c.charCodeAt(0),16777619);b=Math.imul(b^c.charCodeAt(0),3266489917);}
  return `DBC-${(a>>>0).toString(36).padStart(7,"0")}${(b>>>0).toString(36).padStart(7,"0")}`.toUpperCase();
}
