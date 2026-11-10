"use client";
import { useEffect, useRef, useState } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import { api } from "@cvx/_generated/api";
import { formatGbp } from "@/lib/pricing";
import { PICKUP_SLOTS, HOURS_LABEL } from "@/lib/site";
import { rentalTitle } from "@/lib/rentalPresentation";
import { SmartImage } from "@/components/SmartImage";

const date = (at: number) => new Date(at).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
const labels: Record<string, string> = { pending: "Awaiting team approval", approved: "Approved · preparing payment", awaiting_payment: "Approved · payment required", applied: "Extension confirmed", declined: "Request declined", expired: "Approval expired", withdrawn: "Approval withdrawn", refund_pending: "Payment refund processing", refunded: "Payment refunded" };

export function RentalExtensionPanel({ token, bookingId, admin = false, showTrigger = true, paymentRequestsInChat = [] }: { token: string; bookingId: string; admin?: boolean; showTrigger?: boolean; paymentRequestsInChat?: string[] }) {
  const state = useQuery(api.rentalExtensions.state, { token, bookingId: bookingId as any, admin });
  const [open, setOpen] = useState(false), [days, setDays] = useState(1), [selected, setSelected] = useState<number[] | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [notice, setNotice] = useState("");
  const [refreshKey, setRefreshKey] = useState(0), [reviewId, setReviewId] = useState<string | null>(null), [reason, setReason] = useState("");
  const [returnTime, setReturnTime] = useState(""), [approvedTime, setApprovedTime] = useState("");
  const key = useRef<string | null>(null);
  const quote = useQuery(api.rentalExtensions.quote, open && !admin ? { token, bookingId: bookingId as any, extraDays: days, lineItemIndexes: selected ?? undefined, refreshKey } : "skip");
  const request = useMutation(api.rentalExtensions.request), decline = useMutation(api.rentalExtensions.decline);
  const approve = useAction(api.rentalExtensionPayments.approve);
  const withdraw = useAction(api.rentalExtensionPayments.withdraw);
  useEffect(() => { const timer = setInterval(() => setRefreshKey(Date.now()), 60000); return () => clearInterval(timer); }, []);
  useEffect(() => {
    if (admin) return;
    const openRequest = () => {
      setOpen(true);
      setSelected(null);
      setError("");
      setNotice("");
      key.current = null;
      requestAnimationFrame(() => document.querySelector('[data-testid="rental-extension-panel"]')?.scrollIntoView({ behavior: "smooth", block: "nearest" }));
    };
    window.addEventListener("dbc:open-rental-extension", openRequest);
    return () => window.removeEventListener("dbc:open-rental-extension", openRequest);
  }, [admin]);
  useEffect(() => { setNotice(""); }, [state?.requests[0]?.status]);
  const selectedIndexes = selected ?? state?.items.map(item => item.index) ?? [];
  const replacementArgs = quote?.unavailableItems?.length && state ? {
    items: state.items.filter(item => selectedIndexes.includes(item.index)).map(item => ({
      key: String(item.index),
      listingId: item.listingId as any,
      start: item.end + 86400000,
      end: item.end + days * 86400000,
      pickupTime: state.pickupTime ?? "09:00",
      returnTime: item.returnTime ?? state.returnTime ?? "17:00",
      qty: item.qty,
    })),
    limit: 3,
  } : "skip";
  const alternatives = useQuery(api.cartReplacements.forCart, replacementArgs);
  if (!state) return null;
  const current = state.requests.find(r => ["pending", "approved", "awaiting_payment", "refund_pending"].includes(r.status));
  const recent = current ?? state.requests[0];
  const paymentLinkInChat = !!recent && paymentRequestsInChat.includes(recent.id);
  const eligible = state.actionReady === true && ["confirmed", "active"].includes(state.status);
  if (!eligible && !recent) return null;
  if (!admin && !showTrigger && !open && !recent && !notice && !error) return null;
  async function send() {
    if (!quote?.available || quote.selectionConflictItems?.length || !quote.items || quote.priceDelta === undefined || !quote.baseLines || !returnTime || busy) return;
    setBusy(true); setError("");
    try {
      key.current ??= crypto.randomUUID();
      const requestIndexes = quote.partialAvailability ? quote.availableIndexes : selected ?? undefined;
      await request({ token, bookingId: bookingId as any, requestKey: key.current, extraDays: days, lineItemIndexes: requestIndexes, expectedAmount: quote.priceDelta, expectedBase: quote.baseLines, requestedReturnTime: returnTime });
      setOpen(false); setNotice("Request sent. Your original return dates remain in place until the team approves and payment succeeds.");
    } catch (e: any) { setError(e.message ?? "Your extension request could not be sent."); }
    finally { setBusy(false); }
  }
  async function decide(accept: boolean) {
    if (!reviewId || busy) return;
    setBusy(true); setError("");
    try {
      if (accept) await approve({ token, requestId: reviewId as any, reason, approvedReturnTime: approvedTime });
      else await decline({ token, requestId: reviewId as any, reason });
      setReviewId(null); setReason(""); setNotice(accept ? "Approved. The payment link is in the renter's chat; dates change only after successful payment." : "Request declined. The renter has been notified in this conversation.");
    } catch (e: any) { setError(e.message ?? "The request could not be updated."); }
    finally { setBusy(false); }
  }
  return <section aria-label={admin ? "Extension requests" : "Rental extension request"} data-testid="rental-extension-panel" className="scroll-mt-24 border-b border-sky-300/15 bg-sky-300/[0.035] px-5 py-4">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div className="flex items-center gap-2"><svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5 text-sky-200" fill="none" stroke="currentColor" strokeWidth="1.5"><rect x="3" y="5" width="18" height="16" rx="4"/><path d="M7 3v4m10-4v4M3 10h18m-9 3v5m-2.5-2.5h5"/></svg><span className="text-sm font-medium text-white/85">{admin ? "Extension requests" : "Extend rental"}</span></div>
      {!admin && showTrigger && eligible && !current && <button type="button" data-testid="request-extension-open" disabled={state.locked || busy} onClick={() => { setOpen(!open); setError(""); setNotice(""); setSelected(null); key.current = null; }} className="min-h-11 rounded-full border border-sky-200/25 bg-sky-200/10 px-3 py-2 text-xs text-sky-100 shadow-[inset_0_1px_0_#ffffff0a] transition hover:border-sky-100/40 hover:bg-sky-100/[0.13] disabled:opacity-40 lg:min-h-0">{open ? "Close" : "Request extension"}</button>}
    </div>
    {recent && <div className="mt-3 rounded-2xl border border-white/[0.08] bg-black/15 p-3" data-testid="extension-request-status">
      <div className="flex flex-wrap justify-between gap-2"><span className={`text-xs font-medium ${recent.status === "applied" ? "text-emerald-200" : "text-sky-200"}`}>{labels[recent.status] ?? recent.status}</span>{recent.amount !== null && <span className="text-sm font-semibold text-white">{formatGbp(recent.amount)}</span>}</div>
      <div className="mt-3 grid gap-2 sm:grid-cols-2">{recent.items.map(item => {
        const detail = state.items.find(row => row.index === item.lineIndex);
        return <div key={item.lineIndex} className="flex min-w-0 items-center gap-2 rounded-xl border border-white/[0.07] bg-white/[0.025] p-2.5">
          {detail && <SmartImage src={detail.imageSources?.[0]} fallbackSources={detail.imageSources?.slice(1)} alt={item.title} className="h-12 w-12 shrink-0 rounded-lg" />}
          <p className="min-w-0 text-xs leading-relaxed text-white/70">{item.qty}× {rentalTitle(item.title)}<span className="mt-0.5 block text-white/40">Return {date(item.end)} · {recent.approvedReturnTime ?? recent.requestedReturnTime ?? "time to confirm"}</span></p>
        </div>;
      })}</div>
      {state.items.filter(item => !recent.items.some(requested => requested.lineIndex === item.index)).length > 0 && <div className="mt-3 rounded-xl border border-amber-200/10 bg-amber-200/[0.035] p-3">
        <p className="text-[11px] font-medium text-amber-100/80">Still due on the original schedule</p>
        <div className="mt-2 space-y-2">{state.items.filter(item => !recent.items.some(requested => requested.lineIndex === item.index)).map(item => <div key={item.index} className="flex items-center gap-2 text-xs text-white/55">
          <SmartImage src={item.imageSources?.[0]} fallbackSources={item.imageSources?.slice(1)} alt={item.title} className="h-9 w-9 shrink-0 rounded-lg" />
          <span>{item.qty}× {rentalTitle(item.title)} · return {date(item.end)}{item.returnTime ? ` at ${item.returnTime}` : ""}</span>
        </div>)}</div>
      </div>}
      {recent.benefitSaving > 0 && <p className="mt-2 text-xs text-emerald-200">{recent.benefitLabel} · saved {formatGbp(recent.benefitSaving)}</p>}
      {recent.reason && ["declined", "expired"].includes(recent.status) && <p className="mt-2 text-xs text-white/55">{recent.reason}</p>}
      {["pending", "approved", "awaiting_payment"].includes(recent.status) && <p className="mt-2 text-[11px] leading-relaxed text-white/40">Original return deadlines apply until approval and payment. The team may adjust the proposed time; the approved time is shown above, in London time. Security amounts stay unchanged.</p>}
      {!admin && recent.url && paymentLinkInChat && <p data-testid="extension-payment-in-chat" role="status" className="mt-3 rounded-xl border border-emerald-200/10 bg-emerald-200/[0.04] px-3 py-2 text-xs text-emerald-100/70">Payment link is in the chat above.</p>}
      {!admin && recent.url && !paymentLinkInChat && <div data-testid="extension-payment-card" className="mt-3 rounded-2xl border border-sky-200/20 bg-gradient-to-br from-sky-200/[0.12] via-white/[0.035] to-transparent p-3 shadow-[inset_0_1px_0_#ffffff0b]">
        <p className="text-[10px] font-medium uppercase tracking-[0.16em] text-sky-100/60">Approved extension</p>
        <div className="mt-2 flex flex-wrap items-center gap-2">{recent.items.slice(0, 4).map(item => {
          const detail = state.items.find(row => row.index === item.lineIndex);
          return detail && <SmartImage key={item.lineIndex} src={detail.imageSources?.[0]} fallbackSources={detail.imageSources?.slice(1)} alt={item.title} className="h-10 w-10 rounded-lg border border-white/10" />;
        })}<span className="ml-auto text-lg font-semibold text-white">{formatGbp(recent.amount!)}</span></div>
        <a data-testid="extension-pay-link" href={recent.url} className="mt-3 inline-flex min-h-10 items-center justify-center rounded-xl bg-sky-100 px-4 py-2 text-xs font-semibold text-sky-950">Pay securely & confirm</a>
      </div>}
      {recent.expiresAt && recent.status === "awaiting_payment" && <p className="mt-2 text-[10px] text-white/35">Payment deadline: {new Date(recent.expiresAt).toLocaleString("en-GB", { timeZone: "Europe/London", dateStyle: "medium", timeStyle: "short" })} London time.</p>}
      {admin && recent.status === "pending" && <button type="button" data-testid="extension-review" onClick={() => { setReviewId(recent.id); setApprovedTime(recent.requestedReturnTime ?? ""); setReason(""); setError(""); }} className="mt-3 rounded-full border border-sky-200/30 px-3 py-2 text-xs text-sky-100">Review request</button>}
      {admin && recent.status === "approved" && <button type="button" disabled={busy} onClick={() => { setReviewId(recent.id); setApprovedTime(recent.approvedReturnTime ?? recent.requestedReturnTime ?? ""); setReason(recent.reason ?? "Recovering approved extension"); }} className="mt-3 rounded-full border border-sky-200/30 px-3 py-2 text-xs text-sky-100">Recover payment link</button>}
      {admin && ["approved", "awaiting_payment"].includes(recent.status) && <button type="button" data-testid="extension-withdraw" disabled={busy} onClick={async () => { setBusy(true); setError(""); try { await withdraw({ token, requestId: recent.id as any }); setNotice("Unpaid approval withdrawn. The original dates remain in place."); } catch (e: any) { setError(e.message); } finally { setBusy(false); } }} className="mt-3 rounded-full border border-white/15 px-3 py-2 text-xs text-white/60 disabled:opacity-40">Withdraw unpaid approval</button>}
      {admin && recent.status === "refund_pending" && <p className="mt-2 text-xs text-amber-200">The rental remains locked until Stripe confirms the refund.</p>}
    </div>}
    {admin && reviewId && <div className="mt-3 rounded-2xl border border-sky-200/20 p-4" data-testid="extension-owner-review">
      <p className="text-xs leading-relaxed text-white/60">Approval rechecks availability and the saved quote, then reserves the extra dates for up to 24 hours. No charge is taken automatically.</p>
      <label className="mt-3 block text-xs text-white/60">Approved return time · London<select data-testid="extension-approved-time" disabled={recent?.status !== "pending" || busy} value={approvedTime} onChange={e => setApprovedTime(e.target.value)} className="mt-1.5 block rounded-xl bg-[#222] px-3 py-2 text-sm text-white"><option value="">Choose time</option>{PICKUP_SLOTS.map(time => <option key={time} value={time}>{time}</option>)}</select><span className="mt-1 block text-[11px] text-white/40">Proposed: {recent?.requestedReturnTime ?? "not supplied"} · allowed {HOURS_LABEL}. Change the time here before approval.</span></label>
      <label className="mt-3 block text-xs text-white/60">Decision reason<input data-testid="extension-decision-reason" value={reason} maxLength={500} onChange={e => setReason(e.target.value)} className="mt-1.5 w-full rounded-xl bg-black/30 px-3 py-2 text-sm text-white" placeholder="Explain your decision to the renter" /></label>
      <div className="mt-3 flex flex-wrap gap-2"><button type="button" data-testid="extension-approve" disabled={busy || reason.trim().length < 5 || !approvedTime || !state.paymentsEnabled} onClick={() => void decide(true)} className="rounded-full bg-sky-100 px-4 py-2 text-xs font-semibold text-sky-950 disabled:opacity-40">{busy ? "Processing…" : "Approve & send payment link"}</button><button type="button" data-testid="extension-decline" disabled={busy || reason.trim().length < 5} onClick={() => void decide(false)} className="rounded-full border border-rose-300/25 px-4 py-2 text-xs text-rose-200 disabled:opacity-40">Decline</button><button type="button" disabled={busy} onClick={() => setReviewId(null)} className="px-2 py-2 text-xs text-white/40">Close</button></div>
      {!state.paymentsEnabled && <p className="mt-2 text-xs text-amber-200">Live rental payments have not been enabled yet.</p>}
    </div>}
    {!admin && open && !current && <form onSubmit={e => { e.preventDefault(); void send(); }} data-testid="extension-request-form" className="mt-2.5 space-y-2.5 rounded-2xl border border-white/10 p-3 sm:p-4">
      <div className="grid grid-cols-2 gap-2">
      <label className="grid gap-1 text-[11px] text-white/55">Extra days<select data-testid="extension-extra-days" value={days} disabled={busy} onChange={e => { setDays(Number(e.target.value)); key.current = null; }} className="min-h-10 w-full rounded-lg bg-[#222] px-2.5 py-2 text-sm text-white">{Array.from({ length: 30 }, (_, i) => <option key={i} value={i + 1}>{i + 1} {i ? "days" : "day"}</option>)}</select></label>
      <label className="grid gap-1 text-[11px] text-white/55">New return time<select required data-testid="extension-return-time" value={returnTime} disabled={busy} onChange={e => { setReturnTime(e.target.value); key.current = null; }} className="min-h-10 w-full rounded-lg bg-[#222] px-2.5 py-2 text-sm text-white"><option value="">Choose time</option>{PICKUP_SLOTS.map(time => <option key={time} value={time}>{time}</option>)}</select></label>
      </div>
      <p className="-mt-1 text-[10px] leading-snug text-white/40">{HOURS_LABEL} London · team confirms the final time.</p>
      {state.items.length > 1 && <fieldset><legend className="mb-1.5 text-[10px] font-medium text-white/45">Select items to extend</legend><div className="grid gap-1.5 sm:grid-cols-2">{state.items.map(item => {
        const unavailable = quote?.unavailableItems?.some(row => row.lineIndex === item.index);
        const selectionConflict = quote?.selectionConflictItems?.some(row => row.lineIndex === item.index);
        const canExtend = !unavailable;
        const checked = selected === null || selected.includes(item.index);
        return <label key={item.index} className={`flex min-w-0 items-center gap-2 rounded-xl border p-2 text-xs ${unavailable ? "border-amber-200/15 bg-amber-100/[0.035]" : selectionConflict ? "border-sky-200/20 bg-sky-200/[0.045]" : "border-white/[0.07] bg-white/[0.025]"}`}>
          <input type="checkbox" disabled={busy || !canExtend} checked={canExtend && checked} onChange={e => { setSelected(s => { const current = s ?? state.items.map(row => row.index); return e.target.checked ? [...new Set([...current, item.index])].sort((a, b) => a - b) : current.filter(i => i !== item.index); }); key.current = null; }} className="accent-sky-300" />
          <SmartImage src={item.imageSources?.[0]} fallbackSources={item.imageSources?.slice(1)} alt={item.title} className="h-10 w-10 shrink-0 rounded-lg" />
          <span className="min-w-0 flex-1"><span className="block break-words leading-snug text-white/75 [overflow-wrap:anywhere]">{item.qty}× {rentalTitle(item.title)}</span><span className={`mt-0.5 block break-words text-[10px] leading-snug ${unavailable ? "text-amber-100/70" : selectionConflict ? "text-sky-100/75" : "text-white/35"}`}>{unavailable ? "Original return still applies" : selectionConflict ? "Can extend alone · selection conflict" : canExtend ? `Due ${date(item.end)}` : "Checking availability"}</span></span>
        </label>;
      })}</div></fieldset>}
      {quote === undefined ? <p className="text-xs text-white/40">Checking dates and price…</p> : quote.available ? <div data-testid="extension-live-quote" className="rounded-2xl border border-sky-200/15 bg-sky-200/[0.065] p-2.5">
        <div className="flex flex-wrap items-center justify-between gap-2"><span className="text-[11px] text-sky-100">{quote.selectionConflictItems?.length ? "Choose items" : quote.unavailableItems?.length ? "Available items · approval first" : "Available · approval first"}</span><strong className="text-lg font-semibold text-white">{formatGbp(quote.priceDelta!)}</strong></div>
        {quote.benefitSaving! > 0 && <p className="mt-1 text-xs text-emerald-200">{quote.benefitLabel} · saves {formatGbp(quote.benefitSaving!)}</p>}
        <div className="mt-2 grid gap-1.5 sm:grid-cols-2">{quote.items?.map(item => {
          const detail = state.items.find(row => row.index === item.lineIndex);
          return <div key={item.lineIndex} className="flex min-w-0 items-center gap-2 rounded-lg border border-white/[0.08] bg-black/15 px-2 py-1.5">
            {detail && <SmartImage fit="contain" src={detail.imageSources?.[0]} fallbackSources={detail.imageSources?.slice(1)} alt={`${item.title} listing photo`} className="h-10 w-10 shrink-0 rounded-lg bg-white/[0.025]" />}
            <span className="min-w-0 flex-1 text-xs text-white/70"><span className="line-clamp-2 break-words leading-snug [overflow-wrap:anywhere]">{item.qty}× {rentalTitle(item.title)}</span><span className="mt-0.5 block line-clamp-2 break-words text-[10px] leading-snug text-white/40">Return {date(item.end)}{returnTime ? ` · ${returnTime} London` : " · choose a time"} · {formatGbp(item.lineTotal)}</span></span>
          </div>;
        })}</div>
        {quote.selectionConflictItems?.length > 0 && <div data-testid="extension-selection-conflicts" className="mt-2 rounded-xl border border-sky-200/15 bg-sky-200/[0.04] p-2.5">
          <p className="text-[11px] font-medium text-sky-100">These items conflict on the new dates. Extend one at a time.</p>
          <div className="mt-2 space-y-2">{quote.selectionConflictItems.map(item => {
            const detail = state.items.find(row => row.index === item.lineIndex);
            return <div key={item.lineIndex} className="flex min-w-0 items-center gap-2 rounded-xl border border-white/[0.07] bg-black/15 p-2.5">
              {detail && <SmartImage src={detail.imageSources?.[0]} fallbackSources={detail.imageSources?.slice(1)} alt={`${item.title} listing photo`} className="h-11 w-11 shrink-0 rounded-lg" />}
              <span className="min-w-0 flex-1 text-xs text-white/75">{item.qty}× {rentalTitle(item.title)}<span className="mt-0.5 block text-[10px] text-sky-100/60">Available alone · due {detail ? date(detail.end) : "original date"}</span></span>
              <button type="button" disabled={busy} aria-label={`Quote ${item.title} alone`} data-testid={`extension-quote-line-${item.lineIndex}`} onClick={() => { setSelected([item.lineIndex]); key.current = null; }} className="min-h-10 shrink-0 rounded-lg border border-sky-100/20 px-3 py-2 text-[11px] text-sky-100 transition hover:bg-sky-100/[0.08] disabled:opacity-40 lg:min-h-0">Quote</button>
            </div>;
          })}</div>
        </div>}
        {quote.unavailableItems?.length > 0 && <div data-testid="extension-unavailable-items" className="mt-2 rounded-xl border border-amber-200/15 bg-amber-100/[0.04] p-2.5">
          <p className="text-xs font-medium text-amber-100">Unavailable for these dates</p>
          <div className="mt-2 space-y-2">{quote.unavailableItems?.map(item => {
            const detail = state.items.find(row => row.index === item.lineIndex);
            const options = alternatives?.[String(item.lineIndex)] ?? [];
            return <div key={item.lineIndex} className="rounded-xl border border-white/[0.07] bg-black/15 p-2.5">
              <div><p className="text-xs text-white/75">{item.qty}× {rentalTitle(item.title)}</p><p className="text-[10px] text-amber-100/60">Return by {detail ? `${date(detail.end)}${detail.returnTime ? ` at ${detail.returnTime}` : ""}` : "the original deadline"}</p></div>
              {options.length > 0 ? <div className="mt-2 grid gap-2 sm:grid-cols-2">{options.slice(0, 3).map(option => <div key={option.slug} className="flex min-w-0 items-center gap-2 rounded-lg border border-white/[0.07] bg-white/[0.025] p-2">
                <SmartImage src={option.heroImage} fallbackSources={option.imageSources?.slice(1)} alt={option.title} className="h-10 w-10 shrink-0 rounded-lg" />
                <div className="min-w-0 flex-1"><p className="line-clamp-2 break-words text-[11px] leading-snug text-white/75 [overflow-wrap:anywhere]">{option.title}</p><p className="text-[10px] text-white/40">Listing estimate · {formatGbp(option.total)}</p></div>
                <button type="button" className="shrink-0 text-[10px] text-sky-100 underline decoration-sky-100/30 underline-offset-2" onClick={() => window.dispatchEvent(new CustomEvent("dbc:prefill-rental-message", { detail: { text: `Could you check whether ${option.title} can replace ${item.title} during my extension? I understand this will not change my booking until you confirm.` } }))}>Ask team</button>
              </div>)}</div> : <p className="mt-2 text-[10px] text-white/40">No suitable alternative is available for those dates. This item remains due at its original time.</p>}
              {options.length > 0 && <p className="mt-1.5 text-[10px] text-white/40">Suggestion only · not reserved</p>}
            </div>;
          })}</div>
        </div>}
      </div> : <div role="status" className="rounded-xl border border-amber-200/10 bg-amber-100/[0.035] p-3 text-xs text-amber-100/75">
        <p>{quote.reason} Items not included in an extension stay due at their original return time. You can message the team below.</p>
        {quote.unavailableItems?.length > 0 && <div className="mt-3 space-y-2">{quote.unavailableItems.map(item => {
          const detail = state.items.find(row => row.index === item.lineIndex);
          const options = alternatives?.[String(item.lineIndex)] ?? [];
          return <div key={item.lineIndex} className="rounded-xl border border-white/[0.07] bg-black/15 p-2.5">
            <div><span>{item.qty}× {rentalTitle(item.title)} · due {detail ? date(detail.end) : "at the original time"}{detail?.returnTime ? ` at ${detail.returnTime}` : ""}</span></div>
            {options.length > 0 && <div className="mt-2 grid gap-2 sm:grid-cols-2">{options.slice(0, 3).map(option => <div key={option.slug} className="flex min-w-0 items-center gap-2 rounded-lg border border-white/[0.07] bg-white/[0.025] p-2">
              <SmartImage src={option.heroImage} fallbackSources={option.imageSources?.slice(1)} alt={option.title} className="h-11 w-11 shrink-0 rounded-lg" />
              <div className="min-w-0 flex-1"><p className="line-clamp-2 break-words text-[11px] leading-snug text-white/75 [overflow-wrap:anywhere]">{option.title}</p><p className="text-[10px] text-white/40">Listing estimate · {formatGbp(option.total)}</p></div>
              <button type="button" className="shrink-0 text-[10px] text-sky-100 underline decoration-sky-100/30 underline-offset-2" onClick={() => window.dispatchEvent(new CustomEvent("dbc:prefill-rental-message", { detail: { text: `Could you check whether ${option.title} can replace ${item.title} during my extension? I understand this will not change my booking until you confirm.` } }))}>Ask team</button>
            </div>)}</div>}
          </div>;
        })}</div>}
      </div>}
      <p className="text-[10px] leading-snug text-white/45">No charge yet · team approval, then secure payment · member savings included.</p>
      <button data-testid="extension-send-request" disabled={busy || !quote?.available || !!quote.selectionConflictItems?.length || !returnTime} className="min-h-10 rounded-full bg-sky-100 px-4 py-2 text-xs font-semibold text-sky-950 disabled:opacity-35">{busy ? "Sending…" : quote?.selectionConflictItems?.length ? "Choose items" : quote?.unavailableItems?.length ? "Request available items" : "Request extension"}</button>
    </form>}
    {error && <p role="alert" className="mt-3 text-xs text-rose-300">{error}</p>}
    {notice && <p role="status" className="mt-3 text-xs leading-relaxed text-sky-100/80">{notice}</p>}
  </section>;
}
