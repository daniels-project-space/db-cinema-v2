"use client";

import { SmartImage } from "@/components/SmartImage";

type OfferLine = {
  index?: number;
  lineIndex?: number;
  title?: string;
  qty?: number;
  end?: number | string;
  originalEnd?: number | string;
  dueAt?: number | string;
  proposedEnd?: number | string;
  extensionEnd?: number | string;
  returnTime?: string | null;
  originalReturnTime?: string | null;
  lineTotal?: number | string | null;
  total?: number | string | null;
  dailyRate?: number | string | null;
  days?: number | null;
  imageSources?: string[];
  heroImage?: string | null;
  image?: string | null;
  available?: boolean;
  status?: string;
  reason?: string;
  alternatives?: OfferLine[];
  availability?: "available" | "unchecked";
};

type ExtensionOffer = {
  bookingId?: string;
  quoteStatus?: string;
  total?: number | string | null;
  benefit?: string | { label?: string; saving?: number | string; amount?: number | string } | null;
  benefitSaving?: number | string | null;
  availableIndexes?: number[];
  items?: OfferLine[];
  availableItems?: OfferLine[];
  unavailableItems?: OfferLine[];
  alternatives?: OfferLine[];
};
type BookedItemPhoto = { index?: number; title: string; imageSources?: string[]; heroImage?: string | null };

const pounds = (value: unknown) => {
  const amount = typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : NaN;
  return Number.isFinite(amount) ? new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" }).format(amount) : null;
};

