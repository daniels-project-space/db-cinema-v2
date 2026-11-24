"use client";

import { useRef, useState } from "react";
import { useAction, useQuery } from "convex/react";
import { api } from "@cvx/_generated/api";
import { formatGbp } from "@/lib/pricing";
import { PICKUP_SLOTS } from "@/lib/site";
import { SmartImage } from "@/components/SmartImage";
import { createClientRequestId } from "@/lib/clientRequestId";
import { renterFacingError } from "@/lib/renterFacingError";

type Item = { index: number; title: string; qty: number; imageSources?: string[] };

export function AdminLateExtensionPreview({ token, bookingId, items }: { token: string; bookingId: string; items: Item[] }) {
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<number[] | null>(null);
  const [lateDays, setLateDays] = useState(1);
  const [description, setDescription] = useState("");
  const [fee, setFee] = useState("");
  const [returnDate, setReturnDate] = useState("");
  const [returnTime, setReturnTime] = useState("");
  const [manualRates, setManualRates] = useState<Record<number, string>>({});
  const [confirmedRates, setConfirmedRates] = useState<Record<number, boolean>>({});
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState("");
  const [sentFingerprint, setSentFingerprint] = useState("");
  const request = useRef<{ fingerprint: string; key: string } | null>(null);
  const sendOffer = useAction((api as any).rentalExtensionPayments.sendLateOffer);
  const indexes = selected ?? items.map(item => item.index);
  const preview = useQuery((api as any).rentalExtensions.adminLatePreview, open && indexes.length ? { token, bookingId: bookingId as any, lineItemIndexes: indexes } : "skip");
  const rates = preview?.oneDayRates ?? [];
  const manualRequired = rates.filter((rate: any) => rate.requiresManualRate);
  const manualReady = manualRequired.every((rate: any) => /^\d+(?:\.\d{1,2})?$/.test((manualRates[rate.lineIndex] ?? "").trim()) && Number(manualRates[rate.lineIndex]) > 0 && confirmedRates[rate.lineIndex]);
  const suggestedOneDayPence = rates.reduce((sum: number, rate: any) => sum + (rate.requiresManualRate ? Math.round(Number(manualRates[rate.lineIndex] || 0) * 100) : rate.amountPence ?? 0), 0);
  const hasCustom = !!description.trim() || !!fee.trim();
  const validCustom = !hasCustom || description.trim().length >= 3 && /^\d+(?:\.\d{1,2})?$/.test(fee.trim()) && Number(fee) > 0;
  const targetEnd = returnDate ? Date.parse(`${returnDate}T00:00:00Z`) : NaN;
  const quote = useQuery((api as any).rentalExtensions.adminLateQuote, open && indexes.length && preview && manualReady && Number.isSafeInteger(targetEnd) && returnTime && validCustom ? { token, bookingId: bookingId as any, lineItemIndexes: indexes, lateDays, targetEnd, requestedReturnTime: returnTime, ...(manualRequired.length ? {manualRates:manualRequired.map((rate: any) => ({lineIndex:rate.lineIndex,dailyPence:Math.round(Number(manualRates[rate.lineIndex])*100),confirmed:true}))} : {}), ...(hasCustom ? {customFee:{description:description.trim(),amountPence:Math.round(Number(fee)*100)}} : {}) } : "skip");

  async function sendQuote() {
    if (sending || !quote?.available || quote.offerSendAvailable !== true || typeof quote.quoteFingerprint !== "string" || !quote.quoteFingerprint || sentFingerprint === quote.quoteFingerprint) return;
    const fingerprint = quote.quoteFingerprint;
    if (request.current?.fingerprint !== fingerprint) request.current = { fingerprint, key: createClientRequestId().replaceAll("_", "-") };
    const requestKey = request.current?.key;
    if (!requestKey) return;
    setSending(true);
    setSendError("");
    try {
      await sendOffer({ token, bookingId, lineItemIndexes: indexes, lateDays, targetEnd, requestedReturnTime: returnTime, ...(manualRequired.length ? { manualRates: manualRequired.map((rate: any) => ({ lineIndex: rate.lineIndex, dailyPence: Math.round(Number(manualRates[rate.lineIndex]) * 100), confirmed: true })) } : {}), ...(hasCustom ? { customFee: { description: description.trim(), amountPence: Math.round(Number(fee) * 100) } } : {}), expectedFingerprint: fingerprint, requestKey });
      setSentFingerprint(fingerprint);
    } catch (error) {
      setSendError(renterFacingError(error, "Could not send this offer. Please try again."));
    } finally {
      setSending(false);
    }
  }

  return <div className="mt-3 rounded-2xl border border-amber-200/15 bg-gradient-to-br from-amber-100/[0.07] to-transparent p-3">
    <button type="button" onClick={() => setOpen(value => !value)} aria-expanded={open} className="flex w-full items-center justify-between text-left text-sm font-medium text-amber-100">
      <span>Late rental · prepare extension</span><span aria-hidden="true">{open ? "−" : "+"}</span>
    </button>
    {open && <div className="mt-3 space-y-3">
      <p className="text-xs text-white/55">Select the items and review the quote before sending.</p>
      <div className="space-y-1.5">{items.map(item => <div key={item.index} className="rounded-xl border border-white/[0.08] bg-black/15 p-2 text-xs text-white/80">
        <label className="flex items-center gap-2"><input type="checkbox" checked={indexes.includes(item.index)} onChange={event => {setSelected(event.target.checked ? [...new Set([...indexes, item.index])].sort((left,right) => left-right) : indexes.filter(index => index !== item.index));setConfirmedRates(current => ({...current,[item.index]:false}));}} className="accent-amber-300" /><SmartImage src={item.imageSources?.[0]} fallbackSources={item.imageSources?.slice(1)} alt="" className="h-9 w-9 shrink-0 rounded-lg" /><span className="min-w-0 break-words">{item.qty}× {item.title}</span></label>
        {indexes.includes(item.index) && rates.some((rate: any) => rate.lineIndex === item.index && rate.requiresManualRate) && <div className="mt-2 space-y-2 border-t border-white/10 pt-2"><label className="block text-white/60">Manual late amount for this entire line, per day · £<input inputMode="decimal" value={manualRates[item.index] ?? ""} onChange={event => {setManualRates(current => ({...current,[item.index]:event.target.value}));setConfirmedRates(current => ({...current,[item.index]:false}));}} className="mt-1 block w-full rounded-lg border border-white/10 bg-black/20 p-2 text-white" /></label><label className="flex gap-2 text-white/65"><input type="checkbox" checked={!!confirmedRates[item.index]} onChange={event => setConfirmedRates(current => ({...current,[item.index]:event.target.checked}))} className="accent-amber-300" /><span>I confirm this amount for the whole line.</span></label></div>}
      </div>)}</div>
      <div className="flex items-center justify-between gap-2 rounded-xl border border-white/[0.08] bg-black/15 p-2.5">
        <div><p className="text-xs text-white/75">Suggested late charge</p><p className="mt-1 text-sm font-semibold text-amber-100">{preview && manualReady && !rates.some((rate: any) => rate.missingReturnTime) ? formatGbp(suggestedOneDayPence * lateDays / 100) : "Review rates"}</p></div>
        <div className="flex items-center gap-2"><button type="button" aria-label="Remove one late day" disabled={lateDays <= 1} onClick={() => setLateDays(days => days - 1)} className="h-9 w-9 rounded-lg border border-white/15 disabled:opacity-30">−</button><span className="min-w-12 text-center text-xs">{lateDays} {lateDays === 1 ? "day" : "days"}</span><button type="button" aria-label="Add one late day" disabled={lateDays >= 30} onClick={() => setLateDays(days => days + 1)} className="h-9 w-9 rounded-lg border border-white/15 disabled:opacity-30">+</button></div>
      </div>
      {preview?.needsReconciliation && <p role="alert" className="text-xs text-amber-200">An existing late charge needs checking before another payment can be requested.</p>}
      {preview && !preview.overdue && <p className="text-xs text-white/50">The selected items are not currently overdue.</p>}
      <div className="grid gap-2 sm:grid-cols-2"><label className="text-xs text-white/60">New return date<input type="date" value={returnDate} onChange={event => setReturnDate(event.target.value)} className="mt-1 block w-full rounded-xl border border-white/10 bg-black/20 p-2 text-white" /></label><label className="text-xs text-white/60">Return time<select value={returnTime} onChange={event => setReturnTime(event.target.value)} className="mt-1 block w-full rounded-xl border border-white/10 bg-black/20 p-2 text-white"><option value="">Choose a time</option>{PICKUP_SLOTS.map(slot => <option key={slot} value={slot}>{slot}</option>)}</select></label></div>
      <div className="grid gap-2 sm:grid-cols-[1fr_7rem]"><label className="text-xs text-white/60">Additional fee description<input value={description} onChange={event => setDescription(event.target.value)} maxLength={120} className="mt-1 block w-full rounded-xl border border-white/10 bg-black/20 p-2 text-white" /></label><label className="text-xs text-white/60">Amount · £<input inputMode="decimal" value={fee} onChange={event => setFee(event.target.value)} className="mt-1 block w-full rounded-xl border border-white/10 bg-black/20 p-2 text-white" /></label></div>
      {hasCustom && !validCustom && <p className="text-xs text-amber-200">Enter a description and amount for the additional fee.</p>}
      {quote?.available && <div className="space-y-1 rounded-xl border border-amber-200/15 bg-black/20 p-3 text-xs text-white/70">
        {quote.entries.map((item: any) => <div key={item.lineIndex} className="border-b border-white/[0.07] pb-2 last:border-0"><p className="font-medium text-white/85">{item.title}</p><p>Late {formatGbp(item.latePence / 100)}{item.lateRateSource === "manual" ? " · manual rate" : ""} · Extension {formatGbp(item.extensionPence / 100)}</p><p className="text-white/45">Extension from {dateLabel(item.coveredEnd)} at {item.coveredTime}</p></div>)}
        {quote.discountPence > 0 && <p>Extension saving −{formatGbp(quote.discountPence / 100)}</p>}
        {quote.customFee && <p>{quote.customFee.description} · {formatGbp(quote.customFee.amountPence / 100)}</p>}
        <p className="pt-1 text-sm font-semibold text-amber-100">Total {formatGbp(quote.totalPence / 100)}</p>
      </div>}
      {quote && !quote.available && <p role="status" className="text-xs text-amber-200">{quote.reason}</p>}
      <button type="button" onClick={() => void sendQuote()} disabled={sending || !quote?.available || quote.offerSendAvailable !== true || typeof quote.quoteFingerprint !== "string" || !quote.quoteFingerprint || sentFingerprint === quote.quoteFingerprint} className="w-full rounded-xl bg-amber-200 px-3 py-2 text-xs font-semibold text-black disabled:opacity-40">{sending ? "Sending…" : sentFingerprint && sentFingerprint === quote?.quoteFingerprint ? "Offer sent" : "Send offer in chat"}</button>
      {quote?.available && quote.offerSendAvailable !== true && <p role="status" className="text-xs text-white/55">{quote.offerUnavailableReason || "Sending late-extension offers is not enabled yet."}</p>}
      {sendError && <p role="alert" className="text-xs text-amber-200">{sendError}</p>}
      <p className="text-[11px] leading-relaxed text-white/45">The renter reviews the offer before payment. Existing return times apply until payment succeeds.</p>
    </div>}
  </div>;
}

function dateLabel(at: number) {
  return new Date(at).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
}
