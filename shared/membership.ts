/** One product contract for website, pricing and Stripe billing. Keep legacy
 * `plus` IDs so existing subscriptions/accounts retain their identity. */
export type MemberTier={key:string;name:string;monthlyGbp:number;monthlyCredit:number;creditBonusPct:number;deliveryPct:number;weekend:boolean;filmFund:boolean;pct:number;freeDelivery:boolean;freeAccessories:number;exclusiveOffers:boolean;perks:string[]};
const tier=(key:string,name:string,monthlyGbp:number,deliveryPct:number,weekend:boolean,filmFund:boolean):MemberTier=>({
 key,name,monthlyGbp,creditBonusPct:key==="plus"?10:key==="pro"?20:30,monthlyCredit:Math.round(monthlyGbp*(key==="plus"?110:key==="pro"?120:130))/100,deliveryPct,weekend,filmFund,pct:0,freeDelivery:false,freeAccessories:0,exclusiveOffers:false,
 perks:[`£${(Math.round(monthlyGbp*(key==="plus"?110:key==="pro"?120:130))/100).toFixed(2)} rental credit each paid month`,"Credits stack · valid for one year","Use first-month credit in your rental checkout","Future rentals: no upfront security · full card hold remains",...(key==="studio"?["One London delivery included each calendar month"]:[`${deliveryPct}% off delivery`]),...(weekend?["Weekend 2-for-1 / 3-for-2 · save up to £100 per rental"]:[]),...(filmFund?["Film Fund application entry included"]:["Film Fund entry available for £15 per project"])]
});
export const TIERS=[tier("plus","Starter",19,10,false,false),tier("pro","Pro",49,30,true,true),tier("studio","Studio",99,0,true,true)];
export const tierByKey=(key?:string|null)=>TIERS.find(t=>t.key===key);
export const tierPct=(_key?:string|null)=>0;
export const FREE_ACCESSORY_TYPES:string[]=[];
export const TIER_RANK:Record<string,number>={plus:1,pro:2,studio:3};
export const isProPlus=(key?:string|null,active?:boolean)=>!!active&&(TIER_RANK[key??""]??0)>=2;
export const BENEFITS:{label:string;get:(t:MemberTier)=>boolean|string}[]=[
 {label:"Monthly rental credit (plan bonus)",get:t=>`£${t.monthlyCredit.toFixed(2)}`},
 {label:"No upfront security on future rentals",get:()=>true},
 {label:"Separate card hold remains",get:()=>true},
 {label:"Delivery benefit",get:t=>t.key==="studio"?"1 London delivery / month":`${t.deliveryPct}% off`},
 {label:"Weekend deals · £100 saving cap",get:t=>t.weekend},
 {label:"Film Fund application entry",get:t=>t.filmFund?"Included":"£15 / project"},
 {label:"Credits stack and last one year",get:()=>true},
];
export type IntroOffer="trial"|"credit"|"none";
export function exactKitKey(lines:{listingId:string;qty:number}[]){const counts=new Map<string,number>();for(const l of lines)counts.set(String(l.listingId),(counts.get(String(l.listingId))??0)+l.qty);return JSON.stringify([...counts].sort(([a],[b])=>a.localeCompare(b)));}
export function weekendDays(start:number,end:number){const DAY=86400000;if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start%DAY||end%DAY)return 0;const days=(end-start)/DAY+1,day=new Date(start).getUTCDay();return (days===2&&(day===5||day===6))|| (days===3&&day===5)?days:0;}
export function allocateSaving(amounts:number[],saving:number){
 const cents=amounts.map(x=>Math.round(x*100)),max=cents.reduce((n,x)=>n+x,0);let left=Math.min(Math.round(saving*100),max);
 return cents.map(amount=>{const off=Math.min(amount,left);left-=off;return (amount-off)/100;});
}
/** Omitted tier is reserved for pre-change grant refund accounting. */
export function monthlyCreditPence(paidMembershipPence:number,tierKey?:string){
 if(!Number.isSafeInteger(paidMembershipPence)||paidMembershipPence<0)throw Error("Invalid paid membership amount");
 const plan=tierKey===undefined?undefined:tierByKey(tierKey);
 if(tierKey!==undefined&&!plan)throw Error("Unknown membership plan");
 return Math.round(paidMembershipPence*(100+(plan?.creditBonusPct??30))/100);
}
export function paidDepositExempt(a:any){return !a?.membershipPerksPendingBookingId&&!!a?.membershipActive&&a.membershipStatus==="active"&&!!a.membershipPaidThrough&&a.membershipPaidThrough>Date.now();}
/** Clock-based entitlement survives a delayed lifecycle webhook without extending perks. */
export function membershipActiveNow(a:any){
 if(!a?.membershipActive || a.membershipPerksPendingBookingId)return false;
 if(!a.stripeSubscriptionId||a.membershipSource==="collective-comp")return true; // Explicit owner/collective complimentary membership.
 return a.membershipStatus==="trialing"?(a.membershipTrialEnd??0)>Date.now():a.membershipStatus==="active"&&(a.membershipPaidThrough??0)>Date.now();
}

export const MEMBERSHIP_TERMS_VERSION = "2026-10-membership-v6";

export const MEMBERSHIP_CREDIT_START = Date.UTC(2026,9,1);
