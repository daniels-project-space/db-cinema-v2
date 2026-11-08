"use client";

import { useState } from "react";
import { useAction, useQuery } from "convex/react";
import { api } from "@cvx/_generated/api";
import { formatGbp } from "@/lib/pricing";

function Icon({ name, className = "" }: { name: "alert" | "arrow" | "check"; className?: string }) {
  return <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" className={className}>
    {name === "alert" ? <><path d="M12 3.5 21 20H3L12 3.5Z"/><path d="M12 9v4.5M12 17h.01"/></> : name === "arrow" ? <><path d="M4 12h15M14 7l5 5-5 5"/></> : <path d="m5 12 4 4L19 6"/>}
  </svg>;
}

const primaryAction = "inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-[#e8c399]/45 bg-gradient-to-br from-[#e3bb8d] to-[#b9865e] px-3.5 text-xs font-semibold text-[#19130e] shadow-[0_8px_22px_rgba(189,141,92,.18)] transition hover:-translate-y-0.5 hover:brightness-110 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#f1d2ad] disabled:translate-y-0 disabled:opacity-50";
const quietAction = "inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-white/[.12] bg-white/[.035] px-3.5 text-xs font-medium text-[#e8e0d5] transition hover:border-white/25 hover:bg-white/[.07] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#e5bd8d] disabled:opacity-45";

