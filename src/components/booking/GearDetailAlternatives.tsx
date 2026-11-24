"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useConvex } from "convex/react";
import { api } from "@cvx/_generated/api";
import { SmartImage } from "@/components/SmartImage";
import { Calendar } from "@/components/booking/Calendar";
import { useCart } from "@/components/cart/CartProvider";
import { dayMs } from "@/lib/dates";
import { formatGbp } from "@/lib/pricing";

type Listing = {
  _id: string;
  title: string;
  displayOnly?: boolean;
  bookable?: boolean;
};

type Alternative = {
  listingId: string;
  slug: string;
  title: string;
  heroImage: string | null;
  imageSources: string[];
  days: number;
  perDay: number;
  total: number;
  deposit: number;
  included: string[];
  verifiedComponentContents: string[];
};

type Results =
  | { status: "refresh_required" }
  | { status: "ready"; requested: number; options: { id: string; total: number; items: Alternative[] }[]; singles: Alternative[]; searchLimited: boolean }
  | null;

const validWindow = (start: string | null, end: string | null) => {
  if (!start || !end || !/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end) || end < start) return false;
  const startMs = dayMs(start), endMs = dayMs(end);
  return startMs > 0 && endMs >= startMs && endMs - startMs <= 365 * 86400000;
};

export function GearDetailAlternatives({
  listing,
  start,
  end,
  month,
  onPick,
  onMonthChange,
}: {
  listing: Listing;
  start: string | null;
  end: string | null;
  month: Date;
  onPick: (date: string) => void;
  onMonthChange: (date: Date) => void;
}) {
  const convex = useConvex();
  const cart = useCart();
  const latestCartItems = useRef(cart.items);
  latestCartItems.current = cart.items;
  const [result, setResult] = useState<Results>(null);
  const [loading, setLoading] = useState(false);
  const [retry, setRetry] = useState(0);
  const [error, setError] = useState("");
  const [added, setAdded] = useState("");
  const inFlight = useRef(false);

  const sourceInCart = cart.items.some((item) => item.listingId === listing._id);
  const dateWindowReady = validWindow(start, end);
  const args = useMemo(() => {
    if (!dateWindowReady || !start || !end) return null;
    return {
      items: [
        ...cart.items.map((item) => ({
          key: item.key,
          listingId: item.listingId as any,
          start: dayMs(item.start),
          end: dayMs(item.end),
          pickupTime: item.pickupTime,
          returnTime: item.returnTime,
          qty: 1,
        })),
        {
          key: `detail-${listing._id}`,
          listingId: listing._id as any,
          start: dayMs(start),
          end: dayMs(end),
          qty: 1,
        },
      ],
      sourceKey: `detail-${listing._id}`,
      limit: 3,
    };
  }, [cart.items, dateWindowReady, end, listing._id, start]);

  useEffect(() => {
    let current = true;
    if (listing.displayOnly || listing.bookable !== false || sourceInCart || !args || cart.items.length >= 100) {
      setResult(null);
      setLoading(false);
      setError("");
      return () => { current = false; };
    }
    setResult(null);
    setError("");
    setLoading(true);
    void convex.query(api.cartReplacements.sets, args)
      .then((value) => {
        if (!current) return;
        if (!value) {
          setError("We couldn’t find a live quote for this listing. Try again or ask Gaffer.");
          return;
        }
        setResult(value as Results);
      })
      .catch(() => { if (current) setError("Couldn’t check these dates. Try again."); })
      .finally(() => { if (current) setLoading(false); });
    return () => { current = false; };
  }, [args, cart.items.length, convex, listing.bookable, listing.displayOnly, retry, sourceInCart]);

  if (listing.displayOnly || listing.bookable !== false) return null;

  const requestDates = (choice: Alternative[]) => choice.map((item) => ({
    listingId: item.listingId,
    slug: item.slug,
    title: item.title,
    heroImage: item.heroImage,
    imageSources: item.imageSources,
    start: start!,
    end: end!,
    days: item.days,
    perDay: item.perDay,
    total: item.total,
    deposit: item.deposit,
  }));

  const blockReason = (choices: Alternative[]) => {
    if (cart.items.length + choices.length > 100) return "Your kit is full";
    const ids = choices.map((choice) => choice.listingId);
    if (new Set(ids).size !== ids.length) return "This set needs the same listing more than once";
    if (choices.some((choice) => cart.items.some((item) => item.listingId === choice.listingId && item.start === start && item.end === end))) return "Already in your kit for these dates";
    return "";
  };

  async function addFreshOption(id: string, single = false) {
    if (!args || !start || !end || loading || inFlight.current) return;
    inFlight.current = true;
    const expectedBasket = JSON.stringify(latestCartItems.current);
    setLoading(true);
    setError("");
    setAdded("");
    try {
      const fresh = await convex.query(api.cartReplacements.sets, args) as Results;
      if (fresh?.status !== "ready") {
        setResult(fresh);
        setError(fresh?.status === "refresh_required" ? "Shared stock is refreshing. Check again shortly." : "This option changed. Refresh the results.");
        return;
      }
      setResult(fresh);
      if (JSON.stringify(latestCartItems.current) !== expectedBasket) throw Error("Your kit changed. Check these dates again.");
      const choice = single
        ? fresh.singles.find((item) => item.listingId === id)
        : fresh.options.find((option) => option.id === id)?.items;
      const choices = choice ? (Array.isArray(choice) ? choice : [choice]) : [];
      if (!choices.length) throw Error("That alternative is no longer available. Choose another option.");
      const reason = blockReason(choices);
      if (reason) throw Error(reason);
      for (const item of requestDates(choices)) cart.add(item);
      setAdded(choices.length === 1 ? `${choices[0].title} added to your kit.` : `${choices.length} available alternatives added to your kit.`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Couldn’t add this alternative. Try again.");
    } finally {
      inFlight.current = false;
      setLoading(false);
    }
  }

  const displayResult = result;
  const options = displayResult?.status === "ready" ? displayResult.options : [];
  const hasAddableOption = options.some((option) => !blockReason(option.items));
  const singles = displayResult?.status === "ready" && !hasAddableOption ? displayResult.singles : [];

  return (
    <section data-testid="gear-detail-alternatives" className="overflow-hidden rounded-2xl border border-white/10 bg-white/[0.035] shadow-[0_18px_50px_rgba(0,0,0,.24)] backdrop-blur-xl">
      <div className="border-b border-white/[0.08] px-4 py-4 sm:px-5">
        <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[.16em] text-accent-200/80">
          <span aria-hidden="true" className="grid h-7 w-7 place-items-center rounded-full border border-accent-300/25 bg-accent-300/[.08] text-sm">↗</span>
          <span>Not bookable online</span>
        </div>
        <h2 className="mt-3 font-display text-lg font-semibold text-white">Find a live alternative</h2>
        <p className="mt-1 text-xs leading-5 text-white/55">Choose dates to see compatible gear, real stock and pricing.</p>
      </div>

      <div className="space-y-3 p-3 sm:p-4">
        <div role="group" aria-label="Select rental dates" data-testid="gear-alternative-calendar">
          <Calendar month={month} onMonthChange={onMonthChange} start={start} end={end} unavailable={new Set()} onPick={onPick} touchFriendly />
        </div>
        <p className="rounded-xl border border-white/[.07] bg-black/20 px-3 py-2.5 text-[11px] leading-4 text-white/55">Exact pickup and return times are chosen at checkout.</p>

        {sourceInCart ? (
          <div role="status" className="rounded-xl border border-amber-200/20 bg-amber-200/[.06] p-3 text-xs leading-5 text-amber-100/80">
            This listing is already in your kit and can’t be booked online. <a href="/cart" className="ml-1 underline underline-offset-2">Remove it in your kit</a> before checking alternatives.
          </div>
        ) : !dateWindowReady ? (
          <p className="rounded-xl border border-white/[.07] bg-white/[.025] px-3 py-3 text-xs text-white/55" role="status">{start && end ? "Choose dates no more than 365 days apart." : start ? "Choose an end date to check alternatives." : "Choose dates to check current availability and price."}</p>
        ) : cart.items.length >= 100 ? (
          <p role="status" className="rounded-xl border border-amber-200/20 bg-amber-200/[.06] p-3 text-xs text-amber-100/80">Your kit is full. Remove an item before adding alternatives.</p>
        ) : loading ? (
          <div role="status" aria-live="polite" className="rounded-xl border border-accent-200/15 bg-accent-200/[.05] p-3 text-xs text-white/65">Checking live stock and price…</div>
        ) : displayResult?.status === "refresh_required" ? (
          <div className="rounded-xl border border-amber-200/20 bg-amber-200/[.05] p-3">
            <p role="status" className="text-xs text-amber-100/80">Live stock is refreshing. No availability is shown yet.</p>
            <button type="button" onClick={() => setRetry((value) => value + 1)} className="mt-3 min-h-11 rounded-full border border-amber-100/25 px-4 text-xs font-medium text-amber-50 hover:bg-amber-100/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-100">Check again</button>
          </div>
        ) : error ? (
          <div className="rounded-xl border border-amber-200/20 bg-amber-200/[.05] p-3">
            <p role="alert" className="text-xs text-amber-100/80">{error}</p>
            <button type="button" onClick={() => setRetry((value) => value + 1)} className="mt-3 min-h-11 rounded-full border border-amber-100/25 px-4 text-xs font-medium text-amber-50 hover:bg-amber-100/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-100">Retry check</button>
          </div>
        ) : displayResult?.status === "ready" ? (
          <div aria-live="polite" className="space-y-3">
            {options.length ? options.map((option, index) => {
              const reason = blockReason(option.items);
              return (
                <article key={option.id} data-testid="alternative-option" className="rounded-xl border border-white/10 bg-gradient-to-br from-white/[.065] to-white/[.02] p-3 shadow-inner shadow-white/[.015]">
                  <div className="flex items-start justify-between gap-3">
                    <div><p className="text-[10px] uppercase tracking-[.12em] text-accent-200/75">{index ? "Available match" : "Closest available match"}</p><p className="mt-1 text-sm font-semibold text-white">{option.items.length === 1 ? option.items[0].title : `${option.items.length} items · complete alternative set`}</p></div>
                    <div className="shrink-0 text-right"><p className="text-sm font-semibold text-white">{formatGbp(option.total)}</p><p className="text-[10px] text-white/45">{option.items[0]?.days} days</p></div>
                  </div>
                  <div className="mt-3 flex gap-2 overflow-x-auto pb-1">
                    {option.items.map((item, itemIndex) => <div key={`${item.listingId}-${itemIndex}`} className="flex min-w-0 flex-1 items-center gap-2 rounded-lg border border-white/[.07] bg-black/20 p-2">
                      <SmartImage fit="contain" src={item.heroImage} fallbackSources={item.imageSources} alt={item.title} className="h-14 w-16 shrink-0 rounded-md bg-black/30" />
                      <div className="min-w-0"><p className="line-clamp-2 text-[11px] leading-4 text-white/85">{item.title}</p><p className="mt-1 text-[10px] text-white/45">{formatGbp(item.total)} · {item.days} days</p></div>
                    </div>)}
                  </div>
                  <button type="button" data-testid="add-available-alternative" disabled={loading || !!reason} onClick={() => void addFreshOption(option.id)} className="mt-3 min-h-11 w-full rounded-xl bg-gradient-to-r from-accent-400 to-accent-300 px-4 text-xs font-semibold text-charcoal-950 shadow-[0_6px_22px_rgba(225,165,100,.18)] transition hover:brightness-110 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-200 disabled:cursor-not-allowed disabled:opacity-45">{loading ? "Refreshing quote…" : reason || (option.items.length > 1 ? "Add this available set" : "Add alternative to kit")}</button>
                </article>
              );
            }) : singles.length ? (
              <div className="space-y-2">
                <p className="text-[10px] font-semibold uppercase tracking-[.12em] text-white/45">Available separately · not a full set</p>
                {singles.map((item) => {
                  const reason = blockReason([item]);
                  return <article key={item.listingId} className="flex items-center gap-3 rounded-xl border border-white/10 bg-white/[.035] p-3">
                    <SmartImage fit="contain" src={item.heroImage} fallbackSources={item.imageSources} alt={item.title} className="h-16 w-20 shrink-0 rounded-lg bg-black/30" />
                    <div className="min-w-0 flex-1"><p className="line-clamp-2 text-xs font-medium text-white/90">{item.title}</p><p className="mt-1 text-[10px] text-emerald-200">Available · {formatGbp(item.total)} for {item.days} days</p></div>
                    <button type="button" disabled={loading || !!reason} onClick={() => void addFreshOption(item.listingId, true)} className="min-h-11 shrink-0 rounded-lg border border-white/15 px-3 text-[10px] font-semibold text-white hover:border-accent-200/40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-200 disabled:opacity-40">{loading ? "Checking…" : reason || "Add one"}</button>
                  </article>;
                })}
              </div>
            ) : <div className="rounded-xl border border-white/[.07] bg-white/[.025] p-3"><p className="text-xs text-white/65">{displayResult.searchLimited ? "No complete match found. Try another date range or ask Gaffer." : "No compatible alternatives are available for these dates. Try another date range."}</p></div>}
            {added && <p data-testid="alternative-added" role="status" className="rounded-xl border border-emerald-200/20 bg-emerald-200/[.06] p-3 text-xs text-emerald-100">{added} <a href="/cart" className="ml-1 underline underline-offset-2">Review kit</a></p>}
            {error && <p role="alert" className="rounded-lg bg-amber-200/[.06] p-3 text-xs text-amber-100/80">{error}</p>}
            <button type="button" onClick={() => setRetry((value) => value + 1)} className="min-h-11 w-full rounded-lg border border-white/[.09] text-[11px] text-white/55 hover:border-white/20 hover:text-white/80 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-200">Refresh availability</button>
          </div>
        ) : error ? (
          <div className="rounded-xl border border-amber-200/20 bg-amber-200/[.05] p-3"><p role="alert" className="text-xs text-amber-100/80">{error}</p><button type="button" onClick={() => setRetry((value) => value + 1)} className="mt-3 min-h-10 rounded-full border border-amber-100/25 px-4 text-xs text-amber-50">Retry check</button></div>
        ) : null}
      </div>
    </section>
  );
}
