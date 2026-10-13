"use client";
import {ASSESSMENT_SECURITY_POLICY_VERSION} from "../../../shared/rentalSecurity";

import {securityAmendmentConsentText} from "../../../shared/savedCardSecurity";
import { useEffect,useState } from "react";
import { useQuery, useAction } from "convex/react";
import { loadStripe } from "@stripe/stripe-js";
import { api } from "@cvx/_generated/api";
import { formatGbp } from "@/lib/pricing";
import { rentalTitle } from "@/lib/rentalPresentation";
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
              : "Please contact the team to resolve the card hold.",
        );
    } catch (e: any) {
      setMessage(e.message ?? "Bank approval could not complete.");
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
  return (
    <aside className="border-b border-amber-400/15 bg-amber-400/[0.04] px-5 py-4">
      <p className="text-sm font-medium text-white/85">
        Proposed addition · {r.qty}× {rentalTitle(r.title)}
      </p>
      <p className="mt-1 text-xs leading-relaxed text-white/50">
        {formatGbp(r.amount)} due · includes {formatGbp(r.securityCharge)} extra
        refundable security. {r.savedCardLimit===undefined?`Updated hold ${formatGbp(r.holdTotal)}.`:"No card hold."} Items join
        your order after payment and bank approval.
      </p>
      {r.requiresAcceptance&&<div className="mt-3 space-y-3 rounded-xl border border-sky-300/20 p-3">
        <p className="text-sm">Refundable deposit {formatGbp(r.priorDeposit??0)} → {formatGbp(r.depositAmount)}{r.securityPolicyVersion!==ASSESSMENT_SECURITY_POLICY_VERSION&&<><br/>Combined damage / late-fee limit {formatGbp(r.priorSavedCardLimit??0)} → {formatGbp(r.savedCardLimit??0)}</>}</p>
        <p className="text-xs text-white/60">Retained deposit reduces the same assessed loss. Notice and dispute rights remain unchanged.</p>
        <details className="text-xs text-white/60"><summary>Read the updated permission</summary><p className="mt-2 leading-relaxed">{securityAmendmentConsentText(r.savedCardLimit??0,r.depositAmount,r.priorSavedCardLimit??0,r.priorDeposit??0,r.securityPolicyVersion)}</p></details>
        <label className="flex items-start gap-2 text-xs"><input type="checkbox" checked={accepted} disabled={busy} onChange={e=>setAccepted(e.target.checked)}/>I accept this equipment change and the deposit / saved-card amounts shown.</label>
        <button className="rounded-full bg-sky-500 px-4 py-2 text-xs font-semibold disabled:opacity-40" disabled={busy||!accepted} onClick={()=>{setBusy(true);setMessage(null);void acceptSecurity({token,bookingId:bookingId as any,additionId:r.id,expectedDeposit:r.depositAmount,expectedLimit:r.savedCardLimit??0,confirmed:true}).then(result=>{if(result.url)window.location.assign(result.url);else setMessage("Equipment update accepted.")}).catch(e=>setMessage(e.message)).finally(()=>setBusy(false))}}>Accept equipment update{r.amount>0?" & continue to payment":""}</button>
      </div>}
      <div className="mt-3 flex flex-wrap gap-3">
        {r.url && r.status === "awaiting_payment" && (
          <a
            href={r.url}
            className="rounded-full bg-white px-4 py-2 text-xs font-medium text-black"
          >
            Review & pay
          </a>
        )}
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
                  ? "Approve card hold"
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
