"use client";

import { useState } from "react";
import { useQuery } from "convex/react";
import { api } from "@cvx/_generated/api";
import { quote as computeQuote } from "@/lib/pricing";
import { useCart } from "@/components/cart/CartProvider";

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
  const recs =
    useQuery(api.recommendations.forContext, {
      slug,
      cartListingIds: cartIds,
      limit: 8,
    }) ?? [];
  const [selected, setSelected] = useState<Set<string>>(new Set());

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
      <div className="mb-1 text-xs uppercase tracking-widest text-accent-400">
        Complete your kit
      </div>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h2 className="font-display text-2xl font-bold text-white/90">{title}</h2>
        <button
          onClick={addSelected}
          disabled={selected.size === 0 || !haveDates}
          className="rounded-full bg-accent-500 px-5 py-2 text-sm font-medium text-white transition-colors hover:bg-accent-600 disabled:cursor-not-allowed disabled:opacity-30"
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
                on ? "glass ring-2 ring-accent-400" : "glass glass-hover gradient-border"
              }`}
            >
              <span
                className={`absolute right-2 top-2 z-10 flex h-6 w-6 items-center justify-center rounded-full text-xs ${
                  on ? "bg-accent-500 text-white" : "bg-black/40 text-white/50"
                }`}
              >
                {on ? "✓" : "+"}
              </span>
              <div className="aspect-[4/3] overflow-hidden bg-charcoal-800">
                {r.heroImage ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={r.heroImage} alt={r.title} loading="lazy" className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105" />
                ) : null}
              </div>
              <div className="flex flex-1 flex-col gap-1 p-3">
                <span className="text-[10px] uppercase tracking-widest text-accent-400">
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
