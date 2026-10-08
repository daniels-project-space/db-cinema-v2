"use client";
import { useCheckoutStatus, CheckoutPauseNotice } from "./CheckoutStatus";
import { useQuery } from "convex/react";
import { useRouter } from "next/navigation";
import { api } from "@cvx/_generated/api";
import { SiteHeader } from "@/components/SiteHeader";
import { useCart } from "./CartProvider";
import { formatGbp } from "@/lib/pricing";
export function EmailedCart({shareKey}:{shareKey:string}){
 const checkout=useCheckoutStatus();
 const source=useQuery(api.checkoutCartData.get,{shareKey}),cart=useCart(),router=useRouter();
 return <><SiteHeader/><main className="section-window mx-auto max-w-2xl px-6 py-12"><h1 className="font-display text-3xl text-white">Your discussed rental cart</h1>{source===undefined?<p className="mt-6 text-white/60">Checking your kit…</p>:!source?<p className="mt-6 text-white/60">This cart link has expired or is unavailable. Ask Gaffer for a new one.</p>:<>
 <p className="mt-3 text-white/60">Your hire dates are already selected. We check prices and availability again before payment.</p>
 <div className="mt-6 space-y-3">{source.items.map(item=><div key={item.key} className="rounded-xl border border-white/10 p-4"><p className="text-white">{item.title}</p><p className="mt-1 text-sm text-white/60">{item.start} → {item.end} · {formatGbp(item.total)}</p></div>)}</div>
 {!source.available&&<p role="status" className="mt-4 text-amber-300">Some items are unavailable. Open the cart to choose available replacements for the same dates.</p>}
 {!checkout.enabled&&<CheckoutPauseNotice loading={checkout.loading}/>}
 <button className="btn-primary mt-6 w-full py-3" onClick={()=>{cart.replace(source.items);cart.setMembership(null);cart.setPromo(null);router.push(source.available&&checkout.enabled?"/checkout":"/cart");}}>{source.available&&checkout.enabled?"Continue to checkout":"Open cart and replacements"}</button>
 </>}</main></>;
}
