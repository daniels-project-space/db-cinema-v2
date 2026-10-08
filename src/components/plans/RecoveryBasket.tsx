"use client";
import Link from "next/link";
import {useQuery} from "convex/react";
import {useRouter} from "next/navigation";
import {api} from "@cvx/_generated/api";
import {useAccount} from "@/components/account/AccountProvider";
import {useCart,type CartItem} from "@/components/cart/CartProvider";
import {SiteHeader} from "@/components/SiteHeader";
import {expandKitCart} from "../../../shared/kitCart";
const date=(n:number)=>new Intl.DateTimeFormat("en-GB",{day:"numeric",month:"short",year:"numeric",timeZone:"UTC"}).format(n);
export function RecoveryBasket({recoveryId}:{recoveryId:string}){
 const account=useAccount(),cart=useCart(),router=useRouter();
 const data=useQuery(api.checkoutRecovery.resume,account.token&&account.me?{token:account.token,id:recoveryId as any}:"skip");
 const valid=data?.cartLines.filter(line=>line!==null)??[];
 function restore(){if(!valid.length)return;cart.replace(expandKitCart(valid) as CartItem[]);router.push("/cart");}
 return <><SiteHeader/><main className="mx-auto max-w-5xl px-6 pb-24 pt-28" aria-label="Saved rental basket">
  <p className="font-mono text-xs uppercase tracking-[.2em] text-accent-300">Your saved kit</p>
  <h1 className="mt-3 font-display text-4xl text-white">Pick up where you left off</h1>
  {!account.me?<p className="mt-6 text-white/60"><Link className="text-accent-300 underline" href="/account">Sign in</Link> with the account you used for this kit, then reopen this link.</p>:data===undefined?<p role="status" className="mt-6 text-white/60">Loading your basket…</p>:!data?<p role="status" className="mt-6 text-white/60">This saved basket is no longer available. <Link href="/cart" className="text-accent-300 underline">Open your current basket</Link>.</p>:<>
   <p className="mt-4 max-w-2xl text-sm text-white/55">Your dates, times and quantities are saved. Review current availability and replacement options in the basket before checkout.</p>
   <div className="mt-8 grid gap-4 sm:grid-cols-2">{data.lines.map((line,index)=>{const item=data.items[index],priced=data.cartLines[index];return <article key={`${line.listingId}-${index}`} className="flex gap-4 rounded-2xl border border-white/10 bg-white/[.025] p-4">
    {item.heroImage?<img src={item.heroImage} alt={item.title} className="h-24 w-24 shrink-0 rounded-xl object-contain bg-white/[.035]"/>:null}
    <div className="min-w-0"><h2 className="text-sm font-medium text-white">{item.title} <span className="text-white/40">× {line.qty}</span></h2>
     <p className="mt-2 text-xs text-white/55">Pickup {date(line.start)}{line.pickupTime?` at ${line.pickupTime}`:""}</p>
     <p className="mt-1 text-xs text-white/55">Return {date(line.end)}{line.returnTime?` at ${line.returnTime}`:""}</p>
     <p className="mt-2 text-xs text-white/40">London time</p>
     <p className="mt-2 text-sm text-accent-300">{priced?`£${(priced.total*line.qty).toFixed(2)} rental`:"This item is no longer listed."}</p>
    </div>
   </article>})}</div>
   {valid.length<data.lines.length?<p role="status" className="mt-5 text-sm text-white/60">Items no longer listed cannot be restored. You can review the remaining kit or contact our team for alternatives.</p>:null}
   <button onClick={restore} disabled={!valid.length} className="mt-8 rounded-full bg-accent-500 px-6 py-3 font-medium text-black disabled:opacity-40">{valid.length<data.lines.length?"Restore remaining items":cart.items.length?"Replace my basket with this kit":"Restore my basket"}</button>
  </>}
 </main></>;
}
