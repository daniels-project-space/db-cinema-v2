"use client";

import { useMemo } from "react";
import { useQuery } from "convex/react";
import { api } from "@cvx/_generated/api";
import { useCart, type CartItem } from "@/components/cart/CartProvider";
import { SmartImage } from "@/components/SmartImage";
import { formatGbp } from "@/lib/pricing";
import { dayMs } from "@/lib/dates";
import { CHECKOUT_ACCESSORY_OFFER, CHECKOUT_ACCESSORY_OFFER_LIMIT } from "../../../shared/checkoutAccessoryOffer";

export function CheckoutAccessoryOffers({ items }: { items: CartItem[] }) {
  const cart = useCart();
  const ready = items.length > 0 && items.every(item => item.pickupTime && item.returnTime &&
    !(item.start === item.end && item.returnTime! <= item.pickupTime!));
  const args = useMemo(() => ({ items: items.map(item => ({
    listingId: item.listingId as any,
    start: dayMs(item.start),
    end: dayMs(item.end),
    pickupTime: item.pickupTime,
    returnTime: item.returnTime,
    offerType: item.offerType,
  })) }), [items]);
  const result = useQuery(api.liveRecommendations.checkoutAccessoryOffers, ready ? args : "skip");
  const selectedOffers = items.filter(item => item.offerType === CHECKOUT_ACCESSORY_OFFER).length;

  if (!items.length || selectedOffers >= CHECKOUT_ACCESSORY_OFFER_LIMIT || !ready || !result || !result.offers.length) return null;

  return <section aria-label="Compatible accessory offers" className="my-4 overflow-hidden rounded-2xl border border-accent-300/20 bg-[radial-gradient(ellipse_at_top_left,rgba(217,170,112,.10),transparent_65%),rgba(255,255,255,.025)] p-3.5 shadow-[0_12px_32px_rgba(0,0,0,.18)]">
    <div className="mb-3 flex items-start justify-between gap-3">
      <div className="min-w-0">
        <h3 className="text-sm font-semibold text-white/90">Made for your kit</h3>
        <p className="mt-1 text-[11px] leading-4 text-white/50">Available accessories · up to {result.percent}% off</p>
      </div>
      <span className="shrink-0 rounded-full border border-accent-200/20 bg-accent-200/[.07] px-2 py-1 text-[10px] font-medium text-accent-100">Checked live</span>
    </div>
    <div className="space-y-2">
      {result.offers.map(offer => {
        const alreadyAdded = items.some(item => item.listingId === offer.listingId);
        const accessory: Omit<CartItem, "key"> = {
          listingId: offer.listingId,
          slug: offer.slug,
          title: offer.title,
          heroImage: offer.heroImage,
          imageSources: offer.imageSources,
          start: offer.start,
          end: offer.end,
          pickupTime: offer.pickupTime,
          returnTime: offer.returnTime,
          days: offer.days,
          perDay: offer.perDay,
          total: offer.total,
          deposit: offer.deposit,
          offerType: CHECKOUT_ACCESSORY_OFFER,
        };
        return <article key={offer.listingId} className="flex min-w-0 items-center gap-2.5 rounded-xl border border-white/[.08] bg-black/20 p-2">
          <div className="h-14 w-14 shrink-0 overflow-hidden rounded-lg border border-white/10 bg-white/[.04]">
            <SmartImage src={offer.heroImage} fallbackSources={offer.imageSources ?? []} alt={offer.title} className="h-full w-full" fit="cover" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="line-clamp-2 text-xs font-medium leading-4 text-white/85">{offer.title}</p>
            <div className="mt-1 flex flex-wrap items-baseline gap-x-1.5">
              <span className="text-xs font-semibold text-accent-100">{formatGbp(offer.total)}</span>
              <span className="text-[10px] text-white/35 line-through">{formatGbp(offer.originalTotal)}</span>
              <span className="text-[10px] text-emerald-200/80">{offer.percent}% off</span>
            </div>
          </div>
          <button type="button" disabled={alreadyAdded} onClick={() => cart.add(accessory)}
            className="inline-flex min-h-9 shrink-0 items-center gap-1.5 rounded-lg border border-accent-200/30 bg-accent-200/[.11] px-2.5 text-[11px] font-medium text-accent-50 transition hover:bg-accent-200/[.2] disabled:cursor-not-allowed disabled:opacity-40">
            <svg viewBox="0 0 20 20" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><path d="M10 4v12M4 10h12" /></svg>
            Add
          </button>
        </article>;
      })}
    </div>
  </section>;
}
