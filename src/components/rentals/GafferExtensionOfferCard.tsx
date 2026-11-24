"use client";

import { useState } from "react";
import { SmartImage } from "@/components/SmartImage";
import { ChatAperture } from "./ChatAperture";

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
  extraDays?: number;
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
const lineImage = (item: OfferLine) => {
  const sources = item.imageSources?.filter((value): value is string => typeof value === "string" && value.trim().length > 0) ?? [];
  if (sources.length) return sources;
  const fallback = item.heroImage || item.image;
  return typeof fallback === "string" && fallback.trim() ? [fallback] : [];
};

function OfferItem({ item, unavailable = false, unchecked = false, legacy = false, interactive = true, showPrice = false, alternatives = [] }: { item: OfferLine; unavailable?: boolean; unchecked?: boolean; legacy?: boolean; interactive?: boolean; showPrice?: boolean; alternatives?: OfferLine[] }) {
  const due = dateLabel(item.originalEnd ?? item.dueAt ?? item.end);
  const proposed = dateLabel(item.proposedEnd ?? item.extensionEnd);
  const amount = pounds(item.lineTotal ?? item.total);
  const sources = lineImage(item);
  return <article data-testid="extension-offer-item" data-offer-status={unavailable ? "unavailable" : unchecked ? "unchecked" : "available"} className={`min-w-0 rounded-2xl border p-3 ${unavailable ? "border-amber-200/20 bg-amber-100/[0.04]" : "border-white/10 bg-black/20"}`}>
    <div className="flex min-w-0 items-center gap-3">
      {sources.length > 0 && <SmartImage src={sources[0]} fallbackSources={sources.slice(1)} alt={`${item.title ?? "Rental item"} listing photo`} className="h-16 w-[68px] shrink-0 rounded-xl border border-white/10 bg-black/20 object-contain" />}
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1"><strong className="min-w-0 break-words text-xs leading-snug text-white/95">{item.qty ? `${item.qty}× ` : ""}{item.title ?? "Rental item"}</strong><span className={`rounded-full border px-2 py-0.5 text-[10px] ${unavailable ? "border-amber-200/20 text-amber-100/85" : unchecked ? "border-white/15 text-white/70" : "border-emerald-200/20 text-emerald-100/90"}`}>{unavailable ? "Unavailable" : unchecked ? "Choose days" : "Available to request"}</span></div>
        {unavailable
          ? <p className="mt-1 text-[11px] leading-relaxed text-amber-100/80">Return as planned · {due ?? "original return date"}{item.originalReturnTime || item.returnTime ? ` · ${item.originalReturnTime ?? item.returnTime}` : ""}</p>
          : unchecked
            ? <p className="mt-1 text-[11px] leading-relaxed text-white/65">Original return · {due ?? "date to confirm"}{item.originalReturnTime || item.returnTime ? ` · ${item.originalReturnTime ?? item.returnTime}` : ""}</p>
          : <p className="mt-1 text-[11px] leading-relaxed text-white/65">{due ? `${legacy || item.originalEnd !== undefined ? "Original" : "Current"} return ${due}${(item.originalReturnTime ?? item.returnTime) ? ` · ${item.originalReturnTime ?? item.returnTime}` : ""}` : "Current return unchanged"}{proposed ? ` · proposed ${proposed}${item.returnTime ? ` at ${item.returnTime}` : ""}` : ""}</p>}
        {!unavailable && !unchecked && <div className="mt-1 flex flex-wrap items-center gap-x-2 text-[10px] text-white/45">{item.days ? <span>{item.days} extra day{item.days === 1 ? "" : "s"}</span> : null}{showPrice && amount && <strong className="text-xs font-semibold text-white/85">{amount}</strong>}</div>}
        {unavailable && item.reason && <p className="mt-1 text-[10px] leading-relaxed text-white/40">{item.reason}</p>}
      </div>
    </div>
    {alternatives.length > 0 && <div className="mt-2.5 border-t border-white/[0.07] pt-2">
          <p className="mb-1.5 text-[9px] font-medium uppercase tracking-[.12em] text-sky-100/55">Available when checked · not reserved</p>
      <div className="grid gap-1.5 sm:grid-cols-2">{alternatives.slice(0, 3).map((alternative, index) => {
        const alternativeSources = lineImage(alternative);
        const price = alternative.availability === "available" ? pounds(alternative.total ?? alternative.lineTotal) : null;
        return <div key={`${alternative.title ?? "alternative"}-${index}`} className="flex min-w-0 items-center gap-2 rounded-lg border border-sky-100/[0.09] bg-sky-100/[0.025] p-2">
          {alternativeSources.length > 0 && <SmartImage src={alternativeSources[0]} fallbackSources={alternativeSources.slice(1)} alt={`${alternative.title ?? "Alternative"} listing photo`} className="h-9 w-10 shrink-0 rounded-md border border-white/10 bg-black/20 object-contain" />}
              <div className="min-w-0 flex-1"><p className="break-words text-[11px] text-white/85">{alternative.title ?? "Alternative item"}</p><p className="text-[10px] text-white/60">{price ? `${price} extension estimate` : "Ask us about this option"}</p></div>
              {interactive && <button type="button" data-testid={`extension-offer-ask-alt-${index}`} aria-label={`Ask the team about ${alternative.title ?? "this alternative"} for this extension`} className="min-h-11 min-w-[44px] shrink-0 rounded-lg border border-sky-100/15 px-3 py-1.5 text-[10px] font-medium text-sky-100/85 transition hover:bg-sky-100/[0.08]" onClick={() => window.dispatchEvent(new CustomEvent("dbc:prefill-rental-message", { detail: { text: `Could you check whether ${alternative.title} can replace ${item.title} during my extension? I understand this suggestion is not reserved and my original return deadline stays in place until you confirm.` } }))}>Ask team</button>}
        </div>;
      })}</div>
    </div>}
  </article>;
}

