"use client";
import { useEffect, useRef, useState } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import { api } from "@cvx/_generated/api";

export function RenterRentalTools({ token, bookingId }: { token: string; bookingId: string }) {
  const [refreshKey, setRefreshKey] = useState(0);
  useEffect(() => { const timer = setInterval(() => setRefreshKey(Date.now()), 60000); return () => clearInterval(timer); }, []);
  const context = useQuery(api.rentalRequests.context, { token, bookingId: bookingId as any, refreshKey });
  const cancellation = useQuery(api.cancellationRecovery.renterStatus, { token, bookingId: bookingId as any });
  const request = useMutation(api.rentalRequests.submit);
  const cancel = useAction(api.checkout.cancelByCustomer);
  const cancelUnpaid = useAction(api.checkout.cancelUnpaidByCustomer);
  const [mode, setMode] = useState<"dates" | "items" | "extension" | "cancel" | null>(null);
  const [detail, setDetail] = useState("");
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState("");
  const requestId = useRef<string | null>(null);
  if (!context || !["pending_payment", "confirmed", "active"].includes(context.status)) return null;
  const canCancel = context.direct && (context.status === "pending_payment" || context.selfService);
  function open(next: typeof mode) { setMode(next); setDetail(""); setConsent(false); setError(""); setResult(""); requestId.current = null; }
  async function submit() {
    if (busy || !mode) return;
    setBusy(true); setError("");
    try {
      if (mode === "cancel" && canCancel) {
        if (!consent) throw Error("Please confirm that you have read the cancellation terms.");
        if (context!.status === "pending_payment") await cancelUnpaid({ token, bookingId: bookingId as any });
        else await cancel({ token, bookingId: bookingId as any });
        setResult("Rental cancelled. The settlement details are saved in this conversation.");
      } else {
        requestId.current ??= crypto.randomUUID();
        await request({ token, bookingId: bookingId as any, requestId: requestId.current, kind: mode, detail });
        setResult("Request sent to the team in this conversation. Your rental stays unchanged until the team confirms it.");
      }
      setMode(null);
    } catch (e: any) { setError(e.data?.message ?? e.message ?? "Please try again."); }
    finally { setBusy(false); }
  }
  return <div className="mt-3" data-testid="renter-rental-tools">
    {cancellation && cancellation.status !== "succeeded" && <p role="status" className="mb-3 rounded-xl border border-amber-400/20 bg-amber-400/5 p-3 text-xs text-amber-100">{cancellation.status === "attention" ? "The team is reviewing your cancellation settlement. Please message us if you need help." : "Your cancellation is processing. We will confirm once the refund and security release are complete."}</p>}
    <div className="flex flex-wrap gap-2" aria-label="Rental requests">
      {(context.status === "active" ? [["items", "Request kit change"]] : [["dates", "Request dates"], ["items", "Request kit change"], ["cancel", "Cancel rental"]]).map(([kind, label]) => <button key={kind} disabled={busy || context.locked} onClick={() => open(kind as typeof mode)} className={`rounded-full border px-3 py-2 text-xs ${mode === kind ? "border-accent-400/50 bg-accent-500/10 text-white" : "border-white/10 text-white/60 hover:text-white"} disabled:opacity-35`}>{label}</button>)}
    </div>
    {mode && <form onSubmit={e => { e.preventDefault(); void submit(); }} className="mt-3 rounded-2xl border border-white/10 bg-white/[0.035] p-4">
      <div className="flex justify-between gap-3"><h3 className="text-sm font-medium text-white">{mode === "cancel" ? "Cancellation terms" : "Ask the team"}</h3><button type="button" disabled={busy} onClick={() => setMode(null)} className="text-xs text-white/50">Close</button></div>
      {mode === "cancel" ? <div className="mt-3 space-y-2 text-xs leading-relaxed text-white/65">
        <p>{context.status === "pending_payment" ? "This is an unpaid checkout. Cancelling abandons the checkout and releases its reservations. Any payment already captured is checked before settlement." : context.cancellationKind === "full_refund" ? `At least ${context.cancellationFullRefundDays} London calendar days before the earliest rental start: the full remaining captured rental payment, including refundable security, is refunded to the original payment method and used account credit is restored.` : `Fewer than ${context.cancellationFullRefundDays} London calendar days before the earliest rental start: 0% rental cash refund. The remaining rental value becomes account credit valid for 365 days; refundable security is settled separately. Your statutory rights are unaffected.`}</p>
        <p>Already refunded amounts cannot be refunded again. Unused card holds are released. <a href={`/legal/cancellation?version=${encodeURIComponent(context.cancellationTermsVersion)}`} target="_blank" rel="noopener noreferrer" className="text-accent-300 underline">Read the full terms</a>.</p>
        {!canCancel && <p>The team will process your cancellation request. The rental is still booked until cancellation is confirmed; eligibility is checked when it is processed.</p>}
        {canCancel && <label className="flex items-start gap-2"><input required type="checkbox" checked={consent} onChange={e => setConsent(e.target.checked)} className="mt-0.5" />I have read the terms and want to cancel this rental.</label>}
      </div> : <p className="mt-2 text-xs text-white/50">{mode === "items" ? "Tell us which items and quantities to add or remove." : "Tell us your preferred start and return dates. Availability and any price change need team confirmation."}</p>}
      {!(mode === "cancel" && canCancel) && <textarea aria-label="Request details" required minLength={5} maxLength={1000} value={detail} onChange={e => { setDetail(e.target.value); requestId.current = null; }} placeholder={mode === "cancel" ? "Reason for cancellation" : "Your requested change"} className="mt-3 w-full rounded-xl bg-[#151515] p-3 text-sm text-white" />}
      <button disabled={busy || (mode === "cancel" && canCancel && !consent)} className={`mt-3 rounded-full px-4 py-2 text-xs font-medium text-white disabled:opacity-40 ${mode === "cancel" ? "bg-rose-600" : "bg-accent-500"}`}>{busy ? "Processing…" : mode === "cancel" && canCancel ? "Confirm cancellation" : "Send request"}</button>
    </form>}
    {error && <p role="alert" className="mt-2 text-xs text-rose-300">{error}</p>}
    {result && <p role="status" className="mt-2 text-xs text-emerald-300">{result}</p>}
  </div>;
}
