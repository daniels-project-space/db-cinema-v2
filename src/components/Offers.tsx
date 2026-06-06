"use client";

import { useQuery } from "convex/react";
import { api } from "@cvx/_generated/api";
import { useCart } from "@/components/cart/CartProvider";

const ms = (iso: string) => Date.parse(iso + "T00:00:00Z");

export function Offers() {
  const cart = useCart();
  const items = cart.items.map((i) => ({
    listingId: i.listingId as any,
    start: ms(i.start),
    end: ms(i.end),
    total: i.total,
  }));
  const offers = useQuery(api.offers.forCart, items.length ? { items } : "skip") ?? [];
  if (offers.length === 0) return null;

  const iso = (m: number) => new Date(m).toISOString().slice(0, 10);

  return (
    <section className="mt-8">
      <div className="mb-3 text-xs uppercase tracking-widest text-accent-400">
        Exclusive add-on offers
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        {offers.map((o) => (
          <div
            key={o.offerType}
            className="flex gap-4 rounded-2xl border border-emerald-400/25 bg-emerald-400/[0.06] p-4"
          >
            <div className="h-20 w-20 shrink-0 overflow-hidden rounded-lg bg-charcoal-800">
              {o.heroImage ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={o.heroImage} alt={o.title} className="h-full w-full object-cover" />
              ) : null}
            </div>
            <div className="flex min-w-0 flex-1 flex-col">
              <span className="inline-block w-fit rounded bg-emerald-500/20 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-300">
                {o.pct}% off · {o.reason}
              </span>
              <span className="mt-1 line-clamp-1 text-sm text-white/85">{o.title}</span>
              <div className="mt-1 text-sm">
                <span className="text-emerald-300 font-display text-lg font-bold">£{o.total}</span>
                <span className="ml-2 text-white/30 line-through">£{o.regularTotal}</span>
                <span className="ml-1 text-xs text-white/35">/ {o.days}d</span>
              </div>
              <button
                onClick={() =>
                  cart.add({
                    listingId: o.listingId,
                    slug: o.slug,
                    title: o.title,
                    heroImage: o.heroImage,
                    start: iso(o.start),
                    end: iso(o.end),
                    days: o.days,
                    perDay: o.perDay,
                    total: o.total,
                    deposit: o.deposit,
                    offerType: o.offerType,
                  })
                }
                className="mt-2 w-fit rounded-full bg-emerald-500 px-4 py-1.5 text-xs font-medium text-white hover:bg-emerald-600"
              >
                Add at {o.pct}% off
              </button>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
