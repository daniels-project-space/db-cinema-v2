"use client";
import { useState } from "react";
import { useAction, useQuery } from "convex/react";
import { api } from "@cvx/_generated/api";
import { formatGbp } from "@/lib/pricing";
export function RentalCreditOffer({ token, offerId }: { token: string; offerId: string }) {
  const offer = useQuery(api.rentalCreditOffers.get, { token, offerId: offerId as any });
  const accept = useAction(api.checkout.acceptFullCredit);
  const [consent, setConsent] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState("");
  if (!offer) return null;
  if (offer.status === "accepted") return <p className="mt-3 text-xs text-emerald-200">Credit added to your account.</p>;
  if (!offer.eligible || !offer.enabled) return <p className="mt-3 text-xs text-white/45">This offer is unavailable. The team can help with cancellation.</p>;
  return <div className="mt-4 rounded-xl border border-emerald-300/20 bg-black/20 p-4">
    <p className="text-base font-semibold text-emerald-100">{formatGbp(offer.amountPence / 100)} account credit</p>
    <p className="mt-1 text-xs text-white/50">Valid one year · automatically used at checkout</p>
    <label className="mt-3 flex gap-2 text-xs leading-5 text-white/75"><input type="checkbox" checked={consent} onChange={e=>setConsent(e.target.checked)} disabled={busy} className="mt-1 shrink-0"/>I choose to cancel for account credit instead of a card refund, including my remaining security payment. Unused card holds will be released.</label>
    <button disabled={!consent || busy} onClick={async()=>{setBusy(true);setError("");try{await accept({token,offerId:offerId as any,consent:true});}catch(e:any){setError(e.message ?? "Cancellation failed. Contact the team.");}finally{setBusy(false)}}} className="mt-3 rounded-full bg-emerald-300 px-4 py-2 text-xs font-semibold text-black disabled:opacity-30">{busy?"Settling…":"Cancel & accept credit"}</button>
    {error && <p role="alert" className="mt-2 text-xs text-rose-200">{error}</p>}
  </div>;
}
