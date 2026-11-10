"use client";
import { useEffect, useRef, useState } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import { api } from "@cvx/_generated/api";
import styles from "./RentalConversation.module.css";
import { RentalRequestHistory } from "./RentalRequestHistory";
import { SmartImage } from "@/components/SmartImage";
import { dayMs } from "@/lib/dates";
import { cancellationTimingBasis, isNoRefundWithin48HoursCancellationVersion } from "@/lib/cancellationPolicy";
import { RENTAL_TIME_SLOTS } from "../../../shared/rentalWindow";

export function RenterRentalTools({ token, bookingId }: { token: string; bookingId: string }) {
  const [refreshKey, setRefreshKey] = useState(0);
  useEffect(() => { const timer = setInterval(() => setRefreshKey(Date.now()), 60000); return () => clearInterval(timer); }, []);
  const context = useQuery(api.rentalRequests.context, { token, bookingId: bookingId as any, refreshKey });
  const currentCancellationTerms = isNoRefundWithin48HoursCancellationVersion(context?.cancellationTermsVersion);
  const cancellation = useQuery(api.cancellationRecovery.renterStatus, { token, bookingId: bookingId as any });
  const request = useMutation(api.rentalRequests.submit);
  const cancelUnpaid = useAction(api.checkout.cancelUnpaidByCustomer);
  const [mode, setMode] = useState<"dates" | "items" | "extension" | "cancel" | "handover" | null>(null);
  const [detail, setDetail] = useState("");
  const [handoverKind, setHandoverKind] = useState<"pickup" | "return">("pickup");
  const [handoverTime, setHandoverTime] = useState("");
  const [handoverLineIndexes, setHandoverLineIndexes] = useState<number[]>([]);
  const [cancellationChoice, setCancellationChoice] = useState<"refund" | "credit" | null>(null);
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState("");
  const requestId = useRef<string | null>(null);
  if (!context) return null;
  if (!["pending_payment", "confirmed", "active"].includes(context.status)) return <RentalRequestHistory token={token} bookingId={bookingId} />;
  const canCancel = context.direct && context.status === "pending_payment";
  const canRequestChanges = context.actionReady === true;
  const rescheduleStart = mode === "dates" && detail ? dayMs(detail.slice(0, 10)) : 0;
  const preview = useQuery(api.rentalOperations.renterReschedulePreview,
    canRequestChanges && context.status === "confirmed" && rescheduleStart > 0 && detail.length > 10
      ? { token, bookingId: bookingId as any, start: rescheduleStart, reason: detail.slice(11, 1011) }
      : "skip");
  const handoverReason = detail.trim();
  const handoverPreview = useQuery(api.rentalOperations.renterHandoverPreview,
    canRequestChanges && mode === "handover" && handoverTime && handoverLineIndexes.length && handoverReason.length >= 5
      ? { token, bookingId: bookingId as any, lineIndexes: handoverLineIndexes, kind: handoverKind, time: handoverTime, reason: handoverReason }
      : "skip");
  function open(next: typeof mode) {
    setMode(next); setDetail(""); setCancellationChoice(null); setConsent(false); setError(""); setResult(""); requestId.current = null;
    setHandoverKind(context?.status === "active" ? "return" : "pickup"); setHandoverTime(""); setHandoverLineIndexes(next === "handover" ? context?.items?.map(item => item.index) ?? [] : []);
  }
  async function submit() {
    if (busy || !mode) return;
    setBusy(true); setError("");
    try {
      if (mode === "cancel" && canCancel) {
        if (!consent) throw Error("Please confirm that you have read the cancellation terms.");
        if (context!.status === "pending_payment") await cancelUnpaid({ token, bookingId: bookingId as any });
        setResult("Rental cancelled. The settlement details are saved in this conversation.");
      } else {
        requestId.current ??= crypto.randomUUID();
        if (mode === "dates" && (!preview?.ok || !rescheduleStart)) throw Error("Choose a new start date and wait for the live availability check.");
        const requestDetail = mode === "dates"
          ? `Reschedule all items together to ${detail.slice(0, 10)}. Reason: ${detail.slice(11).trim()}`
          : detail.trim();
        if (mode === "handover" && !handoverPreview?.ok) throw Error(handoverPreview?.reason ?? "Choose the affected items and time, then wait for the live availability check.");
        await request({ token, bookingId: bookingId as any, requestId: requestId.current, kind: mode, detail: requestDetail, ...(mode === "dates" ? { proposedStart: rescheduleStart } : {}), ...(mode === "handover" ? { handoverKind, handoverTime, handoverLineIndexes } : {}), ...(mode === "cancel" && cancellationChoice ? { cancellationChoice } : {}) });
        setResult(mode === "handover" ? "Time request sent for team approval. Your booking stays unchanged until the team approves and applies it." : "Request sent for team approval. Your rental and any payment stay unchanged until the team approves and applies it.");
      }
      setMode(null);
    } catch (e: any) { setError(e.data?.message ?? e.message ?? "Please try again."); }
    finally { setBusy(false); }
  }
  return <div className="mt-3" data-testid="renter-rental-tools">
    <RentalRequestHistory token={token} bookingId={bookingId} />
    {cancellation && cancellation.status !== "succeeded" && <p role="status" className="mb-3 rounded-xl border border-amber-400/20 bg-amber-400/5 p-3 text-xs text-amber-100">{cancellation.status === "attention" ? "The team is reviewing your cancellation settlement. Please message us if you need help." : "Your cancellation is processing. We will confirm once the refund and security release are complete."}</p>}
    {(canRequestChanges || canCancel) ? <div className={styles.requestActions} data-testid="renter-action-buttons" aria-label="Rental requests">
      {(canRequestChanges ? context.status === "active" ? [["items", "Request kit change"], ["handover", "Request time change"]] : context.status === "confirmed" ? [["dates", "Reschedule"], ["items", "Request kit change"], ["handover", "Request time change"], ["cancel", context.cancellationKind === "full_refund" ? "Cancel · refund options" : context.cancellationKind === "store_credit" ? "Cancel · credit only" : "Cancellation options"]] : [] : canCancel ? [["cancel", "Abandon checkout"]] : []).map(([kind, label]) => <button key={kind} type="button" data-testid={`renter-request-${kind}`} aria-label={kind === "dates" ? "Request a reschedule" : kind === "items" ? "Request a kit change" : kind === "handover" ? "Request a pickup or return time change" : canCancel ? "Abandon this checkout" : "See cancellation options"} disabled={busy || context.locked} onClick={() => open(kind as typeof mode)} className={`${styles.requestAction} ${mode === kind ? styles.requestActionActive : ""} disabled:opacity-35`}>
        <svg className={styles.requestActionIcon} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true">{kind === "dates" ? <><rect x="3.5" y="5" width="17" height="16" rx="2.5"/><path d="M8 3.5v3M16 3.5v3M3.5 9.5h17M8 13h3m-3 3h6"/></> : kind === "items" ? <><path d="m12 3 8.5 4.5v9L12 21l-8.5-4.5v-9L12 3Z"/><path d="m3.8 7.8 8.2 4.5 8.2-4.5M12 12.3V21"/></> : kind === "handover" ? <><circle cx="12" cy="12" r="8.5"/><path d="M12 7v5l3.5 2"/></> : <><circle cx="12" cy="12" r="8.5"/><path d="m6 6 12 12"/></>}</svg>
        <span className={styles.requestActionDesktopLabel}>{label}</span>
        <span className={styles.requestActionMobileLabel}>{kind === "dates" ? "Move dates" : kind === "items" ? "Change kit" : kind === "handover" ? "Change time" : canCancel ? "Abandon" : "Cancel"}</span>
      </button>)}
    </div> : <p data-testid="renter-actions-locked" className="rounded-xl border border-white/[0.07] bg-white/[0.025] px-3 py-2 text-xs text-white/45">Rental changes unlock after payment and verification are complete.</p>}
    {mode && <form onSubmit={e => { e.preventDefault(); void submit(); }} className="mt-3 rounded-2xl border border-white/10 bg-white/[0.035] p-4">
      <div className="flex justify-between gap-3"><h3 className="text-sm font-medium text-white">{mode === "cancel" ? "Cancellation terms" : "Ask the team"}</h3><button type="button" disabled={busy} onClick={() => setMode(null)} className="min-h-10 min-w-12 rounded-full px-2 text-xs text-white/65 hover:bg-white/[0.06] lg:min-h-0 lg:min-w-0">Close</button></div>
      {mode === "cancel" ? <div className="mt-3 space-y-2 text-xs leading-relaxed text-white/65">
        <p>{context.status === "pending_payment" ? "This is an unpaid checkout. Abandoning it releases its reservation; any captured payment is checked first." : currentCancellationTerms ? `${cancellationTimingBasis(context.cancellationKind, context.cancellationTermsVersion)}: ${context.cancellationKind === "no_refund" ? "no rental refund or account credit." : context.cancellationKind === "store_credit" ? "account credit only; no rental cash refund." : "full refund to the original payment method or 100% account credit."}` : context.cancellationKind === "full_refund" ? `At least ${context.cancellationFullRefundDays} London calendar days before pickup: full refund to the original payment method.` : `Inside ${context.cancellationFullRefundDays} London calendar days: account credit only; no rental cash refund.`}</p>
        {context.status !== "pending_payment" && currentCancellationTerms && context.cancellationKind === "full_refund" && <fieldset className="rounded-xl border border-white/10 p-3">
          <legend className="px-1 text-white/75">Choose your settlement</legend>
          <label className="flex min-h-11 items-center gap-2 py-2 lg:min-h-0 lg:py-1"><input type="radio" required name={`cancel-choice-${bookingId}`} checked={cancellationChoice === "refund"} onChange={() => { setCancellationChoice("refund"); requestId.current = null; }} />Full refund to original payment method</label>
          <label className="flex min-h-11 items-center gap-2 py-2 lg:min-h-0 lg:py-1"><input type="radio" required name={`cancel-choice-${bookingId}`} checked={cancellationChoice === "credit"} onChange={() => { setCancellationChoice("credit"); requestId.current = null; }} />100% account credit · 365 days</label>
        </fieldset>}
        <p>The booking stays unchanged until team approval. Security is separate. <a href={`/legal/cancellation?version=${encodeURIComponent(context.cancellationTermsVersion)}`} target="_blank" rel="noopener noreferrer" className="text-accent-300 underline">Read accepted terms</a>.</p>
        {canCancel && <label className="flex items-start gap-2"><input required type="checkbox" checked={consent} onChange={e => setConsent(e.target.checked)} className="mt-0.5" />I have read the terms and want to cancel this rental.</label>}
      </div> : mode === "dates" ? <div className="mt-3 space-y-3">
        <section aria-label="Items moving together" data-testid="renter-reschedule-items" className="rounded-2xl border border-white/10 bg-black/20 p-3">
          <div className="mb-2 flex items-center justify-between gap-2"><strong className="text-xs font-medium text-white/75">Moving together</strong><span className="text-[10px] text-white/40">{context.items.length} {context.items.length === 1 ? "listing" : "listings"}</span></div>
          <div className="grid gap-2 sm:grid-cols-2">
            {context.items.map(item => <article key={item.index} className="flex min-w-0 items-center gap-3 rounded-xl border border-white/[0.08] bg-white/[0.025] p-2">
              <SmartImage fit="contain" src={item.heroImage ?? item.imageSources?.[0]} fallbackSources={item.imageSources?.slice(1)} alt={`${item.title} listing photo`} className="h-16 w-20 shrink-0 rounded-lg bg-black/20" />
              <div className="min-w-0"><p className="truncate text-xs text-white/75">{item.title}</p><p className="mt-1 text-[10px] text-white/40">Qty {item.qty}</p></div>
            </article>)}
          </div>
        </section>
        <label className="block text-xs text-white/65">New collection date · moves all items together<input aria-label="New collection date" type="date" required min={new Date().toLocaleDateString("en-CA", { timeZone: "Europe/London" })} value={detail.slice(0, 10)} onChange={e => { setDetail(`${e.target.value}|${detail.slice(11)}`); requestId.current = null; }} className="mt-1.5 block w-full rounded-xl border border-white/10 bg-[#151515] px-3 py-2.5 text-sm text-white" /></label>
        <label className="block text-xs text-white/65">Reason<textarea aria-label="Reschedule reason" required minLength={5} maxLength={500} value={detail.includes("|") ? detail.slice(11) : ""} onChange={e => { setDetail(`${detail.slice(0, 10)}|${e.target.value}`); requestId.current = null; }} placeholder="Why do you need to move the rental?" className="mt-1.5 w-full rounded-xl bg-[#151515] p-3 text-sm text-white" /></label>
        {detail.slice(0, 10) && (preview === undefined ? <p role="status" className="text-xs text-white/45">Checking availability…</p> : preview.ok ? <p role="status" className="text-xs text-emerald-200">Available for the new dates · original pickup and return times and agreed price stay unchanged until team approval.</p> : <p role="status" className="text-xs text-amber-200">{preview.reason ?? "These dates are not currently available."}</p>)}
      </div> : mode === "handover" ? <div className="mt-3 space-y-3">
        <label className="block text-xs text-white/65">Change<select data-testid="renter-handover-kind" aria-label="Time to change" value={handoverKind} onChange={e => { setHandoverKind(e.target.value as "pickup" | "return"); requestId.current = null; }} className="mt-1.5 block w-full rounded-xl border border-white/10 bg-[#151515] px-3 py-2.5 text-sm text-white">
          {context.status === "confirmed" && <option value="pickup">Pickup time</option>}<option value="return">Return time</option>
        </select></label>
        <fieldset data-testid="renter-handover-items" className="grid gap-2 rounded-2xl border border-white/10 bg-black/20 p-3">
          <legend className="px-1 text-xs font-medium text-white/75">Items affected</legend>
          <label className="flex min-h-10 items-center gap-2 text-xs text-white/75"><input data-testid="renter-handover-all" type="checkbox" checked={handoverLineIndexes.length === context.items.length} onChange={e => { setHandoverLineIndexes(e.target.checked ? context.items.map(item => item.index) : []); requestId.current = null; }} />All items</label>
          {context.items.map(item => <label key={item.index} className="flex min-w-0 items-center gap-3 rounded-xl border border-white/[.08] bg-white/[.025] p-2 text-xs text-white/70">
            <input data-testid={`renter-handover-item-${item.index}`} type="checkbox" checked={handoverLineIndexes.includes(item.index)} onChange={e => { setHandoverLineIndexes(current => e.target.checked ? [...current, item.index].sort((a,b) => a-b) : current.filter(index => index !== item.index)); requestId.current = null; }} />
            <SmartImage fit="contain" src={item.heroImage ?? item.imageSources?.[0]} fallbackSources={item.imageSources?.slice(1)} alt={`${item.title} listing photo`} className="h-12 w-16 shrink-0 rounded-lg bg-black/20" />
            <span className="min-w-0 flex-1"><span className="block truncate">{item.qty}× {item.title}</span><span className="mt-1 block text-[10px] text-white/40">Current {handoverKind}: {handoverKind === "pickup" ? item.pickupTime ?? "not set" : item.returnTime ?? "not set"}</span></span>
          </label>)}
        </fieldset>
        <label className="block text-xs text-white/65">New {handoverKind} time<select data-testid="renter-handover-time" aria-label={`New ${handoverKind} time`} required value={handoverTime} onChange={e => { setHandoverTime(e.target.value); requestId.current = null; }} className="mt-1.5 block w-full rounded-xl border border-white/10 bg-[#151515] px-3 py-2.5 text-sm text-white"><option value="">Choose a time</option>{RENTAL_TIME_SLOTS.map(time => <option key={time} value={time}>{time}</option>)}</select></label>
        <label className="block text-xs text-white/65">Why do you need to change the time?<textarea data-testid="renter-handover-reason" aria-label="Time change reason" required minLength={5} maxLength={500} value={detail} onChange={e => { setDetail(e.target.value); requestId.current = null; }} placeholder="Tell us what needs to change" className="mt-1.5 w-full rounded-xl bg-[#151515] p-3 text-sm text-white" /></label>
        {!handoverTime || !handoverLineIndexes.length || handoverReason.length < 5 ? <p className="text-xs text-white/45">Choose a time and affected items, then tell us why.</p> : handoverPreview === undefined ? <p role="status" className="text-xs text-white/45">Checking availability…</p> : handoverPreview.ok ? <p role="status" className="text-xs text-emerald-200">Time is available for the selected items. The booking changes only after team approval and application.</p> : <p role="status" className="text-xs text-amber-200">{handoverPreview.reason ?? "That time is not currently available."}</p>}
      </div> : <p className="mt-2 text-xs text-white/50">{mode === "items" ? "Tell us which items and quantities to add or remove." : "Your request is checked before any rental or payment changes."}</p>}
      {(mode === "items" || mode === "cancel" && !canCancel) && <textarea aria-label={mode === "cancel" ? "Cancellation request details" : "Request details"} required minLength={5} maxLength={500} value={detail} onChange={e => { setDetail(e.target.value); requestId.current = null; }} placeholder={mode === "cancel" ? "Why do you need to cancel?" : "Items and quantities to change"} className="mt-3 w-full rounded-xl bg-[#151515] p-3 text-sm text-white" />}
      <button disabled={busy || (mode === "cancel" && canCancel && !consent) || (mode === "cancel" && !canCancel && currentCancellationTerms && context.cancellationKind === "full_refund" && !cancellationChoice) || (mode === "dates" && (!preview?.ok || detail.slice(11).trim().length < 5)) || (mode === "handover" && (!handoverTime || !handoverLineIndexes.length || handoverReason.length < 5 || !handoverPreview?.ok))} className={`mt-3 min-h-11 rounded-full px-4 py-2 text-xs font-medium text-white disabled:opacity-40 ${mode === "cancel" ? "bg-rose-600" : "bg-accent-500"} lg:min-h-0`}>{busy ? "Sending…" : mode === "cancel" && canCancel ? "Abandon checkout" : mode === "cancel" ? "Request cancellation" : mode === "dates" ? "Request reschedule" : mode === "handover" ? "Request time change" : "Send request"}</button>
    </form>}
    {error && <p role="alert" className="mt-2 text-xs text-rose-300">{error}</p>}
    {result && <p role="status" className="mt-2 text-xs text-emerald-300">{result}</p>}
  </div>;
}
