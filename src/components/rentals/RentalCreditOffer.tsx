"use client";
import { useQuery } from "convex/react";
import { api } from "@cvx/_generated/api";
import { formatGbp } from "@/lib/pricing";
import { isSetupIntentSecurityPolicy } from "../../../shared/rentalSecurity";
import { ChatAperture } from "./ChatAperture";
export function RentalCreditOffer({ token, offerId }: { token: string; offerId: string }) {
  const offer = useQuery(api.rentalCreditOffers.get, { token, offerId: offerId as any });
  if (!offer) return null;
  if (offer.status === "accepted") return <p data-testid="rental-credit-offer-complete" role="status" className="mt-3 text-xs text-emerald-200">The team approved this credit option.</p>;
  if (!offer.eligible) return <p data-testid="rental-credit-offer-unavailable" role="status" className="mt-3 text-xs text-white/45">This option is no longer available. The team can help with cancellation.</p>;
  const setupIntentPolicy = isSetupIntentSecurityPolicy(offer.securityPolicyVersion);
  const securitySummary = setupIntentPolicy
    ? "No deposit or card hold was collected. Saved-card terms still apply."
    : "Proposal includes the remaining security payment; unused holds are released on approval.";
  const bookingId = offer.bookingId, proposedCreditPence = offer.amountPence;
  function requestReview() {
    window.dispatchEvent(new CustomEvent("dbc:open-rental-cancellation", {
      detail: { bookingId, offerId, proposedCreditPence },
    }));
  }
  return <section aria-label="Account credit offer" data-testid="rental-credit-offer" className="mt-4 max-w-3xl overflow-hidden rounded-[26px] border border-white/20 bg-[radial-gradient(ellipse_at_100%_100%,rgba(169,111,49,.2),transparent_42%),linear-gradient(145deg,#292a2c,#17181b_48%,#1c1b1b)] p-4 text-white shadow-[inset_0_1px_rgba(255,255,255,.1),0_16px_40px_rgba(0,0,0,.25)] sm:p-6">
    <div className="text-center"><ChatAperture /><p className="mt-1 text-[10px] font-semibold uppercase tracking-[.15em] text-amber-100/70">Cancellation option</p><h3 className="mt-2 text-xl font-semibold tracking-tight">Proposed cancellation credit</h3><span className="mt-2 inline-flex rounded-full border border-amber-100/20 bg-amber-100/[.06] px-3 py-1 text-[11px] text-amber-50/85">Team review</span></div>
    <div className="mt-4 flex min-w-0 items-center gap-3 rounded-2xl border border-amber-100/20 bg-gradient-to-r from-white/[.07] to-amber-100/[.04] p-3.5"><span aria-hidden="true" className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-amber-100/20 bg-amber-100/[.06] text-amber-100"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5"><rect x="3" y="6" width="18" height="13" rx="2.5"/><path d="M3 10h18M15 15h3"/></svg></span><div className="min-w-0 flex-1"><p className="text-[10px] font-semibold uppercase tracking-[.12em] text-amber-100/70">Proposed credit</p><p className="mt-1 text-xl font-semibold text-[#f6d79e]">{formatGbp(offer.amountPence / 100)}</p></div></div>
    <p data-testid="rental-credit-offer-security-note" className="mt-4 rounded-xl border border-white/10 bg-black/20 px-3.5 py-3 text-xs leading-relaxed text-white/80">{securitySummary}</p>
    <p className="mt-3 text-xs leading-relaxed text-white/70">Requesting review does not cancel your rental or issue credit. The team will decide under your accepted terms.</p>
    <button type="button" data-testid="rental-credit-offer-request-review" onClick={requestReview} className="mt-4 inline-flex min-h-11 w-full items-center justify-center rounded-xl bg-gradient-to-r from-[#ffda90] to-[#c99452] px-4 py-2 text-sm font-semibold text-[#17120d] shadow-[inset_0_1px_rgba(255,255,255,.35)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-100">Request team review</button>
  </section>;
}
