"use client";
import { useEffect } from "react";
import { useCart } from "./CartProvider";
import { usePromo } from "./usePromo";
export function CheckoutCode({benefitKind}:{benefitKind?:string}){
 const {eligibleSubtotal}=useCart(),promo=usePromo(eligibleSubtotal);
 useEffect(()=>promo.setDraft(promo.applied??""),[promo.applied]);
 return <details className="rounded-2xl border border-white/10 p-4" open={!!promo.applied}>
  <summary className="cursor-pointer text-xs text-white/60">Promo or friend’s referral code</summary>
  <form className="mt-3 flex gap-2" onSubmit={e=>{e.preventDefault();promo.apply();}}><label className="sr-only" htmlFor="checkout-code">Promo or referral code</label><input id="checkout-code" className="input min-w-0 flex-1" value={promo.draft} onChange={e=>promo.setDraft(e.target.value)} placeholder="Enter code"/><button type="submit" className="btn-secondary px-4 text-xs">Apply</button>{promo.applied&&<button type="button" onClick={promo.remove} className="px-2 text-xs text-white/40">Remove</button>}</form>
  {promo.applied&&promo.status&&!promo.status.valid&&<p role="status" className="mt-2 text-xs text-amber-200">{promo.status.reason}</p>}
  {promo.applied&&promo.status?.valid&&<p role="status" className="mt-2 text-xs text-white/50">{benefitKind&&!["promo","referral_friend"].includes(benefitKind)?"A larger saving is selected instead. Your code has not been used.":"Code accepted. The confirmed quote below shows your saving."}</p>}
  <p className="mt-2 text-[10px] leading-5 text-white/35">Only one price benefit applies. Refund credit can pay the balance. Referral offers require normal upfront security and the full hold.</p>
 </details>;
}