export function GafferExtensionOfferCard({ offer, legacy = false, interactive = true, bookingItems = [] }: { offer: ExtensionOffer; legacy?: boolean; interactive?: boolean; bookingItems?: BookedItemPhoto[] }) {
  const [showAllItems, setShowAllItems] = useState(false);
  const resolveBookedPhoto = (item: OfferLine, fallbackIndex: number) => {
    if (lineImage(item).length) return item;
    const itemPosition = Number.isSafeInteger(item.lineIndex) ? item.lineIndex : Number.isSafeInteger(item.index) ? item.index : fallbackIndex;
    const bookedItem = bookingItems.find(row => row.index === itemPosition) ?? bookingItems.find(row => row.title === item.title);
    if (!bookedItem) return item;
    return { ...item, imageSources: bookedItem.imageSources, heroImage: bookedItem.heroImage };
  };
  const items = (Array.isArray(offer.items) ? offer.items : []).map(resolveBookedPhoto);
  const availableIndexes = Array.isArray(offer.availableIndexes) ? new Set(offer.availableIndexes) : null;
  const unavailableItems = Array.isArray(offer.unavailableItems) ? offer.unavailableItems : [];
  const unavailableWithPhotos = unavailableItems.map(resolveBookedPhoto);
  const hasLiveQuote = offer.quoteStatus === "available" || offer.quoteStatus === "partial";
  const unchecked = offer.quoteStatus === "duration_required" || legacy;
  const availableItems = !hasLiveQuote ? [] : Array.isArray(offer.availableItems) ? offer.availableItems.map(resolveBookedPhoto) : availableIndexes
    ? items.filter((item, index) => availableIndexes.has(lineIndex(item, index)))
    : items.filter(item => item.available !== false && !["unavailable", "not_available"].includes(item.status ?? ""));
  const total = hasLiveQuote ? pounds(offer.total) : null;
  const benefit = hasLiveQuote ? (typeof offer.benefit === "string" ? offer.benefit : offer.benefit?.label) : null;
  const saving = hasLiveQuote ? pounds((typeof offer.benefit === "object" ? offer.benefit?.saving ?? offer.benefit?.amount : undefined) ?? offer.benefitSaving) : null;
  const visibleUncheckedItems = showAllItems ? items : items.slice(0, 6);
  const visibleAvailableItems = showAllItems ? availableItems : availableItems.slice(0, 6);
  const visibleUnavailableItems = showAllItems ? unavailableWithPhotos : unavailableWithPhotos.slice(0, 6);
  const hiddenItemCount = unchecked
    ? Math.max(0, items.length - 6)
    : Math.max(0, availableItems.length - 6) + Math.max(0, unavailableWithPhotos.length - 6);
  const statusLabel = offer.quoteStatus === "duration_required" || legacy ? "Choose duration to check" : offer.quoteStatus === "partial" ? "Some items available" : offer.quoteStatus === "unavailable" ? "No items available" : offer.quoteStatus === "available" ? "Availability checked" : "Check unavailable";
  const alternatives = Array.isArray(offer.alternatives) ? offer.alternatives : [];
  const quotedIndexes = hasLiveQuote
    ? Array.isArray(offer.availableIndexes) && offer.availableIndexes.length
      ? offer.availableIndexes
      : availableItems.map(item => item.lineIndex ?? item.index)
    : items.map((item, index) => lineIndex(item, index));
  const lineItemIndexes = [...new Set(quotedIndexes.filter((index): index is number => Number.isSafeInteger(index) && index! >= 0))];
  const canOpenRequest = interactive && (unchecked || (hasLiveQuote && availableItems.length > 0 && lineItemIndexes.length === availableItems.length));
  return <section data-testid="gaffer-extension-card" aria-label="Extension options for your rental" className="mt-3 overflow-hidden rounded-[26px] border border-white/20 bg-[radial-gradient(ellipse_at_100%_100%,rgba(169,111,49,.2),transparent_42%),linear-gradient(145deg,#292a2c,#17181b_48%,#1c1b1b)] p-4 shadow-[inset_0_1px_rgba(255,255,255,.1),0_16px_40px_rgba(0,0,0,.25)] sm:p-6">
    <div className="text-center"><ChatAperture /><p className="mt-1 text-[10px] font-medium uppercase tracking-[.15em] text-amber-100/65">Your rental · extension</p><h4 className="mt-2 text-xl font-semibold tracking-tight text-white">{legacy ? "Check extra time" : "Extension estimate"}</h4><span className="mt-2 inline-flex rounded-full border border-amber-100/20 bg-amber-100/[.06] px-3 py-1 text-[11px] text-amber-50/85">{statusLabel}</span></div>
    {total && <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-amber-100/20 bg-gradient-to-r from-white/[.07] to-amber-100/[.04] px-4 py-3"><div className="min-w-0"><p className="text-[10px] font-semibold uppercase tracking-[.1em] text-amber-100/70">Proposed total · available items only</p>{benefit && <p className="mt-1 text-[11px] text-emerald-100/85">{benefit}{saving ? ` · saves ${saving}` : ""}</p>}{!benefit && saving && <p className="mt-1 text-[11px] text-emerald-100/85">Member saving · {saving}</p>}</div><strong className="text-xl font-semibold text-amber-100">{total}</strong></div>}
    {!total && (benefit || saving) && <p className="mt-2 text-[10px] text-emerald-100/75">{benefit ?? "Member saving"}{saving ? ` · saves ${saving}` : ""}</p>}
    {unchecked && items.length > 0 && <div className="mt-3 grid gap-2 sm:grid-cols-2" data-testid="extension-offer-unchecked-items"><p className="sm:col-span-2 text-[10px] font-medium uppercase tracking-[.13em] text-white/45">Items in this rental · choose extra days to check</p>{visibleUncheckedItems.map((item, index) => <OfferItem key={`unchecked-${lineIndex(item, index)}`} item={item} unchecked interactive={interactive} />)}</div>}
    {availableItems.length > 0 && <div className="mt-3 grid gap-2 sm:grid-cols-2" data-testid="extension-offer-available-items">{visibleAvailableItems.map((item, index) => <OfferItem key={`available-${lineIndex(item, index)}`} item={item} legacy={legacy} interactive={interactive} showPrice={hasLiveQuote} />)}</div>}
    {unavailableWithPhotos.length > 0 && <div className="mt-3 space-y-2" data-testid="extension-offer-unavailable-items"><p className="text-[10px] font-medium uppercase tracking-[.13em] text-amber-100/70">Keep these on the original schedule</p>{visibleUnavailableItems.map((item, index) => <OfferItem key={`unavailable-${lineIndex(item, index)}`} item={item} unavailable interactive={interactive} alternatives={item.alternatives ?? alternatives.filter(candidate => candidate.lineIndex === item.lineIndex || candidate.index === item.index)} />)}</div>}
    {hiddenItemCount > 0 && <button type="button" data-testid="extension-offer-expand-items" aria-expanded={showAllItems} onClick={() => setShowAllItems(value => !value)} className="mt-2 inline-flex min-h-11 items-center gap-1.5 rounded-lg border border-white/10 px-2.5 text-[10px] font-medium text-white/65 transition hover:border-sky-100/20 hover:bg-white/[0.04] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-100/50">{showAllItems ? "Show fewer items" : `Show all items · ${hiddenItemCount} more`}</button>}
    {offer.quoteStatus === "unavailable" && unavailableItems.length === 0 && <p className="mt-3 text-[11px] text-amber-100/70">No items are available for those extra dates. Your original return times still apply.</p>}
    {offer.quoteStatus === "duration_required" && <p className="mt-3 text-[11px] text-white/55">Choose how many extra days in the request form to check current availability and price.</p>}
    {legacy && unavailableItems.length === 0 && <p className="mt-3 text-[11px] leading-relaxed text-white/55">Choose days and items to check the live total.</p>}
    {!legacy && <p className="mt-3 text-[11px] leading-relaxed text-white/55">Estimate only · team approval required; payment applies only if due.</p>}
    {interactive && hasLiveQuote && availableItems.length > 0 && !canOpenRequest && <p className="mt-2 text-[11px] text-amber-100/70">Ask the team for a fresh extension estimate.</p>}
    {canOpenRequest && <button type="button" data-testid="gaffer-extension-open" onClick={() => {
      const extraDays = typeof offer.extraDays === "number" && Number.isSafeInteger(offer.extraDays) && offer.extraDays >= 1 && offer.extraDays <= 30
        ? offer.extraDays
        : undefined;
      window.dispatchEvent(new CustomEvent("dbc:open-rental-extension", {
        detail: {
          ...(extraDays !== undefined ? { extraDays } : {}),
          ...(lineItemIndexes.length ? { lineItemIndexes } : {}),
        },
      }));
    }} className="mt-4 inline-flex min-h-11 w-full items-center justify-center rounded-xl bg-gradient-to-r from-[#ffda90] to-[#c99452] px-4 py-2 text-sm font-semibold text-[#17120d] shadow-[inset_0_1px_rgba(255,255,255,.35)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-100">{legacy ? "Check availability & total" : "Continue to request"}</button>}
  </section>;
}
