"use client";

import { SmartImage } from "@/components/SmartImage";
import { groupRentalKit, uniqueKitPhotos, type RentalKitItem } from "@/lib/rentalKit";

export function CompactRentalImages({ items }: { items: RentalKitItem[] }) {
  const grouped = uniqueKitPhotos(groupRentalKit(items));
  if (!grouped.length) return null;
  return <div role="region" aria-label="Booked equipment images" tabIndex={0} className="flex min-w-0 gap-1.5 overflow-x-auto pb-1 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent-400">
    {grouped.map((item, index) => <div key={index} title={`${item.title}${(item.qty ?? 1) > 1 ? ` ×${item.qty}` : ""}`} className="relative h-10 w-10 shrink-0 overflow-hidden rounded-lg bg-white/[0.04]">
      <SmartImage fit="contain" src={item.heroImage} fallbackSources={item.imageSources} alt={item.title} className="h-full w-full" />
      {(item.qty ?? 1) > 1 && <span className="absolute bottom-0 right-0 rounded-tl bg-black/85 px-1 text-[9px] text-white">×{item.qty}</span>}
    </div>)}
  </div>;
}
