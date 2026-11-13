"use client";

import { useState } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import { api } from "@cvx/_generated/api";
import { formatGbp } from "@/lib/pricing";
import { SmartImage } from "@/components/SmartImage";

export function RentalSwapApproval({token,bookingId,swapId}:{token:string;bookingId:string;swapId:string}) {
  const proposal=useQuery(api.rentalSwapState.customerProposal,{token,bookingId:bookingId as any,id:swapId as any});
  const accept=useAction(api.rentalSwapPayments.accept);
  const decline=useMutation(api.rentalSwapState.customerDecline);
  const [confirmed,setConfirmed]=useState(false),[busy,setBusy]=useState(false),[notice,setNotice]=useState("");
  if(proposal===undefined)return <p className="mt-3 text-xs text-white/60">Loading equipment proposal…</p>;
  if(proposal===null)return <p className="mt-3 text-xs text-white/60">This equipment proposal is unavailable for this account.</p>;

  const pending=proposal.status==="awaiting_acceptance", expired=pending&&proposal.expiresAt<=Date.now();
  const canContinue=pending&&!expired||["accepted","awaiting_payment","refund_pending"].includes(proposal.status);
  const changes=proposal.changes?.length?proposal.changes:[{oldTitle:proposal.oldTitle,newTitle:proposal.newTitle,quantity:proposal.quantity,oldImageSources:proposal.oldImageSources,newImageSources:proposal.newImageSources}];
  const statusLabel=pending?(expired?"Expired":"Your decision"):
    proposal.stockPending?"Checking availability":
    proposal.status==="applied"?"Updated":
    proposal.status==="declined"?"Declined":
    proposal.status==="refund_pending"?"Processing refund":
    proposal.status==="review"?"Team review":
    ["expired","withdrawn"].includes(proposal.status)?"Expired":
    proposal.status==="refunded"?"Refunded":"In progress";
  const statusCopy=proposal.stockPending?"Availability is being checked.":
    proposal.status==="applied"?"Your equipment change is complete.":
    proposal.status==="declined"?"You declined this change. Your existing kit and rental dates stay the same.":
    proposal.status==="refund_pending"?(proposal.stockApplied?"The change is recorded; your refund is processing.":"The change is processing; your equipment has not changed yet."):
    proposal.status==="review"?"The team is reviewing this change.":
    expired||["expired","withdrawn"].includes(proposal.status)?"This offer has expired. Ask the team for a new quote.":
    proposal.status==="refunded"?"The extra payment was returned; your original equipment stays booked.":
    pending?"Your rental dates stay the same.":"Continue below to finish this change.";
  const amountLabel=proposal.deltaPence>0?"Additional payment":proposal.deltaPence<0?"Refund to original card":"No card difference";
  const amount=proposal.deltaPence===0?formatGbp(0):`${proposal.deltaPence>0?"+":"−"}${formatGbp(Math.abs(proposal.deltaPence)/100)}`;

  return <section aria-label="Equipment change proposal" data-testid="rental-swap-approval" className="relative isolate mt-3 w-full max-w-[680px] overflow-hidden rounded-[18px] border border-[#d3ac7a]/25 bg-[linear-gradient(145deg,rgba(52,43,32,.72),rgba(26,27,27,.94)_48%,rgba(19,20,20,.96))] p-3 text-xs text-[#f5eee4] shadow-[0_16px_42px_rgba(0,0,0,.28)] backdrop-blur-xl sm:p-4">
    <div aria-hidden="true" className="pointer-events-none absolute -right-10 -top-14 h-36 w-36 rounded-full bg-[#d8ae7a]/[0.07] blur-3xl"/>
    <header className="relative flex min-w-0 items-center justify-between gap-3">
      <div className="min-w-0">
        <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[#d8b28a]/75">Equipment update</p>
        <h3 className="mt-1 text-sm font-semibold text-[#fff8ec]">Review the change</h3>
      </div>
      <span className={`shrink-0 rounded-full border px-2.5 py-1 text-[10px] font-medium ${pending&&!expired?"border-[#d8ae7a]/35 bg-[#d8ae7a]/10 text-[#f0cca1]":"border-white/10 bg-white/[0.04] text-white/65"}`}>{statusLabel}</span>
    </header>

    <div className="relative mt-3 grid gap-2">
      {changes.map((change:any,index:number)=><article key={`${change.oldTitle}:${index}`} className="grid min-w-0 grid-cols-[minmax(0,1fr)_22px_minmax(0,1fr)] items-center gap-2 rounded-2xl border border-white/[0.09] bg-black/20 p-2.5 sm:gap-3 sm:p-3">
        <div className="min-w-0">
          <p className="mb-1 text-[9px] font-medium uppercase tracking-[0.14em] text-white/45">Current</p>
          <SmartImage fit="contain" src={change.oldImageSources?.[0]} fallbackSources={change.oldImageSources?.slice(1)} alt={`${change.oldTitle} listing photo`} className="h-[68px] w-full rounded-xl border border-white/[0.08] bg-black/25 object-contain sm:h-[82px]"/>
          <p className="mt-1.5 line-clamp-2 min-h-8 break-words text-[10px] font-medium leading-4 text-white/80">{change.quantity} × {change.oldTitle}</p>
        </div>
        <span aria-hidden="true" className="grid h-7 w-7 place-items-center rounded-full border border-[#d8ae7a]/20 bg-[#d8ae7a]/[0.08] text-sm text-[#e5bd91]">→</span>
        <div className="min-w-0">
          <p className="mb-1 text-[9px] font-medium uppercase tracking-[0.14em] text-[#e4bd91]/70">New</p>
          <SmartImage fit="contain" src={change.newImageSources?.[0]} fallbackSources={change.newImageSources?.slice(1)} alt={`${change.newTitle} listing photo`} className="h-[68px] w-full rounded-xl border border-white/[0.08] bg-black/25 object-contain sm:h-[82px]"/>
          <p className="mt-1.5 line-clamp-2 min-h-8 break-words text-[10px] font-medium leading-4 text-white/90">{change.quantity} × {change.newTitle}</p>
        </div>
      </article>)}
    </div>

    <div className="relative mt-2.5 flex min-w-0 items-center justify-between gap-3 rounded-xl border border-[#d8ae7a]/20 bg-[#d8ae7a]/[0.06] px-3 py-2.5">
      <span className="min-w-0 text-[10px] font-medium uppercase tracking-[0.12em] text-white/55">{amountLabel}</span>
      <strong className="shrink-0 text-lg font-semibold tabular-nums text-[#f3d0a2]">{amount}</strong>
    </div>
    {proposal.restoreCreditPence>0&&<p className="relative mt-2 text-[10px] text-white/65">Credit restored <strong className="ml-1 font-semibold tabular-nums text-white/85">{formatGbp(proposal.restoreCreditPence/100)}</strong></p>}
    <p className="relative mt-2 text-[11px] leading-4 text-white/65">{statusCopy}</p>

    <details className="relative mt-2.5 rounded-xl border border-white/[0.08] bg-black/15 px-3 py-2 text-[10px] text-white/65">
      <summary className="cursor-pointer list-none font-medium text-white/80 marker:hidden">Terms & timing <span aria-hidden="true" className="float-right text-white/45">⌄</span></summary>
      <div className="mt-2 space-y-1.5 leading-4">
        <p>Your existing rental dates stay the same.</p>
        {proposal.deltaPence>0&&<p>Accept to continue to secure Stripe checkout. The additional payment is shown above.</p>}
        {proposal.deltaPence<0&&<p>If accepted, the refund goes to your original card and may take time to appear.</p>}
        {proposal.deltaPence===0&&<p>No extra card payment or refund is due for this change.</p>}
        <p>The equipment update is applied through the rental change process.</p>
      </div>
    </details>

    {pending&&!expired&&<label className="relative mt-3 flex cursor-pointer items-start gap-2.5 rounded-xl border border-white/[0.09] bg-white/[0.025] p-2.5 text-[11px] leading-4 text-white/80">
      <input type="checkbox" checked={confirmed} disabled={busy} onChange={event=>setConfirmed(event.target.checked)} className="mt-0.5 h-4 w-4 shrink-0 accent-[#d5aa7c]"/>
      <span>I accept this equipment change and the amount shown.</span>
    </label>}
    {pending&&!expired&&<button type="button" disabled={busy} onClick={async()=>{setBusy(true);setNotice("");try{const result=await decline({token,id:proposal.id});setNotice(result.expired?"This proposal expired. Your existing kit and rental dates stay the same.":"Change declined. Your existing kit and rental dates stay the same.");}catch(error){setNotice(error instanceof Error?error.message:"The change could not be declined. Please contact the team.");}finally{setBusy(false);}}} className="relative mt-3 inline-flex min-h-10 w-full items-center justify-center rounded-xl border border-white/15 bg-white/[0.04] px-4 py-2.5 text-[12px] font-medium text-white/80 transition hover:bg-white/[0.08] disabled:cursor-not-allowed disabled:opacity-40 sm:ml-2 sm:w-auto">Decline change</button>}
    {canContinue&&<button type="button" disabled={busy||pending&&!confirmed} onClick={async()=>{setBusy(true);setNotice("");try{const result=await accept({token,id:proposal.id,expectedDeltaPence:proposal.deltaPence,confirmed:true});if(result.url){const url=new URL(result.url);if(url.protocol!=="https:"||url.hostname!=="checkout.stripe.com")throw Error("The payment link could not be verified. Please contact the team.");window.location.assign(url.toString());}else setNotice(result.applied?"The change is being processed. Check this conversation for confirmation.":result.refunded?"The additional payment was refunded.":result.status==="awaiting_review"?"The refund needs team approval; we will update you here.":result.status==="needs_review"?"The refund needs team review; we will update you here.":"The change is being processed. Please check back here.");}catch(error){setNotice(error instanceof Error?error.message:"The change could not be continued. Please contact the team.");}finally{setBusy(false);}}} className="relative mt-3 inline-flex min-h-10 w-full items-center justify-center rounded-xl border border-[#e3c39e]/50 bg-[linear-gradient(130deg,#d9b084,#bd8a65)] px-4 py-2.5 text-[12px] font-semibold text-[#21180f] shadow-[0_8px_20px_rgba(169,119,78,.18)] transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40 sm:w-auto sm:min-w-44">{busy?"Checking…":pending?"Accept equipment change":proposal.status==="awaiting_payment"?"Continue to secure payment":"Check progress"}</button>}
    {notice&&<p role="status" className="relative mt-3 rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-[11px] leading-4 text-white/75">{notice}</p>}
  </section>;
}
