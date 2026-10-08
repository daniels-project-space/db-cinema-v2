"use client";

import { useId, useState } from "react";
import { useAction, useConvex, useQuery } from "convex/react";
import { api } from "@cvx/_generated/api";
import { dayMs, daysInclusive } from "@/lib/dates";
import { type CartItem, useCart } from "./CartProvider";

import {TimeSlotPicker} from "../checkout/TimeSlotPicker";

export function CartItemDates({ item }: { item: CartItem }) {
  const cart = useCart(), convex = useConvex(), priceQuote = useAction(api.checkout.priceQuote);
  const id = useId();
  const [open, setOpen] = useState(false), [start, setStart] = useState(item.start), [end, setEnd] = useState(item.end);
  const [pickupTime,setPickupTime]=useState(item.pickupTime??""),[returnTime,setReturnTime]=useState(item.returnTime??"");
  const [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null);
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London" }).format(new Date());
  const valid = !!start && !!end && start >= today && end >= start;
  const prospective = cart.items.map(i => ({ listingId: i.listingId as any, start: dayMs(i.key === item.key ? start : i.start), end: dayMs(i.key === item.key ? end : i.end),pickupTime:i.key===item.key?pickupTime||undefined:i.pickupTime,returnTime:i.key===item.key?returnTime||undefined:i.returnTime }));
  const fit = useQuery(api.availability.forCart, open && valid ? { items: prospective } : "skip");
  const slots=useQuery(api.availability.forTimeSlots,open&&valid?{listingId:item.listingId as any,start:dayMs(start),end:dayMs(end),pickupTime:pickupTime||undefined,returnTime:returnTime||undefined,items:prospective.filter((_,index)=>cart.items[index].key!==item.key)}:"skip");
  const available = !!fit?.[item.listingId]?.ok;

  async function save() {
    if (!valid || busy) return;
    setBusy(true); setError(null);
    try {
      const checked = await convex.query(api.availability.forCart, { items: prospective });
      if (!checked[item.listingId]?.ok) throw Error("This item isn't available with your kit on those dates. Try another date range.");
      const quote = await priceQuote({ items: [{ listingId: item.listingId as any, title: item.title, start: dayMs(start), end: dayMs(end), qty: 1, total: item.total, deposit: item.deposit, offerType: item.offerType }], customerEmail: "", fulfilment: "pickup", protection: "verify" });
      cart.updateDates(item.key, start, end, quote.items[0].total,pickupTime||undefined,returnTime||undefined);
      setOpen(false);
    } catch (e) { setError(e instanceof Error ? e.message : "Couldn't update dates. Please try again."); }
    finally { setBusy(false); }
  }

  return <div className="mt-2" data-cart-dates={item.key}>
    <button type="button" aria-expanded={open} aria-controls={id} onClick={() => { setStart(item.start); setEnd(item.end);setPickupTime(item.pickupTime??"");setReturnTime(item.returnTime??""); setError(null); setOpen(!open); }} disabled={busy} className="inline-flex min-h-8 items-center gap-1.5 text-xs text-white/60 underline decoration-white/20 underline-offset-4 hover:text-white">
      <svg viewBox="0 0 20 20" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.3" aria-hidden="true"><rect x="3" y="4" width="14" height="13" rx="2"/><path d="M6 2v4m8-4v4M3 8h14m-10 4h2m2 0h2"/></svg>
      {open ? "Close date editor" : "Change dates"}
    </button>
    {open && <div id={id} className="mt-2 rounded-xl border border-white/10 bg-black/20 p-3">
      <div className="grid grid-cols-2 gap-2">
        <label className="min-w-0 text-[10px] text-white/50">Pickup<input aria-label={`Pickup date for ${item.title}`} type="date" min={today} value={start} disabled={busy} onChange={e => { setStart(e.target.value); if (e.target.value > end) setEnd(e.target.value); setError(null); }} className="input mt-1 w-full min-w-0 !px-2 !py-2 text-xs [color-scheme:dark]"/></label>
        <label className="min-w-0 text-[10px] text-white/50">Return<input aria-label={`Return date for ${item.title}`} type="date" min={start || today} value={end} disabled={busy} onChange={e => { setEnd(e.target.value); setError(null); }} className="input mt-1 w-full min-w-0 !px-2 !py-2 text-xs [color-scheme:dark]"/></label>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2">
        <TimeSlotPicker id={`${id}-pickup`} label="Pickup time" value={pickupTime} onChange={setPickupTime} disabled={busy||!slots} allowedSlots={slots?.pickupSlots}/>
        <TimeSlotPicker id={`${id}-return`} label="Return time" value={returnTime} onChange={setReturnTime} disabled={busy||!slots} allowedSlots={slots?.returnSlots}/>
      </div>
      <p className="mt-2 text-[10px] leading-4 text-white/45" aria-live="polite">{!valid ? "Choose a valid date range from today onwards." : fit === undefined ? "Checking availability for your kit…" : !available ? "Unavailable with your kit. Try different dates." : `${daysInclusive(start, end)} rental day${daysInclusive(start, end) === 1 ? "" : "s"} · available with your kit. Price updates when saved.`}</p>
      {error && <p role="alert" className="mt-2 text-xs text-red-300">{error}</p>}
      <button type="button" data-cart-date-save onClick={save} disabled={!valid || !available || busy} className="btn-ghost mt-3 min-h-9 w-full !px-3 !py-2 text-xs">{busy ? "Updating…" : "Save dates"}</button>
    </div>}
  </div>;
}
