"use client";

import { useEffect, useState } from "react";
import { useAction, useQuery } from "convex/react";
import { api } from "@cvx/_generated/api";
import { formatGbp } from "@/lib/pricing";
import { approvedStripeCheckoutUrl } from "@/lib/chatLinks";
import { renterFacingError } from "@/lib/renterFacingError";
import { SmartImage } from "@/components/SmartImage";
import { DELIVERY_TERMS_VERSION } from "../../../shared/rentalAgreement";
import { ChatAperture } from "./ChatAperture";

export function RentalDeliveryQuoteApproval({ token, quoteId }: { token: string; quoteId: string }) {
  const quote = useQuery(api.rentalDeliveryState.customerQuote, { token, id: quoteId as any });
  const accept = useAction(api.rentalDelivery.accept);
  const decline = useAction(api.rentalDelivery.decline);
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [useAccountCredit, setUseAccountCredit] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [complete, setComplete] = useState(false);
  const [declined, setDeclined] = useState(false);
  const [paymentProcessing, setPaymentProcessing] = useState(false);
  const [now, setNow] = useState(Date.now());
  const quoteDeadline = quote ? Math.min(quote.expiresAt, quote.checkoutExpiresAt ?? quote.expiresAt) : null;
  useEffect(() => {
    if (quoteDeadline === null) return;
    const remaining = quoteDeadline - Date.now();
    if (remaining <= 0) {
      setNow(Date.now());
      return;
    }
    const timer = window.setTimeout(() => setNow(Date.now()), remaining + 25);
    return () => window.clearTimeout(timer);
  }, [quoteDeadline]);
  if (!quote) return <p className="mt-3 text-xs text-white/50">Loading delivery quote…</p>;
  const expired = quote.status === "expired" || quote.status === "failed" || !["paid", "declined"].includes(quote.status) && now >= (quoteDeadline ?? quote.expiresAt);
  const paymentUrl = approvedStripeCheckoutUrl(quote.paymentUrl);
  const legs = quote.deliveryLegs === "one_way" ? "One-way delivery" : "Delivery and collection";
  const deliveryTermsVersion = typeof quote.termsVersion === "string" ? quote.termsVersion.split("+")[0] : DELIVERY_TERMS_VERSION;
  const creditEstimatePence = useAccountCredit ? Math.min(quote.availableAccountCreditPence ?? 0, quote.amountPence) : 0;
  const cardDuePence = Math.max(0, quote.amountPence - creditEstimatePence);
  const statusLabel = complete || quote.status === "paid" ? "Confirmed" : paymentProcessing ? "Payment processing" : declined || quote.status === "declined" ? "Declined" : expired ? "Quote expired" : quote.status === "awaiting_acceptance" ? "Your action" : quote.status === "checkout_open" ? "Payment due" : quote.status === "creating_checkout" ? "Preparing payment" : "Delivery update";
  const deliveryItems = Array.isArray(quote.items) ? quote.items : [];
  async function proceed() {
    if (!termsAccepted || busy) return;
    setBusy(true);
    setError("");
    try {
      const result = await accept({ token, id: quoteId as any, accepted: true, useAccountCredit });
      if (result.url) {
        const paymentUrl = approvedStripeCheckoutUrl(result.url);
        if (!paymentUrl) throw Error("The secure payment link could not be verified. Please ask us for a fresh quote.");
        window.location.assign(paymentUrl);
      }
      else if (result.paid) setComplete(true);
      else if (result.processing) setPaymentProcessing(true);
    } catch (e: any) {
      setError(renterFacingError(e, "Delivery could not be accepted. Your rental is unchanged. Please try again."));
    } finally {
      setBusy(false);
    }
  }
  async function passOnQuote() {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await decline({ token, id: quoteId as any });
      setDeclined(true);
    } catch (e: any) {
      setError(renterFacingError(e, "This quote could not be declined. Your rental is unchanged. Please try again."));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section aria-label="Delivery quote" data-testid="rental-delivery-quote-card" className="mt-3 max-w-3xl overflow-hidden rounded-[26px] border border-white/20 bg-[radial-gradient(ellipse_at_100%_100%,rgba(169,111,49,.2),transparent_42%),linear-gradient(145deg,#292a2c,#17181b_48%,#1c1b1b)] p-4 text-sm text-white shadow-[inset_0_1px_0_rgba(255,255,255,.12),0_16px_40px_rgba(0,0,0,.25)] sm:p-6">
      <div className="text-center"><ChatAperture /><h3 className="mt-1 text-xl font-semibold tracking-tight sm:text-2xl">Delivery quote</h3><p className="mt-1 text-xs text-white/60">{legs} for your rental</p></div>
      <div className="mt-4 rounded-2xl border border-[#e5c18a]/25 bg-gradient-to-br from-white/[.08] via-white/[.035] to-[#b9854e]/[.1] p-3.5 shadow-[inset_0_1px_rgba(255,255,255,.07)] sm:p-4">
        <div className="flex min-w-0 items-center gap-3">
          <span aria-hidden="true" className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-[#e6bf84]/25 bg-[#deb37b]/[.08] text-[#f1cb91]"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5"><path d="M3 6h11v10H3zM14 9h4l3 3v4h-7z"/><circle cx="7" cy="17" r="1.7"/><circle cx="18" cy="17" r="1.7"/></svg></span>
          <div className="min-w-0 flex-1"><p className="text-[10px] font-semibold uppercase tracking-[.12em] text-amber-100/70">{statusLabel}</p><p className="mt-1 break-words font-semibold leading-snug text-white">{legs}</p></div>
          <strong className="shrink-0 text-xl text-[#f6d79e] sm:text-2xl">{formatGbp(quote.amountPence / 100)}</strong>
        </div><span data-testid="delivery-quote-stage" className="sr-only">{statusLabel}</span>
      </div>
      <div className="mt-4 flex gap-3 border-b border-white/15 pb-4"><span aria-hidden="true" className="mt-0.5 text-[#e8bf83]"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5"><path d="M19 10c0 5-7 10-7 10s-7-5-7-10a7 7 0 1 1 14 0Z"/><circle cx="12" cy="10" r="2.2"/></svg></span><div className="min-w-0"><p className="text-[10px] font-semibold uppercase tracking-[.14em] text-amber-200/70">Delivery address</p><p className="mt-1 break-words text-sm leading-relaxed text-white/85">{quote.deliveryAddress}</p></div></div>
      {deliveryItems.length > 0 && <><h4 className="mt-4 text-sm font-semibold text-white/90">Items in this rental</h4><div data-testid="delivery-quote-listings" className="mt-2 grid gap-2 sm:grid-cols-2" aria-label="Items included in this delivery">
        {deliveryItems.map((item: any, index: number) => <article key={`${item.title}-${index}`} className="flex min-w-0 items-center gap-3 rounded-2xl border border-white/15 bg-white/[.045] p-2.5">
          {item.imageSources?.length > 0 && <SmartImage fit="contain" src={item.imageSources[0]} fallbackSources={item.imageSources.slice(1)} alt={`${item.title} listing photo`} className="h-16 w-20 shrink-0 rounded-xl bg-black/25" />}
          <p className="min-w-0 break-words text-xs font-medium leading-snug text-white/90">{item.qty}× {item.title}</p>
        </article>)}
      </div></>}
      {quote.deliveryLegs === "one_way" && <p data-testid="delivery-quote-return-point" className="mt-3 flex gap-2 text-xs leading-relaxed text-white/65"><span aria-hidden="true" className="text-amber-200">↗</span><span>Return outside the Waterstones bookstore in Trafalgar Square.</span></p>}
      {quote.discountPence > 0 && <p className="mt-1 text-emerald-200/85">Member saving: {formatGbp(quote.discountPence / 100)}{quote.isStudioBenefit ? " · monthly Studio delivery benefit" : ""}</p>}
      {quote.creditAppliedPence > 0 && <p className="mt-1 text-emerald-200/85">Account credit used: {formatGbp(quote.creditAppliedPence / 100)} · card balance: {formatGbp((quote.cardDuePence ?? quote.amountPence) / 100)}</p>}
      {!expired && !complete && !declined && !["paid", "declined"].includes(quote.status) && <p className="mt-3 rounded-xl border border-amber-100/10 bg-amber-100/[.035] px-3 py-2.5 text-xs leading-relaxed text-white/65">Collection stays in place until delivery is accepted and paid.</p>}
      <details className="mt-4 rounded-2xl border border-white/15 bg-white/[.035] px-3">
        <summary className="min-h-11 cursor-pointer content-center font-medium text-white/85 marker:text-amber-200">Your quote terms</summary>
        <p className="border-t border-white/10 py-3 text-xs leading-relaxed text-white/70">{quote.termsText}</p>
      </details>
      <a data-testid="delivery-terms-link" href={`/legal/delivery-disclaimer?version=${encodeURIComponent(deliveryTermsVersion)}`} target="_blank" rel="noopener noreferrer" className="mt-1 flex min-h-11 w-fit items-center text-amber-200 underline decoration-amber-200/60 underline-offset-4 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-100">Open delivery terms ↗</a>
      {quote.status === "paid" && <p className="mt-3 text-emerald-200">Delivery is confirmed.</p>}
      {(quote.status === "declined" || declined) && <p className="mt-3 text-white/65">Quote declined · your rental stays collection-only.</p>}
      {complete && <p className="mt-3 text-emerald-200">Your delivery terms are accepted and delivery is confirmed.</p>}
      {paymentProcessing && <p role="status" data-testid="delivery-payment-processing" className="mt-3 rounded-lg border border-sky-100/10 bg-black/15 px-2.5 py-2 text-[11px] leading-relaxed text-white/70">Stripe is processing this payment. Delivery remains unconfirmed until payment succeeds.</p>}
      {quote.status === "checkout_open" && paymentUrl && !expired && !paymentProcessing && <a data-testid="delivery-quote-payment-link" href={paymentUrl} target="_blank" rel="noopener noreferrer" className="mt-3 inline-flex min-h-11 items-center justify-center rounded-xl border border-sky-100/20 bg-sky-100/[.09] px-4 py-2 font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-100">Continue to secure payment · {formatGbp((quote.cardDuePence ?? quote.amountPence) / 100)}</a>}
      {quote.status === "checkout_open" && quote.paymentUrl && !paymentUrl && !expired && <p role="alert" className="mt-3 text-amber-100/80">The secure payment link could not be verified. Ask us for a fresh quote.</p>}
      {quote.status === "creating_checkout" && <p className="mt-3 text-white/65">Your secure payment link is being prepared. It will appear in this conversation shortly.</p>}
      {quote.status === "awaiting_acceptance" && !expired && !complete && <>
        {(quote.availableAccountCreditPence ?? 0) > 0 && quote.amountPence > 0 && <label data-testid="delivery-quote-account-credit" className="mt-3 flex min-h-11 cursor-pointer items-center gap-2 rounded-lg border border-emerald-200/15 bg-emerald-200/[.04] px-2.5 text-white/75">
          <input type="checkbox" checked={useAccountCredit} onChange={e => setUseAccountCredit(e.target.checked)} className="accent-emerald-300" />
          <span>Use account credit · up to {formatGbp((quote.availableAccountCreditPence ?? 0) / 100)}{useAccountCredit ? ` · card due ${formatGbp(cardDuePence / 100)}` : ""}</span>
        </label>}
        <label data-testid="delivery-quote-terms" className="mt-3 flex min-h-11 cursor-pointer items-center gap-2 leading-relaxed text-white/75">
          <input type="checkbox" checked={termsAccepted} onChange={e => setTermsAccepted(e.target.checked)} className="mt-0.5 accent-sky-300" />
          <span>I have reviewed and accept the delivery terms shown above and this delivery address.</span>
        </label>
        <button type="button" data-testid="delivery-quote-accept" onClick={() => void proceed()} disabled={!termsAccepted || busy} className="mt-3 inline-flex min-h-11 w-full items-center justify-center rounded-xl bg-gradient-to-r from-[#ffda90] to-[#c99452] px-4 py-2 font-semibold text-[#17120d] shadow-[inset_0_1px_rgba(255,255,255,.35)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-100 disabled:opacity-40">
          {busy ? "Preparing…" : quote.amountPence === 0 ? "Accept included delivery" : cardDuePence === 0 ? `Accept & use ${formatGbp(creditEstimatePence / 100)} credit` : `Accept terms & pay ${formatGbp(cardDuePence / 100)}`}
        </button>
        <button type="button" data-testid="delivery-quote-decline" onClick={() => void passOnQuote()} disabled={busy} className="mt-2 inline-flex min-h-11 w-full items-center justify-center rounded-xl border border-white/15 px-4 py-2 font-medium text-white/75 disabled:opacity-40">
          {busy ? "Saving…" : "Decline quote"}
        </button>
      </>}
      {expired && <p className="mt-3 text-amber-100/80">This quote is no longer current. Ask the rental team for a fresh quote.</p>}
      {error && <p role="alert" className="mt-3 text-rose-200">{error}</p>}
    </section>
  );
}
