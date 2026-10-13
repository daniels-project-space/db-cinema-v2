"use client";
import {useRef,useState} from "react";
import {useAction,useQuery} from "convex/react";
import {api} from "@cvx/_generated/api";
import {formatGbp} from "@/lib/pricing";

export function DepositRefundStatus({token,bookingId}:{token:string;bookingId:any}){
 const data=useQuery(api.bookings.depositSettlementStatus,{token,bookingId});
 const resume=useAction(api.checkout.resumeDepositRefund),retry=useAction(api.checkout.retryDepositRefund);
 const [review,setReview]=useState<{refundId:string;amount:number;requestId:string;snapshot:string}|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState("");const lock=useRef(false);
 async function run(fn:()=>Promise<unknown>){if(lock.current)return;lock.current=true;setBusy(true);setError("");try{await fn();setReview(null)}catch(e){setError(e instanceof Error?e.message:"Refund needs review.")}finally{lock.current=false;setBusy(false)}}
 if(!data?.decided)return null;
 const labels={not_started:"Deposit refund not finished",processing:"Deposit refund needs review",awaiting_approval:"Refund awaiting Stripe approval",pending:"Refund processing",succeeded:data.amount?"Deposit refund confirmed":"Deposit decision complete",failed:"Deposit refund failed"};
 return <section aria-label="Deposit refund status" className="my-4 rounded-xl border border-white/15 p-3 text-sm"><div className="flex justify-between gap-3"><strong>{labels[data.state]}</strong><span>{formatGbp(data.amount)}</span></div>
 {data.receipts.map((r:any,index:number)=><div key={r.refundId??index} className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs"><span>{formatGbp(r.amount)} · {r.status.replaceAll("_"," ")}</span>{r.status==="awaiting_approval"&&r.approvalUrl&&<a href={r.approvalUrl} target="_blank" rel="noopener noreferrer" className="rounded-full border border-sky-300/30 px-3 py-2 text-sky-200">Open Stripe approval ↗</a>}{r.status==="failed"&&r.refundId&&<button type="button" disabled={busy} className="rounded-full border border-white/20 px-3 py-2" onClick={()=>setReview({refundId:r.refundId,amount:r.amount,requestId:crypto.randomUUID(),snapshot:data.snapshot})}>Review retry</button>}</div>)}
 {["not_started","processing","awaiting_approval"].includes(data.state)&&<button type="button" disabled={busy} className="mt-3 rounded-full border border-white/20 px-3 py-2 text-xs" onClick={()=>void run(()=>resume({token,bookingId,confirmed:true}))}>Resume saved decision</button>}
 {review&&<div role="region" aria-label="Review deposit refund retry" className="mt-3 rounded-lg border border-amber-200/20 p-3"><p>Retry {formatGbp(review.amount)} to the original card. The provider must confirm that the previous refund failed.</p><div className="mt-3 flex gap-3"><button type="button" disabled={busy} className="rounded-full bg-sky-500 px-4 py-2 text-xs" onClick={()=>void run(()=>retry({token,bookingId,refundId:review.refundId,requestId:review.requestId,expectedSnapshot:review.snapshot,confirmed:true}))}>Confirm refund retry</button><button type="button" disabled={busy} onClick={()=>setReview(null)} className="px-3 text-xs">Cancel</button></div></div>}
 {data.state==="pending"&&<p className="mt-2 text-xs text-white/60">Issued to the original card; bank settlement is still processing.</p>}{error&&<p role="alert" className="mt-3 text-xs text-rose-300">{error}</p>}
 </section>;
}
