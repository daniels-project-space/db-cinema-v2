"use client";

import { useState } from "react";
import { useAction, useQuery } from "convex/react";
import { api } from "@cvx/_generated/api";
import type { Id } from "@cvx/_generated/dataModel";

type Props = { token: string; accountId: Id<"accounts"> };
type Row = { invoiceId: string; reason: string; createdAt: number; retryAt: number | null };
type Notice = { invoiceId: string; text: string; tone: "ok" | "info" };

const messages: Record<string, string> = {
  processing_error: "The paid invoice credit did not finish syncing.",
  snapshot_not_configured: "Historical membership pricing is not configured.",
  too_many_lines: "This invoice needs a manual Stripe check.",
};
const money = (pence: number) => new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" }).format(pence / 100);

export function MembershipInvoiceRecovery({ token, accountId }: Props) {
  const rows = useQuery(api.membershipInvoiceReviews.adminList, { token, accountId }) as Row[] | undefined;
  const inspect = useAction(api.checkout.adminInspectMembershipInvoice);
  const retry = useAction(api.checkout.adminRetryMembershipInvoice);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);

  if (!rows?.length) return null;

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
      setNotice({ invoiceId: row.invoiceId, text: result.state === "resolved" ? `Credit synced · ${money(check.receipt?.creditPence ?? check.tierCheck?.earnedCreditPence ?? 0)}.` : "Still needs attention. Check the Stripe invoice details.", tone: result.state === "resolved" ? "ok" : "info" });
    } catch (error) {
      setNotice({ invoiceId: row.invoiceId, text: error instanceof Error ? error.message : "Credit sync could not finish.", tone: "info" });
    } finally {
      setBusyId(null);
    }
  }

  return <details className="group mt-3 w-full min-w-0 box-border rounded-lg border border-amber-200/15 bg-black/15 p-2.5" data-testid="membership-invoice-recovery">
    <summary className="flex w-full min-w-0 min-h-9 cursor-pointer list-none items-center justify-between gap-3 text-xs text-white/85">
      <span className="flex min-w-0 flex-1 items-center gap-2"><span className="grid h-6 w-6 shrink-0 place-items-center rounded-md border border-amber-200/20 bg-amber-100/[.07] text-amber-100" aria-hidden="true">↻</span><span className="truncate font-medium">Invoice credit sync</span></span>
      <span className="shrink-0 rounded-full border border-amber-200/25 px-2 py-1 text-[10px] text-amber-100">{rows.length} to check</span>
    </summary>
    <div className="mt-2 grid max-h-60 gap-2 overflow-y-auto pr-1">
      {rows.map(row => <article key={row.invoiceId} className="grid min-w-0 gap-2 rounded-lg border border-white/10 bg-black/20 p-2.5">
        <div className="flex min-w-0 items-start justify-between gap-2">
          <div className="min-w-0"><strong className="block truncate text-xs text-white/85">Paid membership invoice</strong><span className="mt-0.5 block truncate font-mono text-[10px] text-white/45">{row.invoiceId}</span></div>
          <span className="shrink-0 rounded-full border border-amber-200/20 px-2 py-1 text-[9px] text-amber-100/80">{row.reason === "processing_error" ? "Needs sync" : "Needs setup"}</span>
        </div>
        <p className="m-0 text-[11px] leading-4 text-white/55">{messages[row.reason] ?? "Automatic credit reconciliation needs another pass."}</p>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-[10px] text-white/40">{new Date(row.createdAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}</span>
          <button type="button" data-testid={`membership-credit-sync-${row.invoiceId}`} onClick={() => void sync(row)} disabled={busyId !== null || row.reason !== "processing_error"} className="min-h-9 rounded-lg border border-amber-100/30 bg-amber-100/[.09] px-3 text-[11px] font-medium text-amber-50 transition hover:bg-amber-100/[.15] disabled:cursor-not-allowed disabled:opacity-50">{busyId === row.invoiceId ? "Checking…" : row.reason === "processing_error" ? "Check & sync" : "Sync unavailable"}</button>
        </div>
        {notice?.invoiceId === row.invoiceId && <p role="status" aria-live="polite" className={`m-0 rounded-md px-2.5 py-2 text-[11px] leading-4 ${notice.tone === "ok" ? "bg-emerald-300/10 text-emerald-100" : "bg-white/[.06] text-white/70"}`}>{notice.text}</p>}
      </article>)}
    </div>
  </details>;
}
