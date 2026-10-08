"use client";
import {useId,useState} from "react";
import {useQuery} from "convex/react";
import {api} from "@cvx/_generated/api";
import {dayMs} from "@/lib/dates";
import {TimeSlotPicker} from "../checkout/TimeSlotPicker";
import {useCart,type CartItem} from "./CartProvider";

/** Checkout edits the saved basket line, so going back retains its own clocks. */
export function CartItemTimes({item,defaultPickupTime,defaultReturnTime,ready,delivery=false}:{item:CartItem;defaultPickupTime:string;defaultReturnTime:string;ready:boolean;delivery?:boolean}) {
 const cart=useCart(),id=useId(),[error,setError]=useState<string|null>(null);
 const pickupTime=item.pickupTime||defaultPickupTime,returnTime=item.returnTime||defaultReturnTime;
 const slots=useQuery(api.availability.forTimeSlots,ready?{listingId:item.listingId as any,start:dayMs(item.start),end:dayMs(item.end),pickupTime:pickupTime||undefined,returnTime:returnTime||undefined,items:cart.items.filter(i=>i.key!==item.key).map(i=>({listingId:i.listingId as any,start:dayMs(i.start),end:dayMs(i.end),pickupTime:i.pickupTime||defaultPickupTime||undefined,returnTime:i.returnTime||defaultReturnTime||undefined}))}:"skip");
 function choose(first:string,last:string){try{cart.updateDates(item.key,item.start,item.end,item.total,first||undefined,last||undefined);setError(null);}catch(e){setError(e instanceof Error?e.message:"Could not save collection times.");}}
 return <div className="rounded-xl border border-white/10 bg-white/[0.02] p-3" data-checkout-item-times={item.key}>
  <p className="text-sm font-medium text-white/90">{item.title}</p>
  <p className="mt-1 text-xs text-white/50">{item.start} → {item.end}</p>
  <div className="mt-3 grid grid-cols-2 gap-3">
   <TimeSlotPicker id={`${id}-pickup`} label={delivery?"Delivery time":"Pickup time"} value={pickupTime} onChange={time=>choose(time,returnTime)} disabled={!ready||!slots} allowedSlots={slots?.pickupSlots}/>
   <TimeSlotPicker id={`${id}-return`} label={delivery?"Collection time":"Return time"} value={returnTime} onChange={time=>choose(pickupTime,time)} disabled={!ready||!slots} allowedSlots={slots?.returnSlots}/>
  </div>
  {slots&&!slots.available&&<p className="mt-2 text-xs text-amber-200">These times do not fit together. Changing one time may require changing the other. Choose an available pair or change dates in your basket.</p>}
  {error&&<p role="alert" className="mt-2 text-xs text-red-300">{error}</p>}
 </div>;
}
