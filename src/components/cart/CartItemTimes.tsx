"use client";

import { useEffect, useId, useState } from "react";
import { useAction, useQuery } from "convex/react";
import { api } from "@cvx/_generated/api";
import { dayMs, daysInclusive } from "@/lib/dates";
import { rentalPricingDays } from "../../../shared/rentalDuration";
import { TimeSlotPicker } from "../checkout/TimeSlotPicker";
import { useCart, type CartItem } from "./CartProvider";

/** Checkout keeps each line's own clocks and collapses completed time controls. */
export function CartItemTimes({ item, delivery = false }: { item: CartItem; delivery?: boolean }) {
  const cart = useCart(), id = useId(), priceQuote = useAction(api.checkout.priceQuote);
  const [error, setError] = useState<string | null>(null), [busy, setBusy] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const pickupTime = item.pickupTime || "";
  const returnTime = item.returnTime || "";
  const sameDay = item.start === item.end;
  const invalidOrder = sameDay && !!pickupTime && !!returnTime && returnTime <= pickupTime;
  const billableDays = invalidOrder ? daysInclusive(item.start, item.end) : rentalPricingDays(dayMs(item.start), dayMs(item.end), pickupTime, returnTime);

  useEffect(() => { if (invalidOrder) setExpanded(true); }, [invalidOrder]);

  const slots = useQuery(api.availability.forTimeSlots, {
    listingId: item.listingId as any,
    start: dayMs(item.start),
    end: dayMs(item.end),
    pickupTime: pickupTime || undefined,
    returnTime: returnTime || undefined,
    items: cart.items.filter(i => i.key !== item.key).map(i => ({
      listingId: i.listingId as any,
      start: dayMs(i.start),
      end: dayMs(i.end),
      pickupTime: i.pickupTime || undefined,
      returnTime: i.returnTime || undefined,
    })),
  });

  async function choose(first: string, last: string, notice?: string) {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      let total = item.total;
      const invalidSameDayOrder = item.start === item.end && !!first && !!last && last <= first;
      if (first && last && !invalidSameDayOrder) {
        const quote = await priceQuote({
          items: [{
            listingId: item.listingId as any,
            title: item.title,
            start: dayMs(item.start),
            end: dayMs(item.end),
            pickupTime: first,
            returnTime: last,
            qty: 1,
            total: item.total,
            deposit: item.deposit,
            offerType: item.offerType,
          }],
          customerEmail: "",
          fulfilment: "pickup",
          protection: "verify",
        });
        total = quote.items[0].total;
      }
      cart.updateDates(item.key, item.start, item.end, total, first || undefined, last || undefined, notice);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not update this rental time.");
    } finally {
      setBusy(false);
    }
  }

  function choosePickup(time: string) {
    if (sameDay && returnTime && time >= returnTime) {
      const next = slots?.validPairs?.filter(pair => pair.pickupTime === time && pair.returnTime > time).map(pair => pair.returnTime).sort()[0];
      if (next) {
        void choose(time, next, `Pickup saved at ${time}. Return moved to ${next} so it is later than pickup.`);
        return;
      }
    }
    void choose(time, returnTime);
  }

  const dateLabel = (date: string) => new Date(`${date}T12:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "Europe/London" });
  const status = invalidOrder ? "Fix return time" : pickupTime && returnTime ? `${pickupTime} → ${returnTime}` : "Times needed";

  return <div className="py-2.5" data-checkout-item-times={item.key}>
    <button
      type="button"
      className="flex min-h-10 w-full items-center justify-between gap-3 rounded-lg px-2 text-left transition-colors hover:bg-white/[.035]"
      aria-expanded={expanded}
      aria-controls={`${id}-controls`}
      onClick={() => setExpanded(value => !value)}
    >
      <span className="min-w-0">
        <span className="block truncate text-sm font-medium text-white/85">{item.title}</span>
        <span className="block text-[11px] text-white/45">{dateLabel(item.start)}{item.start !== item.end ? ` – ${dateLabel(item.end)}` : ""}</span>
      </span>
      <span className="flex shrink-0 items-center gap-2">
        <span className={`text-xs ${pickupTime && returnTime && !invalidOrder ? "text-accent-200/80" : "text-amber-200/75"}`}>{status}</span>
        <svg className={`h-4 w-4 text-white/45 transition-transform ${expanded ? "rotate-180" : ""}`} viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="m5 7.5 5 5 5-5"/></svg>
      </span>
    </button>
    {expanded && <div id={`${id}-controls`} className="mt-2 rounded-lg border border-white/10 bg-white/[.02] p-2.5">
      <div className="grid grid-cols-2 gap-2 sm:gap-3">
        <TimeSlotPicker id={`${id}-pickup`} label={`${delivery ? "Delivery" : "Pickup"} · ${dateLabel(item.start)}`} value={pickupTime} onChange={choosePickup} disabled={!slots || busy} allowedSlots={slots?.available ? slots.pickupBoundarySlots ?? slots.pickupSlots : undefined} />
        <TimeSlotPicker id={`${id}-return`} label={`${delivery ? "Collection" : "Return"} · ${dateLabel(item.end)}`} value={returnTime} onChange={time => void choose(pickupTime, time)} disabled={!slots || busy} allowedSlots={slots?.available ? slots.returnBoundarySlots ?? slots.returnSlots : undefined} />
      </div>
      {pickupTime && returnTime && !invalidOrder && <p className="mt-2 text-[11px] text-accent-200/75" aria-live="polite">{billableDays} rental day{billableDays === 1 ? "" : "s"} · billed by the selected rental duration</p>}
      {invalidOrder && <p role="alert" className="mt-2 text-xs text-amber-200">Return must be later than pickup on the same day. Choose a later return time or change the return date.</p>}
      {pickupTime && returnTime && slots && !slots.available && !invalidOrder && <p className="mt-2 text-xs text-amber-200">Unavailable for this full rental period. Adjust a time or date, or choose a replacement in your basket.</p>}
      {busy && <p className="mt-2 text-xs text-white/55" role="status">Updating rental duration and price…</p>}
      {error && <p role="alert" className="mt-2 text-xs text-red-300">{error}</p>}
    </div>}
    {!expanded && error && <p role="alert" className="ml-2 mt-1 text-xs text-red-300">{error}</p>}
  </div>;
}