const dateLabel = (value: unknown) => {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const date = typeof value === "number" ? new Date(value) : new Date(/^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T12:00:00Z` : value);
  return Number.isNaN(date.getTime()) ? null : date.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
};

const lineIndex = (item: OfferLine, fallback: number) => Number.isSafeInteger(item.lineIndex) ? item.lineIndex! : Number.isSafeInteger(item.index) ? item.index! : fallback;
const lineImage = (item: OfferLine) => item.imageSources?.filter((value): value is string => typeof value === "string" && value.length > 0) ?? (item.heroImage || item.image ? [item.heroImage || item.image!] : []);

function OfferItem({ item, unavailable = false, unchecked = false, legacy = false, interactive = true, alternatives = [] }: { item: OfferLine; unavailable?: boolean; unchecked?: boolean; legacy?: boolean; interactive?: boolean; alternatives?: OfferLine[] }) {
  const due = dateLabel(item.originalEnd ?? item.dueAt ?? item.end);
  const proposed = dateLabel(item.proposedEnd ?? item.extensionEnd);
  const amount = pounds(item.lineTotal ?? item.total);
  const sources = lineImage(item);
  return <article data-testid="extension-offer-item" data-offer-status={unavailable ? "unavailable" : unchecked ? "unchecked" : "available"} className={`min-w-0 rounded-xl border p-2.5 ${unavailable ? "border-amber-200/15 bg-amber-100/[0.035]" : "border-white/[0.08] bg-black/15"}`}>
    <div className="flex min-w-0 items-center gap-2.5">
      {sources.length > 0 && <SmartImage src={sources[0]} fallbackSources={sources.slice(1)} alt={`${item.title ?? "Rental item"} listing photo`} className="h-12 w-14 shrink-0 rounded-lg border border-white/10 bg-black/20 object-contain" />}
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1"><strong className="min-w-0 break-words text-[11px] leading-snug text-white/85">{item.qty ? `${item.qty}× ` : ""}{item.title ?? "Rental item"}</strong><span className={`rounded-full border px-2 py-0.5 text-[9px] ${unavailable ? "border-amber-200/20 text-amber-100/75" : unchecked ? "border-white/15 text-white/50" : "border-emerald-200/15 text-emerald-100/75"}`}>{unavailable ? "Unavailable" : unchecked ? "Choose days" : "Available to request"}</span></div>
        {unavailable
          ? <p className="mt-1 text-[10px] leading-relaxed text-amber-100/65">Return as planned · {due ?? "original return date"}{item.originalReturnTime || item.returnTime ? ` · ${item.originalReturnTime ?? item.returnTime}` : ""}</p>
          : unchecked
            ? <p className="mt-1 text-[10px] leading-relaxed text-white/45">Original return · {due ?? "date to confirm"}{item.originalReturnTime || item.returnTime ? ` · ${item.originalReturnTime ?? item.returnTime}` : ""}</p>
          : <p className="mt-1 text-[10px] leading-relaxed text-white/45">{due ? `${legacy ? "Original" : "Current"} return ${due}${(item.originalReturnTime ?? item.returnTime) ? ` · ${item.originalReturnTime ?? item.returnTime}` : ""}` : "Current return unchanged"}{proposed ? ` · proposed ${proposed}${item.returnTime ? ` at ${item.returnTime}` : ""}` : ""}</p>}
        {!unavailable && !unchecked && <div className="mt-1 flex flex-wrap items-center gap-x-2 text-[10px] text-white/45">{item.days ? <span>{item.days} extra day{item.days === 1 ? "" : "s"}</span> : null}{amount && <strong className="text-xs font-semibold text-white/85">{amount}</strong>}</div>}
        {unavailable && item.reason && <p className="mt-1 text-[10px] leading-relaxed text-white/40">{item.reason}</p>}
      </div>
    </div>
    {alternatives.length > 0 && <div className="mt-2.5 border-t border-white/[0.07] pt-2">
          <p className="mb-1.5 text-[9px] font-medium uppercase tracking-[.12em] text-sky-100/55">Available when checked · not reserved</p>
      <div className="grid gap-1.5 sm:grid-cols-2">{alternatives.slice(0, 3).map((alternative, index) => {
        const alternativeSources = lineImage(alternative);
        const price = pounds(alternative.total ?? alternative.lineTotal);
        return <div key={`${alternative.title ?? "alternative"}-${index}`} className="flex min-w-0 items-center gap-2 rounded-lg border border-sky-100/[0.09] bg-sky-100/[0.025] p-2">
          {alternativeSources.length > 0 && <SmartImage src={alternativeSources[0]} fallbackSources={alternativeSources.slice(1)} alt={`${alternative.title ?? "Alternative"} listing photo`} className="h-9 w-10 shrink-0 rounded-md border border-white/10 bg-black/20 object-contain" />}
              <div className="min-w-0 flex-1"><p className="truncate text-[10px] text-white/75">{alternative.title ?? "Alternative item"}</p><p className="text-[9px] text-white/40">{price ? `${price} extension estimate` : "Ask us about this option"}</p></div>
              {interactive && <button type="button" data-testid={`extension-offer-ask-alt-${index}`} aria-label={`Ask the team about ${alternative.title ?? "this alternative"} for this extension`} className="shrink-0 rounded-lg border border-sky-100/15 px-2 py-1.5 text-[9px] font-medium text-sky-100/85 transition hover:bg-sky-100/[0.08]" onClick={() => window.dispatchEvent(new CustomEvent("dbc:prefill-rental-message", { detail: { text: `Could you check whether ${alternative.title} can replace ${item.title} during my extension? I understand this suggestion is not reserved and my original return deadline stays in place until you confirm.` } }))}>Ask team</button>}
        </div>;
      })}</div>
    </div>}
  </article>;
}

export function GafferExtensionOfferCard({ offer, legacy = false, interactive = true, bookingItems = [] }: { offer: ExtensionOffer; legacy?: boolean; interactive?: boolean; bookingItems?: BookedItemPhoto[] }) {
  const items = Array.isArray(offer.items) ? offer.items : [];
  const availableIndexes = Array.isArray(offer.availableIndexes) ? new Set(offer.availableIndexes) : null;
  const unavailableItems = Array.isArray(offer.unavailableItems) ? offer.unavailableItems : [];
  const unavailableWithPhotos = unavailableItems.map((item, index) => {
    if (lineImage(item).length) return item;
    const itemPosition = lineIndex(item, index);
    const bookedItem = bookingItems.find(row => row.index === itemPosition) ?? bookingItems.find(row => row.title === item.title);
    return bookedItem ? { ...item, imageSources: bookedItem.imageSources, heroImage: bookedItem.heroImage } : item;
  });
  const unchecked = offer.quoteStatus === "duration_required";
  const availableItems = unchecked ? [] : Array.isArray(offer.availableItems) ? offer.availableItems : availableIndexes
    ? items.filter((item, index) => availableIndexes.has(lineIndex(item, index)))
    : items.filter(item => item.available !== false && !["unavailable", "not_available"].includes(item.status ?? ""));
  const benefit = typeof offer.benefit === "string" ? offer.benefit : offer.benefit?.label;
  const saving = pounds((typeof offer.benefit === "object" ? offer.benefit?.saving ?? offer.benefit?.amount : undefined) ?? offer.benefitSaving);
  const total = pounds(offer.total);
  const statusLabel = offer.quoteStatus === "duration_required" ? "Choose duration to check" : unavailableItems.length || offer.quoteStatus === "partial" ? "Some items available" : offer.quoteStatus === "unavailable" ? "No items available" : offer.quoteStatus ? "Availability checked" : "Live stock check";
  const alternatives = Array.isArray(offer.alternatives) ? offer.alternatives : [];
  return <section data-testid="gaffer-extension-card" aria-label="Extension options for your rental" className="mt-3 overflow-hidden rounded-2xl border border-sky-200/15 bg-gradient-to-br from-sky-200/[0.09] via-white/[0.035] to-transparent p-3 shadow-[inset_0_1px_0_#ffffff0b] backdrop-blur-xl">
    <div className="flex flex-wrap items-start justify-between gap-2.5"><div><p className="text-[10px] font-medium uppercase tracking-[0.16em] text-sky-100/55">Your rental · extension</p><h4 className="mt-1 text-sm font-semibold text-white/90">{legacy ? "Check extra time" : "Extension estimate"}</h4></div><span className="rounded-full border border-sky-200/15 bg-sky-200/[0.07] px-2 py-1 text-[10px] text-sky-100/75">{statusLabel}</span></div>
    {total && <div className="mt-3 flex flex-wrap items-end justify-between gap-2 rounded-xl border border-sky-100/10 bg-black/15 px-3 py-2"><div><p className="text-[9px] uppercase tracking-[.13em] text-white/40">Proposed total · available items only</p>{benefit && <p className="mt-1 text-[10px] text-emerald-100/75">{benefit}{saving ? ` · saves ${saving}` : ""}</p>}{!benefit && saving && <p className="mt-1 text-[10px] text-emerald-100/75">Member saving · {saving}</p>}</div><strong className="text-lg font-semibold text-white">{total}</strong></div>}
    {!total && (benefit || saving) && <p className="mt-2 text-[10px] text-emerald-100/75">{benefit ?? "Member saving"}{saving ? ` · saves ${saving}` : ""}</p>}
    {unchecked && items.length > 0 && <div className="mt-3 grid gap-2 sm:grid-cols-2" data-testid="extension-offer-unchecked-items"><p className="sm:col-span-2 text-[10px] font-medium uppercase tracking-[.13em] text-white/45">Items in this rental · choose extra days to check</p>{items.slice(0, 6).map((item, index) => <OfferItem key={`unchecked-${lineIndex(item, index)}`} item={item} unchecked interactive={interactive} />)}</div>}
    {availableItems.length > 0 && <div className="mt-3 grid gap-2 sm:grid-cols-2" data-testid="extension-offer-available-items">{availableItems.slice(0, 6).map((item, index) => <OfferItem key={`available-${lineIndex(item, index)}`} item={item} legacy={legacy} interactive={interactive} />)}</div>}
    {unavailableWithPhotos.length > 0 && <div className="mt-3 space-y-2" data-testid="extension-offer-unavailable-items"><p className="text-[10px] font-medium uppercase tracking-[.13em] text-amber-100/70">Keep these on the original schedule</p>{unavailableWithPhotos.slice(0, 6).map((item, index) => <OfferItem key={`unavailable-${lineIndex(item, index)}`} item={item} unavailable interactive={interactive} alternatives={item.alternatives ?? alternatives.filter(candidate => candidate.lineIndex === item.lineIndex || candidate.index === item.index)} />)}</div>}
    {items.length > 6 && <p className="mt-2 text-[10px] text-white/40">+{items.length - 6} more items</p>}
    {offer.quoteStatus === "unavailable" && unavailableItems.length === 0 && <p className="mt-3 text-[11px] text-amber-100/70">No items are available for those extra dates. Your original return times still apply.</p>}
    {offer.quoteStatus === "duration_required" && <p className="mt-3 text-[11px] text-white/55">Choose how many extra days in the request form to check current availability and price.</p>}
    {legacy && unavailableItems.length === 0 && <p className="mt-3 text-[11px] leading-relaxed text-white/55">Choose days and items for a live total. Anything not selected stays due at its original time.</p>}
    {!legacy && <p className="mt-3 text-[11px] leading-relaxed text-white/55">Estimate only. Unavailable items stay due on their original schedule. Your rental changes only after you submit a request, the team approves it and any payment is complete.</p>}
    {interactive && <button type="button" data-testid="gaffer-extension-open" onClick={() => window.dispatchEvent(new Event("dbc:open-rental-extension"))} className="mt-3 inline-flex min-h-10 items-center justify-center rounded-xl border border-sky-100/20 bg-sky-100/[0.12] px-3.5 text-xs font-medium text-sky-50 transition hover:bg-sky-100/[0.18] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-100/60">{legacy ? "Check availability & total" : "Continue to request"}</button>}
  </section>;
}
