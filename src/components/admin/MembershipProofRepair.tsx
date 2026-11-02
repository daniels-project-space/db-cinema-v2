"use client";
import {useState} from "react";
import {useAction} from "convex/react";
import {api} from "@cvx/_generated/api";

export function MembershipProofRepair({token,invoiceId}:{token:string;invoiceId:string}){
 const [reason,setReason]=useState(""),[busy,setBusy]=useState(false),[message,setMessage]=useState("");
 const retry=useAction(api.checkout.retryMembershipWaiverProof),resolve=useAction(api.checkout.resolveMembershipWaiverAmbiguity);
 async function run(kind:"retry"|"resolve"){
  setBusy(true);setMessage("");
  try{
   if(kind==="retry"){const result=await retry({token,invoiceId});setMessage(result==="ready"?"Provider payment evidence is ready. Waiver eligibility is still checked at checkout.":result==="needs_review"?"The payment still needs review; no waiver has been granted.":"No matching payment record was found; no waiver has been granted.");}
   else {const result=await resolve({token,invoiceId,reason});setMessage(result?"Provider evidence matched and the review was recorded. Waiver eligibility is still checked at checkout.":"Evidence changed during review. Try again.");}
  }catch(error){setMessage(error instanceof Error?error.message:"Payment evidence could not be checked.");}finally{setBusy(false);}
 }
 return <details className="border-t border-white/10 px-3 py-2 text-xs text-white/70"><summary className="cursor-pointer">Review payment proof · {invoiceId}</summary><p className="mt-2 leading-5">These checks read Stripe records only. They do not charge or refund anyone. Unmatched refunds remain blocked.</p><label className="mt-2 block">Review reason<textarea value={reason} onChange={event=>setReason(event.target.value)} maxLength={500} rows={2} className="mt-1 w-full rounded border border-white/15 bg-black/20 p-2 text-white" /></label><div className="mt-2 flex flex-wrap gap-2"><button type="button" disabled={busy} onClick={()=>void run("retry")} className="rounded border border-white/20 px-2 py-1 disabled:opacity-50">Recheck provider</button><button type="button" disabled={busy||reason.trim().length<10} onClick={()=>void run("resolve")} className="rounded border border-white/20 px-2 py-1 disabled:opacity-50">Match and record evidence</button></div>{message&&<p role="status" className="mt-2 leading-5">{message}</p>}</details>;
}

export function MembershipProviderRepair({token,subscriptionId}:{token:string;subscriptionId:string}){
 const [busy,setBusy]=useState(false),[message,setMessage]=useState("");
 const retry=useAction(api.checkout.retryMembershipProviderRead);
 return <div className="border-t border-white/10 px-3 py-2 text-xs text-white/70"><button type="button" disabled={busy} className="rounded border border-white/20 px-2 py-1 disabled:opacity-50" onClick={async()=>{setBusy(true);setMessage("");try{const result=await retry({token,subscriptionId});setMessage(result==="ready"?"The provider check is current. Waiver eligibility is checked separately.":"The provider check needs team review; no waiver was granted.");}catch{setMessage("Could not complete the provider check. Check Stripe or try again later.");}finally{setBusy(false);}}}>Recheck membership in Stripe</button>{message&&<p role="status" className="mt-2">{message}</p>}</div>;
}
