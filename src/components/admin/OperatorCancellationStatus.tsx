"use client";
import {useMutation,useQuery} from "convex/react";
import {useRef,useState} from "react";
import {api} from "@cvx/_generated/api";
import type {Id} from "@cvx/_generated/dataModel";
export function OperatorCancellationStatus({token,bookingId}:{token:string;bookingId:string}){
 const status=useQuery(api.operatorCancellationState.ownerStatus,{token,bookingId:bookingId as Id<"bookings">}),resume=useMutation(api.operatorCancellationState.resumeAdmin);
 const [confirmed,setConfirmed]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState("");const lock=useRef(false);
 if(!status||status.state==="settled")return null;
 async function retry(){if(!status||!confirmed||lock.current)return;lock.current=true;setBusy(true);setError("");try{await resume({token,offerId:status.id,confirmed:true});setConfirmed(false);}catch(e){setError(e instanceof Error?e.message:"The recorded cancellation could not be resumed.");}finally{lock.current=false;setBusy(false);}}
 const text=status.state==="waiting"?`Account decision window · until ${new Date(status.decisionAfter).toLocaleTimeString("en-GB",{timeZone:"Europe/London",hour:"2-digit",minute:"2-digit"})} London time`:status.state==="email_pending"?"Refund or credit email is being delivered":status.state==="offered"?"Waiting for the renter’s refund or credit choice":status.state==="chosen"?`Recorded ${status.choice==="credit"?"credit +30%":"original-payment refund"} · settlement processing`:"Cancellation needs review";
 return <section className="my-3 rounded-xl border border-amber-300/20 bg-amber-300/5 p-3 text-xs text-amber-100" aria-label="Operator cancellation settlement"><p role="status">{text}</p>{status.state==="review"&&<><p className="mt-2 text-white/55">{status.choice?"Review the existing provider receipts before resuming. The saved choice and amounts stay fixed.":"Check the recipient and email delivery settings before retrying the two-option email."}</p><label className="mt-3 flex items-center gap-2"><input type="checkbox" checked={confirmed} disabled={busy} onChange={e=>setConfirmed(e.target.checked)}/>I have reviewed this cancellation</label><button type="button" disabled={!confirmed||busy} onClick={()=>void retry()} className="mt-3 rounded-full border border-amber-200/30 px-3 py-2 disabled:opacity-40">{busy?"Resuming…":status.choice?"Resume recorded settlement":"Retry choice email"}</button></>}{error&&<p role="alert" className="mt-2 text-red-200">{error}</p>}</section>;
}
