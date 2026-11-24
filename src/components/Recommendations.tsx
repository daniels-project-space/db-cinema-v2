"use client";
import { useLiveRecommendations } from "@/components/useLiveRecommendations";
import { SmartImage } from "@/components/SmartImage";

import { useState, useEffect, useRef } from "react";
import { liveWindow, stockLines } from "@/lib/liveRecommendations";
import { automaticRecommendation } from "../../shared/recommendationPolicy";
import { useAction, useConvex, useQuery } from "convex/react";
import { api } from "@cvx/_generated/api";
import { formatGbp, formatRate } from "@/lib/pricing";
import { useCart } from "@/components/cart/CartProvider";
import { useAccount } from "@/components/account/AccountProvider";
import { addDaysIso, dayMs } from "@/lib/dates";
import { rentalPricingDays } from "../../shared/rentalDuration";
import { IconCheck, IconPlus } from "@/components/icons";

type PricedRecommendation = { id: string; total: number; dailyRate: number };
type RecommendationPreview = { key: string; items: PricedRecommendation[]; total: number; saving: number; days: number };

export function Recommendations({
  slug,
  start,
  end,
  days,
  title = "Frequently rented together",
}: {
  slug?: string;
  start: string | null;
  end: string | null;
  days: number;
  title?: string;
}) {
  const cart = useCart();
  const account = useAccount();
  const convex = useConvex();
  const priceQuote = useAction(api.checkout.priceQuote);
  const cartIds = cart.items.map((i) => i.listingId as any);
  const seeds =
    useQuery(api.recommendations.forContext, {
      slug,
      cartListingIds: cartIds,
      limit: 8,
    }) ?? [];
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [extraDays, setExtraDays] = useState(0);
  const [preview, setPreview] = useState<RecommendationPreview | null>(null);
  const [quoteLoading, setQuoteLoading] = useState(false);
  const [quoteError, setQuoteError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);
  const quoteRequest = useRef(0);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const listing=useQuery(api.catalog.getListingBySlug,slug?{slug}:"skip");
  const reference=cart.items.find(item=>(!slug||item.slug===slug)&&item.start===start&&item.end===end&&item.pickupTime&&item.returnTime);
  const types=[...new Set(seeds.map(r=>r.itemType??"accessory"))];
  const live:any=useLiveRecommendations(types.length?{groups:types.map(type=>({key:type,types:[type],...liveWindow({start,end,pickupTime:reference?.pickupTime,returnTime:reference?.returnTime})})),basket:stockLines(cart.items),selectedIds:listing&&!cartIds.includes(listing._id)?[listing._id]:[]}:null);
  const recs:any[]=[];
  if(live){
    const groups=types.map(type=>live.groups[type]?.options??[]);
    const context=[...live.basket,...live.selected];
    for(let round=0;round<36&&recs.length<8;round++)for(const group of groups){
      const option=group[round];
      if(option&&option.available!==false&&option.automaticEligible&&automaticRecommendation(option,[...context,...recs],live.compatibilityKits))recs.push(option);
      if(recs.length===8)break;
    }
  }
  const recKey=recs.map(r=>r._id).join(",");
  useEffect(()=>{setSelected(previous=>{const next=new Set([...previous].filter(id=>recs.some(r=>r._id===id)));return next.size===previous.size?previous:next;});},[recKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const haveDates = !!(start && end && days > 0);
  const offerEnd = haveDates ? addDaysIso(end!, extraDays) : null;
  const offerDays = haveDates ? rentalPricingDays(dayMs(start!), dayMs(offerEnd!), reference?.pickupTime, reference?.returnTime) : days;
  const selectedRecs = recs.filter((r) => selected.has(r._id));
  const selectedKey = selectedRecs.map((r) => r._id).join(",");
  const basketAvailabilityLines = cart.items.map((item) => ({ listingId: item.listingId as any, start: dayMs(item.start), end: dayMs(item.end), qty: 1, pickupTime: item.pickupTime || undefined, returnTime: item.returnTime || undefined }));
  const selectedAvailability = useQuery(api.availability.forCart, haveDates && offerEnd && selectedRecs.length ? { items: [...basketAvailabilityLines, ...selectedRecs.map((r) => ({ listingId: r._id as any, start: dayMs(start!), end: dayMs(offerEnd), qty: 1, pickupTime: reference?.pickupTime, returnTime: reference?.returnTime }))] } : "skip");
  const availabilityStamp = JSON.stringify(selectedAvailability ?? null);
  const quoteKey = JSON.stringify({ selectedKey, start, offerEnd, pickupTime: reference?.pickupTime, returnTime: reference?.returnTime, basket: cart.items.map((item) => [item.listingId, item.start, item.end, item.pickupTime, item.returnTime]), membership: cart.membership, promo: cart.promo, email: account.me?.email, token: account.token, availabilityStamp });
  const latestQuoteKey = useRef(quoteKey);
  latestQuoteKey.current = quoteKey;

  async function getPreview(items: any[], rentalEnd: string, requestKey: string, includeDailyBaseline: boolean) {
    const availabilityItems = [...cart.items.map((item) => ({ listingId: item.listingId as any, start: dayMs(item.start), end: dayMs(item.end), qty: 1, pickupTime: item.pickupTime || undefined, returnTime: item.returnTime || undefined })), ...items.map((r) => ({
      listingId: r._id as any,
      start: dayMs(start!),
      end: dayMs(rentalEnd),
      qty: 1,
      pickupTime: reference?.pickupTime,
      returnTime: reference?.returnTime,
    }))];
    const availability = await convex.query(api.availability.forCart, { items: availabilityItems });
    const unavailable = items.find((r) => availability[String(r._id)]?.ok !== true);
    if (unavailable) throw new Error(`${unavailable.title} is not available for those dates. Try another item or a shorter rental.`);
    const unavailableBasketLine = cart.items.find((item) => availability[String(item.listingId)]?.ok !== true);
    if (unavailableBasketLine) throw new Error(`Your basket availability changed for ${unavailableBasketLine.title}. Review your basket before adding more gear.`);
    const args = {
      items: items.map((r) => ({
        listingId: r._id as any,
        title: r.title,
        start: dayMs(start!),
        end: dayMs(rentalEnd),
        pickupTime: reference?.pickupTime,
        returnTime: reference?.returnTime,
        qty: 1,
        total: 0,
        deposit: r.depositAmount,
      })),
      customerEmail: account.me?.email ?? "",
      token: account.token && account.me ? account.token : undefined,
      selectedMembership: cart.membership ? { tier: cart.membership.tier, intro: cart.membership.intro } : undefined,
      fulfilment: "pickup" as const,
      promoCode: cart.promo ?? undefined,
      protection: "verify" as const,
    };
    const [quoted, daily] = await Promise.all([
      priceQuote(args),
      includeDailyBaseline
        ? priceQuote({
            ...args,
            items: args.items.map((item) => ({ ...item, end: dayMs(start!), pickupTime: undefined, returnTime: undefined })),
          })
        : Promise.resolve(null),
    ]);
    if (quoted.items.length !== items.length || (daily && daily.items.length !== items.length))
      throw new Error("The live rental quote changed. Please select the items again.");
    const total = quoted.items.reduce((sum, item) => sum + item.total, 0);
    const baseline = daily ? daily.items.reduce((sum, item) => sum + item.total, 0) * rentalPricingDays(dayMs(start!), dayMs(rentalEnd), reference?.pickupTime, reference?.returnTime) : total;
    const saving = Math.max(0, Math.round((baseline - total) * 100) / 100);
    return {
      key: requestKey,
      items: quoted.items.map((item, index) => ({ id: items[index]._id, total: item.total, dailyRate: item.dailyRate })),
      total,
      saving,
      days: rentalPricingDays(dayMs(start!), dayMs(rentalEnd), reference?.pickupTime, reference?.returnTime),
    } satisfies RecommendationPreview;
  }

  useEffect(() => {
    if (!haveDates || !offerEnd || selectedRecs.length === 0) {
      setPreview(null);
      setQuoteLoading(false);
      setQuoteError(null);
      return;
    }
    const requestId = ++quoteRequest.current;
    setPreview(null);
    setQuoteError(null);
    setQuoteLoading(true);
    const timer = setTimeout(() => {
      void getPreview(selectedRecs, offerEnd, quoteKey, true)
        .then((result) => {
          if (requestId === quoteRequest.current) setPreview(result);
        })
        .catch((reason) => {
          if (requestId === quoteRequest.current) setQuoteError(reason instanceof Error ? reason.message : "Could not check this rental price.");
        })
        .finally(() => {
          if (requestId === quoteRequest.current) setQuoteLoading(false);
        });
    }, 250);
    return () => {
      clearTimeout(timer);
      if (requestId === quoteRequest.current) quoteRequest.current++;
    };
  }, [quoteKey, selectedKey, haveDates, offerEnd]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    setExtraDays(0);
  }, [start, end, reference?.pickupTime, reference?.returnTime]);

  if (recs.length === 0) return null;

  const toggle = (id: string) =>
    setSelected((s) => {
      const n = new Set(s);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });

  async function addSelected() {
    if (!haveDates || !offerEnd || selectedRecs.length === 0 || adding) return;
    setAdding(true);
    setAddError(null);
    try {
      const result = await getPreview(selectedRecs, offerEnd, quoteKey, false);
      if (!mounted.current) return;
      if (latestQuoteKey.current !== quoteKey) throw new Error("Your dates or basket changed. Review the updated quote and try again.");
      if (result.items.length !== selectedRecs.length) throw new Error("The live quote could not be matched to all selected items.");
      for (const r of selectedRecs) {
        const line = result.items.find((item) => item.id === r._id);
        if (!line || !Number.isFinite(line.total) || !Number.isFinite(line.dailyRate)) throw new Error(`The price for ${r.title} could not be verified.`);
        cart.add({
          listingId: r._id,
          slug: r.slug,
          title: r.title,
          heroImage: r.heroImage,
          start: start!,
          end: offerEnd,
          pickupTime: reference?.pickupTime,
          returnTime: reference?.returnTime,
          days: result.days,
          perDay: line.dailyRate,
          total: line.total,
          deposit: r.depositAmount,
        });
      }
      setSelected(new Set());
      setExtraDays(0);
    } catch (reason) {
      if (mounted.current) setAddError(reason instanceof Error ? reason.message : "Could not add the selected items. Please try again.");
    } finally {
      if (mounted.current) setAdding(false);
    }
  }

  return (
    <section className="mt-14">
      <div className="hud-label mb-2 !text-accent-400/90">Complete your kit</div>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h2 className="font-display text-2xl font-bold text-white/90">{title}</h2>
        <button
          onClick={() => void addSelected()}
          disabled={selected.size === 0 || !haveDates || quoteLoading || adding || preview?.key !== quoteKey || !!quoteError}
          className="btn-primary px-5 py-2 text-sm"
        >
          {!haveDates ? "Pick dates to add" : adding ? "Checking & adding…" : quoteLoading && selected.size ? "Checking live price…" : `Add ${selected.size || ""} to kit`.trim()}
        </button>
      </div>
      {haveDates && <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-accent-300/15 bg-white/[.025] px-4 py-3" data-testid="recommendation-duration-offer">
        <div className="min-w-0">
          <p className="text-xs font-semibold text-white/85">Multi-day rental</p>
          <p className="mt-0.5 text-[11px] text-white/50">Extend selected add-ons; live pricing and availability update together.</p>
        </div>
        <div className="flex items-center gap-2 rounded-full border border-white/10 bg-black/20 p-1">
          <button type="button" aria-label="Shorten add-on rental by one day" data-testid="recommendation-day-minus" disabled={extraDays <= 0 || adding} onClick={() => setExtraDays((value) => Math.max(0, value - 1))} className="grid h-8 w-8 place-items-center rounded-full text-lg text-white/75 transition hover:bg-white/10 disabled:opacity-35">−</button>
          <span className="min-w-[5.5rem] text-center text-xs font-medium text-white" data-testid="recommendation-rental-days">{offerDays} day{offerDays === 1 ? "" : "s"}</span>
          <button type="button" aria-label="Extend add-on rental by one day" data-testid="recommendation-day-plus" disabled={adding} onClick={() => setExtraDays((value) => value + 1)} className="grid h-8 w-8 place-items-center rounded-full text-lg text-accent-200 transition hover:bg-accent-300/10 disabled:opacity-35">+</button>
        </div>
        {selectedRecs.length > 0 && <div className="w-full border-t border-white/[.08] pt-2 text-xs" aria-live="polite" data-testid="recommendation-duration-quote" data-total={preview?.key === quoteKey ? preview.total : undefined} data-saving={preview?.key === quoteKey ? preview.saving : undefined}>
          {quoteLoading ? <span className="text-white/55">Checking the live multi-day price…</span> : quoteError ? <span className="text-amber-200">{quoteError}</span> : preview?.key === quoteKey ? <span className="flex flex-wrap items-center gap-x-3 gap-y-1 text-white/70"><span>{preview.days}-day gear subtotal · <strong className="text-white">{formatGbp(preview.total)}</strong></span>{preview.saving > 0 && <span className="font-medium text-emerald-200">Save {formatGbp(preview.saving)} vs daily rate</span>}<span className="w-full text-white/50">Basket discounts and fees are calculated at checkout.</span></span> : <span className="text-white/55">Select an item to check its live price.</span>}
        </div>}
      </div>}
      {addError && <p role="alert" className="mt-3 text-xs text-amber-200">{addError}</p>}
      <div className="mt-5 grid grid-cols-2 gap-4 md:grid-cols-4">
        {recs.map((r) => {
          const on = selected.has(r._id);
          const quotedItem = preview?.key === quoteKey ? preview.items.find((item) => item.id === r._id) : null;
          return (
            <button
              key={r._id}
              onClick={() => toggle(r._id)}
              disabled={adding}
              aria-pressed={on}
              className={`group relative flex flex-col overflow-hidden rounded-2xl text-left transition-all ${
                on ? "spot ring-2 ring-accent-400" : "spot gradient-border"
              }`}
            >
              <span
                className={`absolute right-2 top-2 z-10 flex h-6 w-6 items-center justify-center rounded-full transition-colors ${
                  on ? "bg-accent-500 text-white" : "bg-black/40 text-white/50 group-hover:text-white"
                }`}
              >
                {on ? <IconCheck className="h-3 w-3" /> : <IconPlus className="h-3 w-3" />}
              </span>
              <div className="aspect-[4/3] overflow-hidden bg-charcoal-800">
                <SmartImage fit="contain" src={r.heroImage} fallbackSources={r.imageSources} alt={r.title} className="h-full w-full" />
              </div>
              <div className="flex flex-1 flex-col gap-1 p-3">
                <span className="hud-label !text-accent-400/90">
                  {r.itemType?.replace("-", " ")}
                </span>
                <span className="line-clamp-2 text-xs text-white/70">{r.title}</span>
                <span className="mt-auto pt-1 text-sm text-accent-400">
                  {quotedItem ? <>{formatGbp(quotedItem.dailyRate)}<span className="text-xs text-white/35">/day</span><span className="ml-1 text-xs text-white/55">· {formatGbp(quotedItem.total)} total</span></> : <>{formatRate(r.pricing.daily)}<span className="text-xs text-white/35">/day</span></>}
                </span>
              </div>
            </button>
          );
        })}
      </div>
    </section>
  );
}
