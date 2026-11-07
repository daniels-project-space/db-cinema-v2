"use client";

import { useState } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import { api } from "@cvx/_generated/api";

export function RentalSwapStockReview({ token, bookingId }: { token: string; bookingId: string }) {
  const conflicts = useQuery(api.swapStockAudit.conflicts, { token, bookingId: bookingId as any });
  const recheck = useAction(api.swapStockAudit.recheck);
  const retryLegacy = useMutation(api.swapStockAudit.retryLegacyDelivery);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  if (!conflicts?.length && !message) return null;
  return <section aria-label="Equipment availability review" className="mt-3 overflow-hidden rounded-2xl border border-[#8b6842]/60 bg-[#171614]/90 text-[#f3eee7] shadow-[0_16px_40px_rgba(0,0,0,0.24)] backdrop-blur-xl">
    <div className="flex items-start gap-3 border-b border-white/[0.08] bg-[#58442e]/20 px-4 py-4">
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-[#a97c4b]/40 bg-[#b98a51]/15 text-[#e6bb81]"><svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="h-6 w-6"><rect x="3" y="5" width="12" height="12" rx="2.5"/><path d="M6 8h6M6 11h3"/><circle cx="15" cy="15" r="4" fill="#3a2c20"/><path d="m18 18 2.5 2.5"/></svg></span>
      <div className="min-w-0"><p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[#d7ad79]">Handover paused</p><h4 className="mt-1 text-[15px] font-semibold leading-5">Check equipment availability</h4><p className="mt-1 text-xs leading-5 text-[#b8a998]">Review the stock record in Rental Manager before continuing.</p></div>
    </div>
    <div className="space-y-3 p-4">{conflicts?.map(row => <div key={row.id} className="rounded-xl border border-white/[0.09] bg-white/[0.035] p-3">
      <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[#a99b8b]">Equipment change</p><p className="mt-1 break-words text-sm leading-5">{row.oldTitle} <span aria-hidden="true" className="text-[#cba477]">→</span> {row.newTitle}</p>
      {row.legacy && <p className="mt-2 text-xs leading-5 text-[#d2bda1]">Earlier stock receipt needs reconciliation. No confirmation has been recorded.</p>}
      {row.pending && <p className="mt-2 text-xs leading-5 text-[#d2bda1]">Receipt awaiting Rental Manager confirmation. The rental remains paused.</p>}
      {!row.pending && <button type="button" disabled={busy !== null} onClick={async () => { setBusy(row.id); setMessage(""); try { if(row.legacy){await retryLegacy({token,bookingId:bookingId as any,id:row.id,confirmed:true});setMessage("Receipt queued for reconciliation. The rental remains paused until Rental Manager confirms it.");}else{const result=await recheck({token,bookingId:bookingId as any,id:row.id}); setMessage(result.status==="clear"?"Rental Manager confirmed this equipment is clear. Any other booking checks still apply.":"Availability could not be confirmed. Handover remains paused; check the booking and try again.");} } catch (error) { setMessage(error instanceof Error ? error.message : "The stock check could not run. Handover remains paused."); } finally { setBusy(null); } }} className="mt-3 min-h-11 rounded-lg border border-[#b18c60]/45 bg-[#ae8050]/15 px-4 text-xs font-semibold text-[#f4d3ab] transition hover:bg-[#ae8050]/25 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#e5bd8d] disabled:opacity-40">{busy===row.id?"Checking…":row.legacy?"Retry receipt reconciliation":"Check live stock again"}</button>}
    </div>)}{message && <p role="status" className="rounded-lg border border-[#927554]/25 bg-[#ae8050]/10 p-3 text-xs leading-5 text-[#f1d2ad]">{message}</p>}</div>
  </section>;
}
