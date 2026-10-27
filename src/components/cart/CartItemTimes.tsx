"use client";
import { useId, useState } from "react";
import { useAction, useQuery } from "convex/react";
import { api } from "@cvx/_generated/api";
import { dayMs, daysInclusive } from "@/lib/dates";
import { rentalPricingDays } from "../../../shared/rentalDuration";
import { TimeSlotPicker } from "../checkout/TimeSlotPicker";
import { useCart, type CartItem } from "./CartProvider";

/** Checkout edits the saved basket line, so going back retains its own clocks. */
export function CartItemTimes({ item, defaultPickupTime, defaultReturnTime, delivery = false }: {
  item: CartItem; defaultPickupTime: string; defaultReturnTime: string; delivery?: boolean;
}) {
  const cart = useCart(), id = useId(), priceQuote = useAction(api.checkout.priceQuote);
  const [error, setError] = useState<string | null>(null), [busy, setBusy] = useState(false);
  const pickupTime = item.pickupTime || defaultPickupTime;
  const returnTime = item.returnTime || defaultReturnTime;
  const sameDay = item.start === item.end;
  const invalidOrder = sameDay && !!pickupTime && !!returnTime && returnTime <= pickupTime;
  const billableDays = invalidOrder ? daysInclusive(item.start, item.end) : rentalPricingDays(dayMs(item.start), dayMs(item.end), pickupTime, returnTime);
  // Boundary choices must remain usable before a complete valid pair exists.
  // The final basket check still gates payment after the customer chooses times.
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
      pickupTime: i.pickupTime || defaultPickupTime || undefined,
      returnTime: i.returnTime || defaultReturnTime || undefined,
    })),
  });

  async function choose(first: string, last: string, notice?: string) {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      let total = item.total;
      // Keep an intermediate same-day clock choice visible so the customer can
      // correct it. The invalid pair cannot be priced until its order is fixed.
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
  return <div className="rounded-xl border border-white/10 bg-white/[0.02] p-3" data-checkout-item-times={item.key}>
    <p className="text-sm font-medium text-white/90">{item.title}</p>
    <p className="mt-1 text-xs text-white/50">{item.start} → {item.end}</p>
    {pickupTime && returnTime && !invalidOrder && <p className="mt-1 text-xs text-accent-200/80" aria-live="polite">{billableDays} rental day{billableDays === 1 ? "" : "s"} · billed by the selected rental duration</p>}
    <div className="mt-3 grid grid-cols-2 gap-3">
      <TimeSlotPicker id={`${id}-pickup`} label={`${delivery ? "Delivery" : "Pickup"} · ${dateLabel(item.start)}`} value={pickupTime} onChange={choosePickup} disabled={!slots || busy} allowedSlots={slots?.available ? slots.pickupBoundarySlots ?? slots.pickupSlots : undefined} />
      <TimeSlotPicker id={`${id}-return`} label={`${delivery ? "Collection" : "Return"} · ${dateLabel(item.end)}`} value={returnTime} onChange={time => void choose(pickupTime, time)} disabled={!slots || busy} allowedSlots={slots?.available ? slots.returnBoundarySlots ?? slots.returnSlots : undefined} />
    </div>
    {invalidOrder && <p role="alert" className="mt-2 text-xs text-amber-200">Return must be later than pickup on the same day. Choose a later return time or change the return date in your basket.</p>}
    {(!pickupTime || !returnTime) && <p className="mt-2 text-xs text-white/55">Choose pickup and return times to check availability.</p>}
    {pickupTime && returnTime && slots && !slots.available && !invalidOrder && <p className="mt-2 text-xs text-amber-200">The equipment is unavailable for this full rental period. Adjust the pickup or return time, or choose different dates or a replacement in your basket.</p>}
    {busy && <p className="mt-2 text-xs text-white/55" role="status">Updating rental duration and price…</p>}
    {error && <p role="alert" className="mt-2 text-xs text-red-300">{error}</p>}
  </div>;
}
