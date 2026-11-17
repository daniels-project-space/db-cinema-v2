"use client";

import { useEffect, useState } from "react";
import { useAction, usePaginatedQuery } from "convex/react";
import { api } from "@cvx/_generated/api";
import type { Id } from "@cvx/_generated/dataModel";

type Props = { token: string; accountId: Id<"accounts"> };
type RetryAvailability = { state: "not_retryable" | "feature_off" | "available" | "cooldown" | "daily_limit"; availableAt?: number };
type Row = { invoiceId: string; reason: string; createdAt: number; retry: RetryAvailability };
type Notice = { invoiceId: string; text: string; tone: "ok" | "info" };

const messages: Record<string, string> = {
  processing_error: "Credit did not sync.",
  snapshot_not_configured: "Price history is missing.",
  too_many_lines: "Invoice needs a manual check.",
};
const money = (pence: number) => new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" }).format(pence / 100);
const retryTime = (at: number) => new Date(at).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
const retryDateTime = (at: number) => new Date(at).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

export function MembershipInvoiceRecovery({ token, accountId }: Props) {
  const { results: rows, status, loadMore } = usePaginatedQuery(
    api.membershipInvoiceReviews.adminList,
    { token, accountId },
    { initialNumItems: 30 },
  );
  const inspect = useAction(api.checkout.adminInspectMembershipInvoice);
  const retry = useAction(api.checkout.adminRetryMembershipInvoice);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [now, setNow] = useState(() => Date.now());

  const nextRetryAt = rows.reduce<number | null>((next, row) => {
    const at = row.retry.availableAt;
    if ((row.retry.state === "cooldown" || row.retry.state === "daily_limit") && typeof at === "number" && at > now)
      return next === null ? at : Math.min(next, at);
    return next;
  }, null);

  useEffect(() => {
    if (nextRetryAt === null) return;
    const timeout = window.setTimeout(() => setNow(Date.now()), Math.max(1, nextRetryAt - Date.now() + 5));
    return () => window.clearTimeout(timeout);
  }, [nextRetryAt]);

  useEffect(() => {
    if (notice?.tone !== "ok") return;
    const timeout = window.setTimeout(() => {
      setNotice(current => current?.invoiceId === notice.invoiceId ? null : current);
    }, 6000);
    return () => window.clearTimeout(timeout);
  }, [notice]);

  if (!rows.length) {
    if (notice?.tone === "ok") return <p role="status" aria-live="polite" data-testid="membership-credit-sync-status" className="m-0 rounded-xl border border-emerald-200/15 bg-emerald-200/[.06] px-3 py-2 text-xs text-emerald-50">{notice.text}</p>;
    return status === "LoadingFirstPage" ? <p role="status" className="m-0 text-xs text-white/45">Loading invoice reviews…</p> : null;
  }

  function effectiveRetryState(retry: RetryAvailability) {
    if ((retry.state === "cooldown" || retry.state === "daily_limit") && retry.availableAt !== undefined && retry.availableAt <= now)
      return "available";
    return retry.state;
  }

  function retryLabel(retry: RetryAvailability) {
    const state = effectiveRetryState(retry);
    if (state === "feature_off") return "Recovery disabled";
    if (state === "daily_limit") return retry.availableAt ? `Daily limit · after ${retryDateTime(retry.availableAt)}` : "Daily limit reached";
    if (state === "cooldown") return retry.availableAt ? `Retry after ${retryTime(retry.availableAt)}` : "Retry cooling down";
    return "Retry is ready";
  }

  function retryBadge(retry: RetryAvailability) {
    const state = effectiveRetryState(retry);
    if (state === "feature_off") return "Disabled";
    if (state === "daily_limit") return "Limited";
    if (state === "cooldown") return "Waiting";
    return "Ready";
  }

  async function sync(row: Row) {
    if (busyId) return;
    setBusyId(row.invoiceId);
    setNotice(null);
    try {
      const check = await inspect({ token, accountId, invoiceId: row.invoiceId, inspectTier: true });
      const invoice = check.invoice;
      if (!invoice) throw Error("Invoice could not be found in Stripe.");
      if (invoice.status !== "paid" || invoice.currency !== "gbp" || invoice.amountPaidPence <= 0 || !["subscription_create", "subscription_cycle"].includes(invoice.billingReason ?? "")) {
        throw Error("Stripe does not show an eligible paid membership invoice.");
      }
      const knownPrice = check.receipt?.hasHistoricalPrice === true || check.tierCheck?.state === "ready";
      if (!knownPrice) {
        const reason = check.tierCheck?.reason ?? row.reason;
        throw Error(messages[reason] ?? "The historical membership price could not be matched safely.");
      }
      const result = await retry({ token, accountId, invoiceId: row.invoiceId });
      setNotice({ invoiceId: row.invoiceId, text: result.state === "resolved" ? `${money(check.receipt?.creditPence ?? check.tierCheck?.earnedCreditPence ?? 0)} synced.` : "Still pending.", tone: result.state === "resolved" ? "ok" : "info" });
    } catch (error) {
      const reason = error instanceof Error ? error.message : "";
      const shortReason = reason.includes("could not be found") ? "Invoice not found."
        : reason.includes("eligible paid membership") ? "Not a paid membership invoice."
        : reason.includes("historical membership price") ? "Price history needs setup."
        : reason.includes("not enabled") ? "Recovery is disabled."
        : reason.includes("retry limit") ? "Daily retry limit reached. Check again after the retry window resets."
        : reason.includes("wait before retrying") ? "Retry cooldown active. Check again shortly."
        : "Sync failed. Check this invoice.";
      setNotice({ invoiceId: row.invoiceId, text: shortReason, tone: "info" });
    } finally {
      setBusyId(null);
    }
  }

  return <details className="group w-full min-w-0 box-border rounded-2xl border border-amber-100/15 bg-[linear-gradient(145deg,rgba(255,255,255,.045),rgba(10,11,13,.82)_58%,rgba(112,75,42,.11))] p-2.5 shadow-[0_10px_30px_rgba(0,0,0,.16)] backdrop-blur-xl" data-testid="membership-invoice-recovery">
    <summary aria-label="Subscription credit recovery" className="flex w-full min-w-0 min-h-10 cursor-pointer list-none items-center justify-between gap-2 text-xs text-white/85">
      <span className="flex min-w-0 flex-1 items-center gap-2"><span className="grid h-8 w-8 shrink-0 place-items-center rounded-xl border border-amber-100/15 bg-amber-100/[.07] text-amber-100" aria-hidden="true"><svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M20 7v5h-5"/><path d="M19 12a7 7 0 1 1-2-4.9L20 12"/></svg></span><span className="truncate font-medium">Plan credit</span></span>
      <span className="flex shrink-0 items-center gap-2"><span aria-label={`${rows.length}${status === "CanLoadMore" || status === "LoadingMore" ? "+" : ""} subscription credit invoice${rows.length === 1 ? "" : "s"} to review`} title="Subscription credit invoices to review" className="rounded-full border border-amber-200/20 bg-amber-100/[.05] px-2.5 py-1 text-[10px] text-amber-100">{rows.length}{status === "CanLoadMore" || status === "LoadingMore" ? "+" : ""}</span><svg aria-hidden="true" viewBox="0 0 20 20" className="h-3.5 w-3.5 text-white/45 transition-transform group-open:rotate-180" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="m5 7.5 5 5 5-5"/></svg></span>
    </summary>
    {notice?.tone === "ok" && !rows.some(row => row.invoiceId === notice.invoiceId) && <p role="status" aria-live="polite" data-testid="membership-credit-sync-status" className="mt-2 m-0 rounded-xl border border-emerald-200/15 bg-emerald-200/[.06] px-3 py-2 text-xs text-emerald-50">{notice.text}</p>}
    <div className="mt-2 grid max-h-60 gap-2 overflow-y-auto pr-1">
      {rows.map(row => <article key={row.invoiceId} className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1.5 rounded-xl border border-white/10 bg-black/20 px-3 py-2.5">
        <div className="min-w-0"><strong className="block truncate text-xs text-white/85">Subscription · {new Date(row.createdAt).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}</strong></div>
        <span data-testid={`membership-credit-sync-state-${row.invoiceId}`} aria-label={row.reason === "processing_error" ? retryLabel(row.retry) : row.reason === "snapshot_not_configured" ? "Price history setup needed" : "Invoice review needed"} title={row.reason === "processing_error" ? retryLabel(row.retry) : undefined} className="shrink-0 rounded-full border border-amber-200/20 bg-amber-100/[.04] px-2 py-1 text-[9px] text-amber-100/80">{row.reason === "processing_error" ? retryBadge(row.retry) : row.reason === "snapshot_not_configured" ? "Setup needed" : "Review needed"}</span>
        <details data-testid={`membership-credit-reference-${row.invoiceId}`} className="col-span-full text-[10px] text-white/55"><summary className="cursor-pointer">Invoice reference</summary><code className="mt-1 block break-all font-mono text-[10px] text-white/70">{row.invoiceId}</code></details>
        {row.reason === "processing_error" && effectiveRetryState(row.retry) === "available" && <button type="button" data-testid={`membership-credit-sync-${row.invoiceId}`} onClick={() => void sync(row)} disabled={busyId !== null} className="col-span-full min-h-9 justify-self-start rounded-xl border border-amber-100/20 bg-gradient-to-r from-amber-200 via-amber-100 to-orange-200 px-3.5 text-[11px] font-semibold text-zinc-950 shadow-[0_6px_18px_rgba(207,158,102,.12)] transition hover:-translate-y-px disabled:translate-y-0 disabled:opacity-50">{busyId === row.invoiceId ? "Checking…" : "Retry"}</button>}
        {notice?.invoiceId === row.invoiceId && <p role="status" aria-live="polite" className={`col-span-full m-0 rounded-xl border px-2.5 py-2 text-[11px] leading-4 ${notice.tone === "ok" ? "border-emerald-200/15 bg-emerald-200/[.06] text-emerald-50" : "border-amber-200/15 bg-amber-200/[.06] text-amber-50"}`}>{notice.text}</p>}
      </article>)}
      {status !== "Exhausted" && <button type="button" data-testid="membership-invoice-load-more" onClick={() => loadMore(30)} disabled={status === "LoadingMore"} className="min-h-9 justify-self-start rounded-xl border border-white/15 px-3.5 text-[11px] text-white/75 disabled:opacity-50">{status === "LoadingMore" ? "Loading more reviews…" : "Load more invoice reviews"}</button>}
    </div>
  </details>;
}
