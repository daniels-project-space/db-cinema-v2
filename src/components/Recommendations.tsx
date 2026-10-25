"use client";
import { useLiveRecommendations } from "@/components/useLiveRecommendations";
import { SmartImage } from "@/components/SmartImage";

import { useState, useEffect } from "react";
import { liveWindow, stockLines } from "@/lib/liveRecommendations";
import { automaticRecommendation } from "../../shared/recommendationPolicy";
import { useQuery } from "convex/react";
import { api } from "@cvx/_generated/api";
import { quote as computeQuote } from "@/lib/pricing";
import { useCart } from "@/components/cart/CartProvider";
import { IconCheck, IconPlus } from "@/components/icons";

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
  const cartIds = cart.items.map((i) => i.listingId as any);
  const seeds =
    useQuery(api.recommendations.forContext, {
      slug,
      cartListingIds: cartIds,
      limit: 8,
    }) ?? [];
  const [selected, setSelected] = useState<Set<string>>(new Set());
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

  if (recs.length === 0) return null;
  const haveDates = !!(start && end && days > 0);

  const toggle = (id: string) =>
    setSelected((s) => {
      const n = new Set(s);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });

  function addSelected() {
    if (!haveDates) return;
    for (const r of recs) {
      if (!selected.has(r._id)) continue;
      const q = computeQuote(r.pricing, days);
      cart.add({
        listingId: r._id,
        slug: r.slug,
        title: r.title,
        heroImage: r.heroImage,
        start: start!,
        end: end!,
        pickupTime: reference?.pickupTime, returnTime: reference?.returnTime,
        days,
        perDay: q.perDay,
        total: q.total,
        deposit: r.depositAmount,
      });
    }
    setSelected(new Set());
  }

  return (
    <section className="mt-14">
      <div className="hud-label mb-2 !text-accent-400/90">Complete your kit</div>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h2 className="font-display text-2xl font-bold text-white/90">{title}</h2>
        <button
          onClick={addSelected}
          disabled={selected.size === 0 || !haveDates}
          className="btn-primary px-5 py-2 text-sm"
        >
          {haveDates ? `Add ${selected.size || ""} to kit`.trim() : "Pick dates to add"}
        </button>
      </div>
      <div className="mt-5 grid grid-cols-2 gap-4 md:grid-cols-4">
        {recs.map((r) => {
          const on = selected.has(r._id);
          const q = days ? computeQuote(r.pricing, days) : null;
          return (
            <button
              key={r._id}
              onClick={() => toggle(r._id)}
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
                  £{r.pricing.daily}
                  <span className="text-xs text-white/35">/day</span>
                  {q && days ? <span className="ml-1 text-xs text-white/40">· £{q.total} total</span> : null}
                </span>
              </div>
            </button>
          );
        })}
      </div>
    </section>
  );
}
