"use client";

import Link from "next/link";

export type GearListing = {
  _id: string;
  slug: string;
  title: string;
  category: string;
  heroImage: string | null;
  pricing: { daily: number; day3?: number; day7?: number };
  depositAmount: number;
  minimumRentalDays: number;
};

export function GearCard({ listing }: { listing: GearListing }) {
  const { slug, title, category, heroImage, pricing } = listing;
  return (
    <Link
      href={`/gear/${slug}`}
      className="group glass glass-hover gradient-border flex flex-col overflow-hidden rounded-2xl"
    >
      <div className="aspect-[4/3] overflow-hidden bg-charcoal-800">
        {heroImage ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={heroImage}
            alt={title}
            loading="lazy"
            className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-white/20">
            <span className="text-3xl">🎬</span>
          </div>
        )}
      </div>
      <div className="flex flex-1 flex-col gap-2 p-4">
        <span className="text-xs uppercase tracking-widest text-accent-400">
          {category}
        </span>
        <h3 className="line-clamp-2 flex-1 text-sm text-white/80">{title}</h3>
        <div className="flex items-baseline gap-1">
          <span className="font-display text-2xl font-bold text-accent-400">
            £{pricing.daily}
          </span>
          <span className="text-sm text-white/40">/day</span>
          {pricing.day7 ? (
            <span className="ml-auto text-xs text-white/35">
              £{pricing.day7}/day for 7+
            </span>
          ) : null}
        </div>
      </div>
    </Link>
  );
}
