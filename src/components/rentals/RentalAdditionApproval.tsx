"use client";
import {ASSESSMENT_SECURITY_POLICY_VERSION,isSetupIntentSecurityPolicy} from "../../../shared/rentalSecurity";

import {securityAmendmentConsentText} from "../../../shared/savedCardSecurity";
import { useEffect,useState } from "react";
import { useQuery, useAction } from "convex/react";
import { loadStripe } from "@stripe/stripe-js";
import { api } from "@cvx/_generated/api";
import { formatGbp } from "@/lib/pricing";
import { rentalTitle } from "@/lib/rentalPresentation";
import { SmartImage } from "@/components/SmartImage";
import { approvedStripeCheckoutUrl } from "@/lib/chatLinks";
import { renterFacingError } from "@/lib/renterFacingError";
export function RentalAdditionApproval({
  token,
  bookingId,
}: {
  token: string;
  bookingId: string;
}) {
  const r = useQuery(api.rentalAdditionState.customerState, {
    token,
    bookingId: bookingId as any,
  });
  const acceptSecurity=useAction(api.rentalAdditions.acceptEquipmentSecurity);
  const useAccountCredit=useAction(api.rentalAdditions.useAccountCredit);
  const [accepted,setAccepted]=useState(false);
  const resume = useAction(api.rentalAdditions.resumeByCustomer);
  const [busy, setBusy] = useState(false),
    [message, setMessage] = useState<string | null>(null);
  useEffect(()=>setAccepted(false),[r?.id,r?.depositAmount,r?.savedCardLimit]);
  if (!r) return null;
  async function approve() {
    setBusy(true);
    setMessage(null);
    try {
      const result = await resume({ token, bookingId: bookingId as any });
      if (result.clientSecret) {
        const key = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY;
        if (!key)
          throw Error("Bank approval is unavailable. Contact the team.");
        const stripe = await loadStripe(key);
        if (!stripe) throw Error("Bank approval could not open.");
        const confirmation = await stripe.confirmCardPayment(
          result.clientSecret,
        );
        if (confirmation.error)
          throw Error(
            confirmation.error.message ?? "Your bank did not approve the hold.",
          );
        const final = await resume({ token, bookingId: bookingId as any });
        setMessage(
          final.status === "held"
            ? "Items added to your order."
            : "The team is checking the payment status.",
        );
      } else
        setMessage(
          result.status === "held"
            ? "Items added to your order."
            : result.status === "awaiting_payment"
              ? "Review and pay for the proposed items using the link above."
              : "Please contact the team to resolve the payment or security update.",
        );
    } catch (e: any) {
      setMessage(renterFacingError(e, "Bank approval could not complete. Your existing rental is unchanged."));
    } finally {
      setBusy(false);
    }
  }
  if (["withdrawing", "refund_pending", "refund_failed"].includes(r.status)) return (
    <aside role="status" className="border-b border-amber-400/15 bg-amber-400/[0.04] px-5 py-4">
      <p className="text-sm font-medium text-white/85">Item addition withdrawn · {r.qty}× {rentalTitle(r.title)}</p>
      <p className="mt-1 text-xs leading-relaxed text-white/50">{r.status === "refund_failed" ? "The refund needs the team’s attention. Please contact us in this rental conversation." : "We’re confirming the payment and any refund to your original payment method. This item will not be added while withdrawal is processing."}</p>
    </aside>
  );
  const paymentUrl = approvedStripeCheckoutUrl(r.url);
  return (
    <aside className="border-b border-amber-400/15 bg-amber-400/[0.04] px-5 py-4">
      <p className="text-[10px] font-medium uppercase tracking-[.14em] text-amber-100/60">Proposed item</p>
      <div className="mt-2 flex min-w-0 items-center gap-3">
        <SmartImage fit="contain" src={r.imageSources?.[0]} fallbackSources={r.imageSources?.slice(1)} alt={`${r.title} listing photo`} className="h-[76px] w-[88px] shrink-0 rounded-xl border border-white/10 bg-black/25" />
        <div className="min-w-0">
          <p className="break-words text-sm font-medium text-white/90">{r.qty}× {rentalTitle(r.title)}</p>
          <p className="mt-1 text-[11px] text-white/45">Items join your order after payment and any required bank approval.</p>
        </div>
      </div>
      <div data-testid="addition-charge-breakdown" className="mt-3 space-y-1 rounded-xl border border-white/[0.08] bg-black/15 px-3 py-2.5 text-xs">
        {r.existingCheckoutBalance > 0 && <div className="flex justify-between gap-3 text-white/55"><span>Existing checkout balance</span><span className="tabular-nums">{formatGbp(r.existingCheckoutBalance)}</span></div>}
        <div className="flex justify-between gap-3 text-white/70"><span>Added rental charge</span><span className="tabular-nums">{formatGbp(r.rentalCharge)}</span></div>
        {r.benefitSaving > 0 && <p className="text-[10px] text-emerald-200/80">{r.benefitLabel ?? "Member saving"} · {formatGbp(r.benefitSaving)} already applied</p>}
        {r.securityCharge > 0 && <div className="flex justify-between gap-3 text-white/55"><span>Additional refundable security</span><span className="tabular-nums">{formatGbp(r.securityCharge)}</span></div>}
        {r.creditOptIn && r.creditAppliedPence > 0 && <div className="flex justify-between gap-3 text-emerald-200"><span>Account credit</span><span className="tabular-nums">−{formatGbp(r.creditAppliedPence / 100)}</span></div>}
        <div className="mt-1 flex justify-between gap-3 border-t border-white/[0.08] pt-2 font-semibold text-white"><span>{r.creditOptIn ? "Card payment due" : "Total due"}</span><span data-testid="addition-total-due" className="tabular-nums">{formatGbp(r.creditOptIn ? r.cardDuePence / 100 : r.amount)}</span></div>
      </div>
      {!r.draftReplacement && !r.requiresAcceptance && !r.creditOptIn && r.availableAccountCreditPence > 0 && r.status === "awaiting_payment" && <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-emerald-200/15 bg-emerald-200/[.045] px-3 py-2.5">
        <p className="text-xs leading-relaxed text-white/70">Available account credit · <span className="font-semibold text-emerald-100">{formatGbp(r.availableAccountCreditPence / 100)}</span><br/><span className="text-[10px] text-white/45">Use it toward the rental charge; security stays separate.</span></p>
        <button type="button" data-testid="addition-use-account-credit" disabled={busy} onClick={()=>{setBusy(true);setMessage(null);void useAccountCredit({token,bookingId:bookingId as any}).then(result=>{if(result.url){const url=approvedStripeCheckoutUrl(result.url);if(!url)throw Error("The secure payment link could not be verified.");window.location.assign(url);}else if(result.applied)setMessage("Account credit applied and the item was added to your rental.");else setMessage("Account credit applied. The team is checking the payment status.");}).catch(e=>setMessage(renterFacingError(e,"Account credit could not be applied. Your rental and balance are unchanged."))).finally(()=>setBusy(false));}} className="inline-flex min-h-10 items-center justify-center rounded-xl border border-emerald-200/20 bg-emerald-200/[.1] px-3 py-2 text-xs font-semibold text-emerald-50 disabled:opacity-40">Use credit & continue</button>
      </div>}
      {r.creditOptIn && <p className="mt-2 text-[11px] text-emerald-100/70">Your account credit is reserved for this item update and is only spent once it is confirmed.</p>}
      {isSetupIntentSecurityPolicy(r.securityPolicyVersion) && <p className="mt-2 text-[11px] leading-relaxed text-white/45">No deposit or card hold is added; your existing saved-card terms remain in place.</p>}
      {r.requiresAcceptance&&<div className="mt-3 space-y-3 rounded-xl border border-sky-300/20 p-3">
        <p className="text-sm">Refundable deposit {formatGbp(r.priorDeposit??0)} → {formatGbp(r.depositAmount)}{r.securityPolicyVersion!==ASSESSMENT_SECURITY_POLICY_VERSION&&<><br/>Combined damage / late-fee limit {formatGbp(r.priorSavedCardLimit??0)} → {formatGbp(r.savedCardLimit??0)}</>}</p>
        <p className="text-xs text-white/60">Retained deposit reduces the same assessed loss. Notice and dispute rights remain unchanged.</p>
        <details className="text-xs text-white/60"><summary>Read the updated permission</summary><p className="mt-2 leading-relaxed">{securityAmendmentConsentText(r.savedCardLimit??0,r.depositAmount,r.priorSavedCardLimit??0,r.priorDeposit??0,r.securityPolicyVersion)}</p></details>
        <label className="flex items-start gap-2 text-xs"><input type="checkbox" checked={accepted} disabled={busy} onChange={e=>setAccepted(e.target.checked)}/>I accept this equipment change and the deposit / saved-card amounts shown.</label>
        <button className="rounded-full bg-sky-500 px-4 py-2 text-xs font-semibold disabled:opacity-40" disabled={busy||!accepted} onClick={()=>{setBusy(true);setMessage(null);void acceptSecurity({token,bookingId:bookingId as any,additionId:r.id,expectedDeposit:r.depositAmount,expectedLimit:r.savedCardLimit??0,confirmed:true}).then(result=>{if(result.url){const paymentUrl=approvedStripeCheckoutUrl(result.url);if(!paymentUrl)throw Error("The secure payment link could not be verified. Please ask the team for a fresh link.");window.location.assign(paymentUrl);}else setMessage("Equipment update accepted.")}).catch(e=>setMessage(renterFacingError(e,"The equipment update could not be accepted. Your current order is unchanged."))).finally(()=>setBusy(false))}}>Accept equipment update{r.amount>0?" & continue to payment":""}</button>
      </div>}
      <div className="mt-3 flex flex-wrap gap-3">
        {r.requiresAcceptance && r.status === "awaiting_payment" && <p role="note" data-testid="addition-payment-locked" className="text-xs text-amber-100/75">Accept the updated security terms above to unlock payment.</p>}
        {paymentUrl && !r.requiresAcceptance && r.status === "awaiting_payment" && (
          <a
            data-testid="addition-payment-link"
            href={paymentUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex min-h-11 items-center justify-center rounded-full bg-white px-4 py-2 text-xs font-medium text-black"
          >
            Review & pay {formatGbp(r.creditOptIn ? r.cardDuePence / 100 : r.amount)}
          </a>
        )}
        {r.url && !paymentUrl && r.status === "awaiting_payment" && <p role="alert" className="text-xs text-amber-100/80">Secure payment link unavailable · ask us here for a fresh link.</p>}
        {r.sessionId &&
          ["paid", "requires_action", "held", "failed"].includes(r.status) && (
            <button
              disabled={busy}
              onClick={() => void approve()}
              className="rounded-full border border-white/15 px-4 py-2 text-xs text-white/75 disabled:opacity-40"
            >
              {busy
                ? "Checking your bank…"
                : r.status === "requires_action"
                  ? isSetupIntentSecurityPolicy(r.securityPolicyVersion)?"Approve payment":"Approve card hold"
                  : "Check payment status"}
            </button>
          )}
      </div>
      {message && (
        <p role="status" className="mt-2 text-xs text-amber-100">
          {message}
        </p>
      )}
    </aside>
  );
}