export function RentalSwapRecovery({ token, bookingId }: { token: string; bookingId: string }) {
  const rows = useQuery(api.rentalSwapState.list, { token, bookingId: bookingId as any, admin: true });
  const resume = useAction(api.rentalSwapPayments.resumeReview);
  const refund = useAction(api.rentalSwapPayments.refundPaidReview);
  const syncFailedRefund = useAction(api.rentalSwapPayments.syncFailedRefundReview);
  const resolveRefundAmbiguity = useAction(api.rentalSwapPayments.resolveRefundAmbiguity);
  const retryFailedRefund = useAction(api.rentalSwapPayments.retryFailedRefund);
  const [selected, setSelected] = useState<string | null>(null);
  const [refundSelected, setRefundSelected] = useState<string | null>(null);
  const [retrySelected, setRetrySelected] = useState<string | null>(null);
  const [ambiguitySelected, setAmbiguitySelected] = useState<string | null>(null);
  const [ambiguityReady, setAmbiguityReady] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [refundDashboardUrl, setRefundDashboardUrl] = useState<string | null>(null);
  const reviews = rows?.filter(row => row.status === "review" || row.status === "refund_compensating") ?? [];
  type SwapId = (typeof reviews)[number]["id"];

  if (!reviews.length) {
    return message ? <p role="status" className="mt-3 rounded-xl border border-[#927554]/25 bg-[#ae8050]/10 p-3 text-xs leading-5 text-[#f1d2ad]">{message}</p> : null;
  }

  async function resumeChange(id: SwapId) {
    setBusy(true);
    setMessage("");
    try {
      const result = await resume({ token, id, confirmed: true });
      setMessage(result.status === "awaiting_acceptance"
        ? "Request expired · no payment started."
        : result.applied
          ? "Settlement recorded · confirm the stock update in Rental Manager."
          : result.refunded
            ? "Original payment refunded."
            : result.url
              ? "Payment link restored · renter still needs to pay."
              : "Still processing or awaiting Stripe · check status before retrying.");
      setSelected(null);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not resume the existing change.");
    } finally {
      setBusy(false);
    }
  }

  async function reviewRefund(id: SwapId) {
    setBusy(true);
    setMessage("");
    try {
      const result = await refund({ token, id, confirmed: true, reason: reason.trim() });
      setMessage(result.refunded
        ? "Refund confirmed · stock review remains."
        : "Refund requested · check Stripe before confirming.");
      setRefundSelected(null);
      setReason("");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Refund could not be requested.");
    } finally {
      setBusy(false);
    }
  }

  async function syncRefund(id: SwapId) {
    setBusy(true);
    setMessage("");
    setRefundDashboardUrl(null);
    try {
      const result = await syncFailedRefund({ token, id });
      if (result.ambiguity) {
        setAmbiguityReady(result.ambiguity.canResolve ? id : null);
        const succeeded = result.ambiguity.attempts.filter(attempt => attempt.status === "succeeded").length;
        const failed = result.ambiguity.attempts.filter(attempt => attempt.status === "failed").length;
        setMessage(`${result.ambiguity.attempts.length} Stripe attempts checked · ${succeeded} succeeded · ${failed} failed.${result.ambiguity.multipleSucceeded ? " Multiple refunds succeeded; keep this change locked." : ""}`);
        setSelected(null);setRefundSelected(null);setRetrySelected(null);
        const first = result.refunds[0];setRefundDashboardUrl(first?.dashboardUrl ?? null);
        return;
      }
      setAmbiguityReady(null);
      const failed = result.refunds.find(item => item.status === "failed");
      const first = result.refunds[0];
      setRefundDashboardUrl(failed?.dashboardUrl ?? first?.dashboardUrl ?? null);
      setMessage(result.status === "succeeded"
        ? "Refund confirmed · finish the stock update."
        : result.status === "pending"
          ? "Refund processing · no new refund created."
          : "Refund failed · no new refund created; review before retrying.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not check refund status.");
    } finally {
      setBusy(false);
    }
  }

  async function resolveAmbiguity(id: SwapId) {
    setBusy(true);setMessage("");setRefundDashboardUrl(null);
    try {
      const result = await resolveRefundAmbiguity({token,id,reason:reason.trim(),confirmed:true});
      setMessage(result.applied || result.status === "applied"
        ? "One successful refund verified · equipment change completed."
        : result.status === "reconciled"
          ? "Stripe receipts reconciled · review the remaining refund status."
          : "Receipts checked · the equipment change remains locked for review.");
      setAmbiguitySelected(null);setAmbiguityReady(null);setReason("");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "The Stripe receipts could not be resolved.");
    } finally {setBusy(false);}
  }

  async function retryRefund(id: SwapId) {
    setBusy(true);
    setMessage("");
    setRefundDashboardUrl(null);
    try {
      const result = await retryFailedRefund({ token, id, requestId: crypto.randomUUID(), reason: reason.trim(), confirmed: true });
      setMessage(result.applied || result.status === "applied"
        ? "Refund confirmed · equipment update completed."
        : result.status === "needs_review"
          ? "Stripe still needs review · sync the latest status."
          : result.status === "awaiting_review"
            ? "Stripe approval is required · open the approval link."
            : "Refund retry started · check the status before another action.");
      setRetrySelected(null);
      setReason("");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Refund retry could not be started.");
    } finally {
      setBusy(false);
    }
  }

  return <section aria-label="Equipment changes needing review" className="relative isolate mt-3 overflow-hidden rounded-2xl border border-[#c69b6d]/30 bg-gradient-to-br from-[#24211c] via-[#171918] to-[#121414] text-sm text-[#f3eee7] shadow-[0_20px_48px_rgba(0,0,0,.32)] backdrop-blur-2xl">
    <span aria-hidden="true" className="pointer-events-none absolute -right-12 -top-16 -z-10 h-44 w-44 rounded-full bg-[#e4b982]/10 blur-3xl" />
    <header className="flex items-center justify-between gap-3 border-b border-white/[.08] px-4 py-3.5 sm:px-5">
      <div className="flex min-w-0 items-center gap-3">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl border border-[#e4bc8c]/20 bg-[#d6aa73]/[.09] text-[#e8c397] shadow-inner">
          <Icon name="alert" className="h-5 w-5" />
        </span>
        <div className="min-w-0">
          <h4 className="truncate text-sm font-semibold tracking-tight text-[#fff7ed]">Equipment change</h4>
        </div>
      </div>
      <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-[#d6aa73]/25 bg-[#d6aa73]/[.08] px-2.5 py-1 text-[10px] font-semibold text-[#ecc99b]">
        <span className="h-1.5 w-1.5 rounded-full bg-[#e6b87e]" />
        {reviews.length} {reviews.length === 1 ? "case" : "cases"}
      </span>
    </header>

    <div className="space-y-3 p-3 sm:p-4">
      {reviews.map(row => <article key={row.id} className="min-w-0 overflow-hidden rounded-2xl border border-white/[.09] bg-white/[.035] shadow-[inset_0_1px_0_rgba(255,255,255,.035)] backdrop-blur-xl">
        <div className="space-y-3 p-3.5 sm:p-4">
          <div className="flex min-w-0 items-center justify-between gap-3">
            <span className="text-[10px] font-medium uppercase tracking-[.13em] text-white/40">Requested change</span>
            <span className={`shrink-0 rounded-full border px-2.5 py-1 text-[10px] font-medium ${row.status === "refund_compensating" ? "border-sky-200/15 bg-sky-200/[.06] text-sky-100/80" : "border-amber-100/15 bg-amber-100/[.06] text-amber-100/80"}`}>
              {row.status === "refund_compensating" ? "Refund processing" : row.autoStockRetry ? "Checking stock" : "Needs review"}
            </span>
          </div>

          <div className="space-y-2.5">
            {row.changes?.length ? row.changes.map((change, index) => <div key={`${change.oldLine?.title}:${index}`} className="flex min-w-0 items-center gap-2.5 text-[13px] font-medium leading-5">
              <span className="min-w-0 flex-1 break-words text-white/85">{change.oldLine?.qty ? `${change.oldLine.qty} × ` : ""}{change.oldLine?.title ?? "Original item"}</span>
              <Icon name="arrow" className="h-4 w-4 shrink-0 text-[#d7ae7b]" />
              <span className="min-w-0 flex-1 break-words text-[#f4d2a9]">{change.newLine?.title ?? "Replacement item"}</span>
            </div>) : <div className="flex min-w-0 items-center gap-2.5 text-[13px] font-medium leading-5">
              <span className="min-w-0 flex-1 break-words text-white/85">{row.oldLine?.qty ? `${row.oldLine.qty} × ` : ""}{row.oldLine?.title ?? "Original item"}</span>
              <Icon name="arrow" className="h-4 w-4 shrink-0 text-[#d7ae7b]" />
              <span className="min-w-0 flex-1 break-words text-[#f4d2a9]">{row.newLine?.title ?? "Replacement item"}</span>
            </div>}
          </div>

          <div className="flex items-center justify-between gap-3 rounded-xl border border-white/[.07] bg-black/20 px-3 py-2.5">
            <span className="text-xs text-white/55">{row.deltaPence < 0 ? "Refund to original card" : row.deltaPence > 0 ? "Extra payment" : "No price difference"}</span>
            <strong className="shrink-0 text-sm font-semibold tabular-nums text-[#f7ece0]">{formatGbp(Math.abs(row.deltaPence) / 100)}</strong>
          </div>

          {row.autoStockRetry && <p role="status" className="rounded-xl border border-sky-200/[.12] bg-sky-200/[.04] px-3 py-2 text-xs text-sky-100/75">Retrying automatically · no second charge</p>}
          {row.reconcileError && !row.autoStockRetry && <details className="group rounded-xl border border-amber-100/[.1] bg-amber-100/[.035] px-3 py-2 text-xs text-amber-50/80">
            <summary className="cursor-pointer list-none font-medium marker:hidden">Review note <span className="float-right text-amber-100/50 transition group-open:rotate-180">⌄</span></summary>
            <p className="mt-2 break-words border-t border-white/[.08] pt-2 leading-relaxed text-white/60">{row.reconcileError}</p>
          </details>}
          {row.failedRefund && <p className="inline-flex rounded-full border border-rose-200/10 bg-rose-200/[.045] px-2.5 py-1 text-[10px] text-rose-100/75">Refund failed · review required</p>}
          {row.refundAmbiguity && <p className="inline-flex rounded-full border border-amber-200/15 bg-amber-200/[.055] px-2.5 py-1 text-[10px] text-amber-100/85">Stripe receipts conflict</p>}
          {row.status === "refund_compensating" && <p className="text-xs text-sky-100/70">Not confirmed yet</p>}
          {row.approvalUrl && <a href={row.approvalUrl} target="_blank" rel="noopener noreferrer" className="inline-flex text-xs font-medium text-[#e7bd88] underline underline-offset-4">Review Stripe approval ↗</a>}
        </div>

        {row.status === "review" && <div className="border-t border-white/[.07] bg-black/[.08] p-3.5 sm:px-4">
          {row.autoStockRetry ? null : <>
          {selected !== row.id && refundSelected !== row.id && retrySelected !== row.id && ambiguitySelected !== row.id && <div className="flex flex-wrap gap-2">
            {row.refundAmbiguity && <button type="button" disabled={busy} onClick={() => void syncRefund(row.id)} className={quietAction}>{busy ? "Checking…" : "Sync receipts"}</button>}
            {row.failedRefund && !row.refundAmbiguity && <button type="button" disabled={busy} onClick={() => void syncRefund(row.id)} className={quietAction}>{busy ? "Checking…" : "Sync Stripe"}</button>}
            {row.failedRefund && !row.refundAmbiguity && <button type="button" disabled={busy} onClick={() => { setRetrySelected(row.id); setSelected(null); setRefundSelected(null); setReason(""); setMessage(""); }} className={quietAction}>Retry failed refund</button>}
            {!row.refundAmbiguity && <button type="button" disabled={busy} onClick={() => { setSelected(row.id); setRefundSelected(null); setMessage(""); setRefundDashboardUrl(null); }} className={primaryAction}>Resolve change <Icon name="arrow" className="h-4 w-4" /></button>}
            {row.refundAmbiguity && ambiguityReady === row.id && <button type="button" disabled={busy} onClick={() => { setAmbiguitySelected(row.id);setReason("");setMessage(""); }} className={primaryAction}>Confirm one refund <Icon name="arrow" className="h-4 w-4" /></button>}
            {row.paidStockReview && <button type="button" disabled={busy} onClick={() => { setRefundSelected(row.id); setSelected(null); setReason(""); setMessage(""); setRefundDashboardUrl(null); }} className={quietAction}>Refund extra payment</button>}
          </div>}

          {ambiguitySelected === row.id && row.refundAmbiguity && <div className="space-y-3">
            <p className="text-xs leading-relaxed text-white/60">Confirm only after Stripe shows one succeeded attempt and all others failed.</p>
            <label className="block text-[11px] font-medium text-white/65">Resolution note<textarea value={reason} onChange={event => setReason(event.target.value)} maxLength={400} rows={2} placeholder="What did you verify?" className="mt-1.5 block w-full resize-y rounded-xl border border-white/[.12] bg-black/20 px-3 py-2.5 text-sm text-white outline-none placeholder:text-white/30 transition focus:border-[#d2a671] focus:ring-4 focus:ring-[#d2a671]/[.08]" /></label>
            <div className="flex flex-wrap gap-2"><button type="button" disabled={busy || reason.trim().length < 5} onClick={() => void resolveAmbiguity(row.id)} className={primaryAction}>{busy ? "Verifying…" : "Confirm receipts"}</button><button type="button" disabled={busy} onClick={() => {setAmbiguitySelected(null);setReason("");}} className={quietAction}>Cancel</button></div>
          </div>}

          {refundSelected === row.id && row.paidStockReview && <div className="space-y-3">
            <p className="text-xs leading-relaxed text-white/60">Refunds the extra payment; stock still needs review.</p>
            <label className="block text-[11px] font-medium text-white/65">Reason<textarea value={reason} onChange={event => setReason(event.target.value)} maxLength={400} rows={2} placeholder="Why refund it?" className="mt-1.5 block w-full resize-y rounded-xl border border-white/[.12] bg-black/20 px-3 py-2.5 text-sm text-white outline-none placeholder:text-white/30 transition focus:border-[#d2a671] focus:ring-4 focus:ring-[#d2a671]/[.08]" /></label>
            <div className="flex flex-wrap gap-2">
              <button type="button" disabled={busy || reason.trim().length < 5} onClick={() => void reviewRefund(row.id)} className={primaryAction}>{busy ? "Requesting…" : "Confirm refund"}</button>
              <button type="button" disabled={busy} onClick={() => { setRefundSelected(null); setReason(""); }} className={quietAction}>Cancel</button>
            </div>
          </div>}

          {retrySelected === row.id && row.failedRefund && <div className="space-y-3">
            <p className="text-xs leading-relaxed text-white/60">A new refund is sent only after Stripe confirms the previous attempt failed.</p>
            <label className="block text-[11px] font-medium text-white/65">Reason<textarea value={reason} onChange={event => setReason(event.target.value)} maxLength={400} rows={2} placeholder="Why retry this refund?" className="mt-1.5 block w-full resize-y rounded-xl border border-white/[.12] bg-black/20 px-3 py-2.5 text-sm text-white outline-none placeholder:text-white/30 transition focus:border-[#d2a671] focus:ring-4 focus:ring-[#d2a671]/[.08]" /></label>
            <div className="flex flex-wrap gap-2">
              <button type="button" disabled={busy || reason.trim().length < 5} onClick={() => void retryRefund(row.id)} className={primaryAction}>{busy ? "Checking Stripe…" : "Confirm retry"}</button>
              <button type="button" disabled={busy} onClick={() => { setRetrySelected(null); setReason(""); }} className={quietAction}>Cancel</button>
            </div>
          </div>}

          {selected === row.id && <div className="space-y-3">
            <p className="text-xs leading-relaxed text-white/60">Resumes the existing payment or refund. Unaccepted changes cannot charge.</p>
            <div className="flex flex-wrap gap-2">
              <button type="button" disabled={busy} onClick={() => void resumeChange(row.id)} className={primaryAction}>{busy ? "Resuming…" : "Resume change"}</button>
              <button type="button" disabled={busy} onClick={() => setSelected(null)} className={quietAction}>Cancel</button>
            </div>
          </div>}
          </>}
        </div>}
      </article>)}

      {message && <div role="status" className="rounded-xl border border-[#d6aa73]/15 bg-[#ae8050]/[.08] p-3 text-xs leading-relaxed text-[#f1d2ad]">
        <p className="flex items-start gap-2"><Icon name="check" className="mt-0.5 h-4 w-4 shrink-0"/><span className="break-words">{message}</span></p>
        {refundDashboardUrl && <a href={refundDashboardUrl} target="_blank" rel="noopener noreferrer" className="mt-2 inline-flex text-xs font-medium text-[#e7bd88] underline underline-offset-4">Open refund in Stripe ↗</a>}
      </div>}
    </div>
  </section>;
}
