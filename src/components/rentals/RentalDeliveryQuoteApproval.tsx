"use client";

import { useState } from "react";
import { useAction, useQuery } from "convex/react";
import { api } from "@cvx/_generated/api";
import { formatGbp } from "@/lib/pricing";

export function RentalDeliveryQuoteApproval({ token, quoteId }: { token: string; quoteId: string }) {
  const quote = useQuery(api.rentalDeliveryState.customerQuote, { token, id: quoteId as any });
  const accept = useAction(api.rentalDelivery.accept);
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [complete, setComplete] = useState(false);
  if (!quote) return <p className="mt-3 text-xs text-white/50">Loading delivery quote…</p>;
  const expired = quote.expiresAt <= Date.now() || quote.status === "expired" || quote.status === "failed";
  const legs = quote.deliveryLegs === "one_way" ? "One-way delivery" : "Delivery and collection";
  async function proceed() {
    if (!termsAccepted || busy) return;
    setBusy(true);
    setError("");
    try {
      const result = await accept({ token, id: quoteId as any, accepted: true });
      if (result.url) window.location.assign(result.url);
      else if (result.paid) setComplete(true);
    } catch (e: any) {
      setError(e.message ?? "Delivery could not be accepted. Please message the team.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="mt-3 rounded-xl border border-sky-200/15 bg-sky-300/[0.06] p-3 text-xs text-sky-50">
      <p className="font-semibold">{legs} · {formatGbp(quote.amountPence / 100)}</p>
      <p className="mt-1 text-white/65">Delivery address: {quote.deliveryAddress}</p>
      {quote.discountPence > 0 && <p className="mt-1 text-emerald-200/85">Member saving: {formatGbp(quote.discountPence / 100)}{quote.isStudioBenefit ? " · monthly Studio delivery benefit" : ""}</p>}
      <details className="mt-3 rounded-lg border border-white/10 p-2">
        <summary className="cursor-pointer font-medium">Read delivery terms</summary>
        <p className="mt-2 leading-relaxed text-white/70">{quote.termsText}</p>
      </details>
      {quote.status === "paid" && <p className="mt-3 text-emerald-200">Delivery is confirmed.</p>}
      {complete && <p className="mt-3 text-emerald-200">Your delivery terms are accepted and delivery is confirmed.</p>}
      {quote.status === "checkout_open" && quote.paymentUrl && !expired && <a href={quote.paymentUrl} className="mt-3 inline-flex rounded-full border border-current/25 px-3 py-2 font-medium">Continue to secure payment · {formatGbp(quote.amountPence / 100)}</a>}
      {quote.status === "creating_checkout" && <p className="mt-3 text-white/65">Your secure payment link is being prepared. It will appear in this conversation shortly.</p>}
      {quote.status === "awaiting_acceptance" && !expired && !complete && <>
        <label className="mt-3 flex cursor-pointer items-start gap-2 leading-relaxed text-white/75">
          <input type="checkbox" checked={termsAccepted} onChange={e => setTermsAccepted(e.target.checked)} className="mt-0.5 accent-sky-300" />
          <span>I have reviewed and accept these delivery terms and this delivery address.</span>
        </label>
        <button type="button" onClick={() => void proceed()} disabled={!termsAccepted || busy} className="mt-3 rounded-full bg-sky-200 px-4 py-2 font-semibold text-slate-950 disabled:opacity-40">
          {busy ? "Preparing…" : quote.amountPence === 0 ? "Accept included delivery" : `Accept terms & pay ${formatGbp(quote.amountPence / 100)}`}
        </button>
      </>}
      {expired && <p className="mt-3 text-amber-100/80">This quote is no longer current. Ask the rental team for a fresh quote.</p>}
      {error && <p role="alert" className="mt-3 text-rose-200">{error}</p>}
    </div>
  );
}
