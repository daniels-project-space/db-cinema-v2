"use client";
import { useId } from "react";
import { formatGbp } from "@/lib/pricing";

export function DepositSettlementControl({paid,kept,onChange,disabled=false}:{paid:number;kept:number;onChange:(value:number)=>void;disabled?:boolean}) {
  const inputId=useId();
  return <section aria-label="Refundable deposit settlement" className="rounded-xl border border-accent-400/25 bg-accent-400/5 p-4">
    <div className="mb-4 flex items-center justify-between gap-3"><h4 className="font-semibold">Return the deposit</h4><span className="text-xs text-white/55">Original payment card</span></div>
    <div className="grid grid-cols-3 gap-2 text-center">
      <div><span className="block text-xs text-white/55">Paid</span><strong>{formatGbp(paid)}</strong></div>
      <div><label htmlFor={inputId} className="block text-xs text-white/55">Keep</label><strong>{formatGbp(kept)}</strong></div>
      <div><span className="block text-xs text-white/55">Refund</span><strong className="text-emerald-300">{formatGbp(Math.max(0,paid-kept))}</strong></div>
    </div>
    <input id={inputId} aria-label="Deposit amount to keep" type="range" min="0" max={paid} step="0.01" value={kept} disabled={disabled} onChange={e=>onChange(Number(e.target.value))} className="mt-4 w-full accent-accent-500"/>
    <div className="mt-2 flex flex-wrap gap-2">
      {[[0,"Refund all"],[paid/2,"Keep half"],[paid,"Keep all"]].map(([value,label])=><button key={String(label)} type="button" disabled={disabled} aria-pressed={kept===value} onClick={()=>onChange(Number(value))} className="rounded-full border border-white/15 px-3 py-1.5 text-xs disabled:opacity-40">{label}</button>)}
    </div>
    <p className="mt-3 text-xs leading-5 text-white/55">Keeping any amount requires an inspected issue and a reason. Retained money reduces the same assessment and combined later-charge allowance. Review and confirm before the refund is submitted.</p>
  </section>;
}
