export const SINGLE_BENEFIT_VERSION = "single-benefit-v1";
export type BenefitKind = "none"|"catalog_offer"|"quiet"|"promo"|"weekend"|"delivery"|"loyalty"|"joining"|"earned_credit"|"referral_friend"|"referral_reward";
export type Benefit = {kind:BenefitKind; savingPence:number; label:string};
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
