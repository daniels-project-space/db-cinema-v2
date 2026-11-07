"use client";
import {useState} from "react";
import {useAction,useQuery} from "convex/react";
import {api} from "@cvx/_generated/api";
import {formatGbp} from "@/lib/pricing";

export function InventoryConflictRefund({token,bookingId}:{token:string;bookingId:string}){
 const state=useQuery(api.cancellationRecovery.inventoryConflictStatus,{token,bookingId:bookingId as any});
 const refund=useAction(api.checkout.refundInventoryConflict);
 const [reason,setReason]=useState(""),[confirmed,setConfirmed]=useState(false),[busy,setBusy]=useState(false),[notice,setNotice]=useState("");
 if(!state)return null;
 const currentReason=state.started?state.reason:reason;
 async function submit(){
  if(busy)return;setBusy(true);setNotice("");
  try{await refund({token,bookingId:bookingId as any,confirmed,reason:currentReason});setNotice("Refund completed. Check the cancellation status for the final receipt.");}
  catch(error:any){setNotice(error?.data?.code==="CANCELLATION_PENDING"?"Refund requested. Stripe approval or bank settlement is pending; this is not yet refunded.":error?.message??"The refund needs review. Check the existing request before retrying.");}
  finally{setBusy(false);}
 }
 return <section aria-label="Unconfirmed booking refund" className="mb-3 rounded-xl border border-amber-400/25 bg-amber-400/5 p-3 text-xs text-amber-100">
  <p className="font-semibold">Review original-payment refund · {formatGbp(state.amount)}</p>
  <p className="mt-1">This booking is not confirmed. Review the accepted cancellation terms and the renter’s choice before proceeding. Stripe may require a separate approval. Membership payments, previous refunds and credits without a verified unspent record require individual review.</p>
  {state.unspentCredit>0&&<p className="mt-1">{formatGbp(state.unspentCredit)} of account credit was not spent and remains reserved until cancellation completes. No duplicate credit will be issued.</p>}
  <label className="mt-3 block">Reason<textarea className="mt-1 block w-full rounded border border-white/20 bg-black/30 p-2 text-white" maxLength={400} value={currentReason} disabled={state.started||busy} onChange={event=>setReason(event.target.value)} /></label>
  <label className="mt-2 flex gap-2"><input type="checkbox" checked={confirmed} onChange={event=>setConfirmed(event.target.checked)} disabled={busy}/><span>I reviewed this booking and authorise the original-payment refund.</span></label>
  <button type="button" disabled={busy||!confirmed||currentReason.trim().length<5} onClick={submit} className="mt-3 rounded border border-amber-300/40 px-3 py-2 disabled:opacity-40">{state.started?"Resume original refund":"Request refund"}</button>
  {notice&&<p role="status" className="mt-2">{notice}</p>}
 </section>;
}
