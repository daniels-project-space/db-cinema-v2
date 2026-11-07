"use client";
import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@cvx/_generated/api";

export function AttachmentAdminControls({token,id}:{token:string;id:string}) {
  const [open,setOpen]=useState(false),[reason,setReason]=useState(""),[confirmedRevision,setConfirmedRevision]=useState<number|null>(null),[busy,setBusy]=useState(false),[message,setMessage]=useState("");
  const retention=useQuery(api.chatAttachments.retention,open?{token,id:id as any}:"skip");
  const confirmed=retention!=null&&confirmedRevision!==null&&retention.holdRevision===confirmedRevision;
  const hold=useMutation(api.chatAttachments.setRetentionHold),remove=useMutation(api.chatAttachments.removePublished);
  async function run(action:"hold"|"release"|"remove") {
    if(busy||!confirmed)return;setBusy(true);setMessage("");
    try{if(action==="remove")await remove({token,id:id as any,reason,confirmed,expectedRevision:confirmedRevision!});else await hold({token,id:id as any,hold:action==="hold",reason,confirmed,expectedRevision:confirmedRevision!});setReason("");setConfirmedRevision(null);setMessage(action==="remove"?"Attachment removed.":"Retention setting updated.");}
    catch(error:any){setConfirmedRevision(null);setMessage(error?.data?.message??error?.message??"The attachment could not be updated.");}finally{setBusy(false);}
  }
  return <details className="mt-2 text-xs" onToggle={event=>{const next=event.currentTarget.open;setOpen(next);if(!next)setConfirmedRevision(null)}}><summary className="cursor-pointer underline underline-offset-4">Manage attachment</summary>
    {open&&<div className="mt-2 space-y-2 rounded-lg border border-current/20 p-3">
      {retention===undefined?<p>Checking retention…</p>:retention===null?<p>Attachment unavailable or access denied.</p>:<><p>{retention.needsReview?"Case history could not be checked automatically. Manual review is required before removal.":retention.openCases?`Protected by ${retention.openCases} open case${retention.openCases===1?"":"s"}.`:"No open case protects this attachment."}</p>{retention.holdReason&&<p>Manual hold: {retention.holdReason}</p>}<p>There is no automatic attachment deletion deadline configured.</p>
      <label className="block">Reason<textarea className="mt-1 block w-full rounded border border-current/20 bg-black/30 p-2" maxLength={500} value={reason} disabled={busy} onChange={event=>{setReason(event.target.value);setConfirmedRevision(null)}}/></label>
      <label className="flex items-start gap-2"><input type="checkbox" checked={confirmed} disabled={busy} onChange={event=>setConfirmedRevision(event.target.checked?retention.holdRevision:null)}/><span>I reviewed this action and understand that removal is permanent.</span></label>
      <div className="flex flex-wrap gap-2"><button type="button" disabled={busy||!confirmed||reason.trim().length<10} onClick={()=>void run(retention.holdReason?"release":"hold")} className="rounded border border-current/30 px-2 py-1 disabled:opacity-40">{retention.holdReason?"Release manual hold":"Place manual hold"}</button><button type="button" disabled={busy||!confirmed||reason.trim().length<10||!!retention.holdReason||retention.needsReview||retention.openCases>0} onClick={()=>void run("remove")} className="rounded border border-red-300/50 px-2 py-1 text-red-200 disabled:opacity-40">Remove permanently</button></div></>}
      {message&&<p role="status">{message}</p>}
    </div>}
  </details>;
}
