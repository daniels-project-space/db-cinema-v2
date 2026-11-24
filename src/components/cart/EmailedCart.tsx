"use client";

import { useState } from "react";
import { useCheckoutStatus, CheckoutPauseNotice } from "./CheckoutStatus";
import { useQuery } from "convex/react";
import { useRouter } from "next/navigation";
import { api } from "@cvx/_generated/api";
import { SiteHeader } from "@/components/SiteHeader";
import { SmartImage } from "@/components/SmartImage";
import { useCart, type CartItem } from "./CartProvider";
import { formatGbp } from "@/lib/pricing";

const utcDay = (value: string) => value ? Date.parse(`${value}T00:00:00.000Z`) : undefined;

function shortDate(value: string) {
  return new Date(`${value}T12:00:00.000Z`).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "Europe/London",
  });
}

export function EmailedCart({ shareKey }: { shareKey: string }) {
  const checkout = useCheckoutStatus();
  const router = useRouter();
  const cart = useCart();
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [error, setError] = useState<string | null>(null);
  const hasValidDateRange = !!startDate && !!endDate && endDate >= startDate;
  const source = useQuery(api.checkoutCartData.get, {
    shareKey,
    start: hasValidDateRange ? utcDay(startDate) : undefined,
    end: hasValidDateRange ? utcDay(endDate) : undefined,
  });
  const hasUndatedItems = !!source?.items.some(item => !item.start || !item.end);
  const ready = !!source && !source.needsDates && !hasUndatedItems && source.items.length === source.itemCount;
  const total = ready && source.items.every(item => item.total !== null)
    ? source.items.reduce((sum, item) => sum + (item.total ?? 0), 0)
    : null;

  function continueToCart() {
    setError(null);
    if (!source || !ready) {
      setError("Choose both rental dates to continue.");
      return;
    }
    if (source.items.some(item => !item.start || !item.end || item.days === null || item.total === null || item.perDay === null)) {
      setError("Choose dates for every item before continuing.");
      return;
    }
    const items: CartItem[] = source.items.map(item => ({
        key: item.key,
        listingId: item.listingId,
        title: item.title,
        slug: item.slug,
        heroImage: item.heroImage,
        imageSources: item.imageSources,
        start: item.start,
        end: item.end,
        pickupTime: item.pickupTime,
        returnTime: item.returnTime,
        days: item.days,
        total: item.total,
        perDay: item.perDay,
        deposit: item.deposit,
      } as CartItem));
    cart.replace(items);
    cart.setMembership(null);
    cart.setPromo(null);
    router.push(source.available && checkout.enabled ? "/checkout" : "/cart");
  }

  return <>
    <SiteHeader />
    <main className="section-window mx-auto max-w-3xl px-5 py-10 sm:px-6 sm:py-14">
      <div className="overflow-hidden rounded-[28px] border border-white/10 bg-[linear-gradient(145deg,rgba(255,255,255,.075),rgba(255,255,255,.025)_38%,rgba(0,0,0,.2))] p-5 shadow-[0_24px_80px_rgba(0,0,0,.3),inset_0_1px_0_rgba(255,255,255,.07)] backdrop-blur-2xl sm:p-8">
        <p className="text-[10px] font-medium uppercase tracking-[.22em] text-accent-200/75">DB Cinema Rentals · private kit</p>
        <h1 className="mt-3 font-display text-3xl text-white sm:text-4xl">Your rental kit</h1>
        {source === undefined ? <p className="mt-6 text-white/60" role="status">Checking your kit…</p>
          : !source ? <p className="mt-6 text-white/60">This link has expired or is unavailable. Ask us for a fresh one.</p>
            : <>
              <p className="mt-3 max-w-xl text-sm leading-relaxed text-white/55">Review the real listings below. Dates, availability and final pricing are checked again before payment; opening this link does not reserve equipment.</p>
              <div className="mt-6 grid gap-3 sm:grid-cols-2">
                {source.items.map(item => <article key={item.key} className="overflow-hidden rounded-2xl border border-white/10 bg-black/20 shadow-[inset_0_1px_0_rgba(255,255,255,.05)]">
                  <SmartImage fit="cover" src={item.heroImage} fallbackSources={item.imageSources} alt={item.title} className="aspect-[16/10] w-full bg-white/[.025]" />
                  <div className="p-4">
                    <h2 className="line-clamp-2 text-sm font-medium leading-snug text-white/90">{item.title}</h2>
                    {item.start && item.end ? <p className="mt-2 text-xs text-white/50">{shortDate(item.start)}{item.start !== item.end ? ` – ${shortDate(item.end)}` : ""}</p>
                      : <p className="mt-2 text-xs text-accent-100/70">Dates to be chosen</p>}
                    <p className="mt-3 text-sm text-white/65">{item.total !== null ? <><span className="font-semibold text-white/90">{formatGbp(item.total)}</span><span className="ml-1 text-[11px] text-white/40">estimated hire</span></> : "Choose dates for a quote"}</p>
                  </div>
                </article>)}
              </div>
              {hasUndatedItems && <section className="mt-6 rounded-2xl border border-accent-200/15 bg-accent-200/[.045] p-4 sm:p-5" aria-label="Choose rental dates">
                <div><h2 className="text-sm font-semibold text-white/90">Add your dates</h2><p className="mt-1 text-xs text-white/50">Exact collection and return times come next.</p></div>
                <div className="mt-4 grid grid-cols-2 gap-3">
                  <label className="text-xs text-white/55">First day<input aria-label="Rental start date" type="date" value={startDate} max={endDate || undefined} onChange={event => { setStartDate(event.target.value); setError(null); }} className="input mt-1 w-full" /></label>
                  <label className="text-xs text-white/55">Last day<input aria-label="Rental return date" type="date" value={endDate} min={startDate || undefined} onChange={event => { setEndDate(event.target.value); setError(null); }} className="input mt-1 w-full" /></label>
                </div>
                {startDate && endDate && endDate < startDate && <p className="mt-3 text-xs text-rose-200" role="alert">Return date must be on or after the first day.</p>}
              </section>}
              {source.items.length !== source.itemCount && <p role="alert" className="mt-4 rounded-xl border border-rose-200/15 bg-rose-100/[.04] p-3 text-xs text-rose-100/80">A listing in this kit is no longer available. Ask us to rebuild the link before checkout.</p>}
              {total !== null && <div className="mt-5 flex items-center justify-between border-t border-white/10 pt-4 text-sm"><span className="text-white/55">Estimated gear total</span><strong className="text-white">{formatGbp(total)}</strong></div>}
              {source.available === false && <p role="status" className="mt-4 rounded-xl border border-amber-200/15 bg-amber-100/[.04] p-3 text-xs text-amber-100/80">Some items need a date change or replacement. We’ll show the available options in your basket.</p>}
              {source.availabilityCheckFailed && <p role="status" className="mt-4 rounded-xl border border-amber-200/15 bg-amber-100/[.04] p-3 text-xs text-amber-100/80">We couldn’t confirm availability just now. It will be checked again before payment.</p>}
              {!checkout.enabled && <CheckoutPauseNotice loading={checkout.loading} />}
              {error && <p role="alert" className="mt-4 text-xs text-rose-200">{error}</p>}
              <button type="button" className="btn-primary mt-6 w-full py-3" disabled={!ready || !checkout.enabled} onClick={continueToCart}>{source.available === false ? "Review alternatives" : source.availabilityCheckFailed ? "Continue to basket" : "Continue to checkout"}<span className="ml-2" aria-hidden="true">→</span></button>
              <p className="mt-3 text-center text-[11px] text-white/35">Private link · expires {shortDate(new Date(source.expiresAt).toISOString().slice(0, 10))}</p>
            </>}
      </div>
    </main>
  </>;
}
