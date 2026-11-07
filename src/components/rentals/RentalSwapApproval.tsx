"use client";

import { useState } from "react";
import { useAction, useQuery } from "convex/react";
import { api } from "@cvx/_generated/api";
import { formatGbp } from "@/lib/pricing";

export function RentalSwapApproval({token,bookingId,swapId}:{token:string;bookingId:string;swapId:string}) {
  const proposal=useQuery(api.rentalSwapState.customerProposal,{token,bookingId:bookingId as any,id:swapId as any});
  const accept=useAction(api.rentalSwapPayments.accept);
  const [confirmed,setConfirmed]=useState(false),[busy,setBusy]=useState(false),[notice,setNotice]=useState("");
  if(proposal===undefined)return <p className="mt-3 text-xs text-white/60">Loading equipment proposal…</p>;
  if(proposal===null)return <p className="mt-3 text-xs text-white/60">This equipment proposal is unavailable for this account.</p>;
  const pending=proposal.status==="awaiting_acceptance", expired=pending&&proposal.expiresAt<=Date.now();
  const canContinue=pending&&!expired||["accepted","awaiting_payment","refund_pending"].includes(proposal.status);
  return <section aria-label="Equipment change proposal" className="mt-3 rounded-xl border border-sky-200/20 bg-sky-300/5 p-3 text-xs text-sky-50">
    {proposal.changes?.length?<div className="space-y-1 font-semibold">{proposal.changes.map((change,index)=><p key={`${change.oldTitle}:${index}`}>{change.quantity} × {change.oldTitle} → {change.newTitle}</p>)}</div>:<p className="font-semibold">{proposal.quantity} × {proposal.oldTitle} → {proposal.quantity} × {proposal.newTitle}</p>}
    <p className="mt-2">{proposal.deltaPence>0?"Additional payment":proposal.deltaPence<0?"Original-card refund":"No card payment difference"}{proposal.deltaPence!==0?` · ${formatGbp(Math.abs(proposal.deltaPence)/100)}`:""}</p>
    {proposal.restoreCreditPence>0&&<p className="mt-1">Account credit to restore · {formatGbp(proposal.restoreCreditPence/100)}</p>}
    <p className="mt-2 leading-5 text-white/65">{proposal.stockPending?"Your equipment change is being checked. We’ll confirm it here once availability is verified.":proposal.status==="applied"?"The equipment change is complete.":proposal.status==="refund_pending"?(proposal.stockApplied?"The equipment change is recorded; the refund is still being processed.":"The accepted change is being processed; the equipment has not changed yet."):proposal.status==="review"?"The team needs to review this change before it can continue.":expired||["expired","withdrawn"].includes(proposal.status)?"This proposal is no longer available. Ask the team for a new one.":proposal.status==="refunded"?"The additional payment was refunded; your original equipment is unchanged.":"The same rental dates apply. Review the difference before accepting."}</p>
    {pending&&!expired&&<label className="mt-3 flex items-start gap-2 leading-5"><input type="checkbox" checked={confirmed} disabled={busy} onChange={event=>setConfirmed(event.target.checked)}/><span>I accept this equipment change and the difference shown.</span></label>}
    {canContinue&&<button type="button" disabled={busy||pending&&!confirmed} onClick={async()=>{setBusy(true);setNotice("");try{const result=await accept({token,id:proposal.id,expectedDeltaPence:proposal.deltaPence});if(result.url){const url=new URL(result.url);if(url.protocol!=="https:"||url.hostname!=="checkout.stripe.com")throw Error("The payment link could not be verified. Please contact the team.");window.location.assign(url.toString());}else setNotice(result.applied?"The change is being processed. Check this conversation for confirmation.":result.refunded?"The additional payment was refunded.":result.status==="awaiting_review"?"The refund needs team approval; we will update you here.":result.status==="needs_review"?"The refund needs team review; we will update you here.":"The change is being processed. Please check back here.");}catch(error){setNotice(error instanceof Error?error.message:"The change could not be continued. Please contact the team.");}finally{setBusy(false);}}} className="mt-3 rounded-full border border-current/30 px-3 py-2 font-medium disabled:opacity-40">{busy?"Checking…":pending?"Accept equipment change":proposal.status==="awaiting_payment"?"Continue to secure payment":"Check progress"}</button>}
    {notice&&<p role="status" className="mt-3 leading-5">{notice}</p>}
  </section>;
}
