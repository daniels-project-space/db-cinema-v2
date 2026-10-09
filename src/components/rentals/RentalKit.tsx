"use client";

import { SmartImage } from "@/components/SmartImage";
import { rentalClockLabel } from "../../../shared/rentalHandover";
import { rentalTitle } from "@/lib/rentalPresentation";
import { formatGbp } from "@/lib/pricing";
import { groupRentalKit, uniqueKitPhotos, type RentalKitItem } from "@/lib/rentalKit";

/** Full image frames; quantity represents repeated items, never repeated pictures. */
export function RentalKit({ items, compact = false, prices = false, showcase = false }: { items: RentalKitItem[]; compact?: boolean; prices?: boolean; showcase?: boolean }) {
  const grouped = groupRentalKit(items);
  const units = grouped.reduce((n, item) => n + (item.qty ?? 1), 0);
  const photos = uniqueKitPhotos(grouped);
  const visible = photos.slice(0, compact || showcase ? 1 : 3);
  return <div className="min-w-0">
    <div className={compact ? "flex items-center gap-4" : "flex gap-2"}>
      {visible.map((item, i) => <div key={i} className={`management-kit-image relative overflow-hidden rounded-2xl ${compact ? "h-24 w-28 shrink-0" : "min-w-0 flex-1"}`}>
        <SmartImage src={item.heroImage} fallbackSources={item.imageSources} alt={item.title} className={compact ? "h-full w-full" : visible.length === 1 ? "aspect-[16/10] w-full" : "aspect-[4/5] w-full"} />
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent" />
        {(item.qty ?? 1) > 1 && <span className="absolute right-2 top-2 rounded-full bg-black/75 px-2 py-1 text-[10px] font-semibold text-white">×{item.qty}</span>}
        {!compact && <p title={item.title} className="absolute bottom-3 left-3 right-3 line-clamp-2 text-xs font-medium leading-5 text-white">{rentalTitle(item.title)}</p>}
      </div>)}
      {compact && <div className="min-w-0"><p className="text-sm font-medium leading-6 text-white/85">{rentalTitle(grouped[0]?.title ?? "Rental kit")}</p><p className="mt-1 text-xs text-white/40">{grouped.length > 1 ? `+${grouped.length - 1} more listings` : `${units} ${units === 1 ? "unit" : "units"}`}</p></div>}
    </div>
    {showcase && photos.length > 1 && <div aria-label="More equipment in this rental" className="mt-2 grid grid-cols-3 gap-2">
      {photos.slice(1, 4).map((item, i) => <div key={i} className="min-w-0">
        <SmartImage src={item.heroImage} fallbackSources={item.imageSources} alt={item.title} className="aspect-[4/3] rounded-lg" />
        <p title={item.title} className="mt-1 line-clamp-2 text-[10px] leading-4 text-white/55">{rentalTitle(item.title)}{(item.qty ?? 1) > 1 ? ` ×${item.qty}` : ""}</p>
      </div>)}
    </div>}
    <details className="group mt-3">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-2 text-xs text-white/45 hover:text-white">
        <span>{units} {units === 1 ? "item" : "items"} in kit{photos.length > visible.length ? ` · +${photos.length - visible.length} more` : ""}</span><span className="group-open:hidden">View all ↗</span><span className="hidden group-open:inline">Close −</span>
      </summary>
      <ul className="mt-2 divide-y divide-white/[0.06]">
        {grouped.map((item, i) => <li key={i} className="flex items-start gap-3 py-3">
          <span className="min-w-0 flex-1 text-xs leading-5 text-white/75">{item.title}{item.start != null && item.end != null && <span className="mt-1 block text-[10px] text-white/35">{new Date(item.start).toLocaleDateString("en-GB",{timeZone:"UTC",day:"numeric",month:"short"})} – {new Date(item.end).toLocaleDateString("en-GB",{timeZone:"UTC",day:"numeric",month:"short"})}</span>}{item.start != null && item.end != null && <span className="mt-1 block text-[10px] text-white/50">Pickup {rentalClockLabel(item.pickupTime)} · Return {rentalClockLabel(item.returnTime)}</span>}</span>
          <span className="shrink-0 text-xs text-white/40">×{item.qty ?? 1}</span>
          {prices && item.lineTotal != null && <span className="shrink-0 text-xs text-white/65">{formatGbp(item.lineTotal)}</span>}
        </li>)}
      </ul>
    </details>
  </div>;
}
