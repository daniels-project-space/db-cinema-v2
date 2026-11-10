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
  const expiryLabel = retention?.expiresAt
    ? `Retention date · ${new Date(retention.expiresAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" })}${retention.openCases > 0 ? " · paused while case is open" : ""}`
    : retention?.needsReview ? "Deletion paused for review." : "Retained until 90 days after closure.";

  return (
    <details className="mt-2 text-xs" onToggle={event => { const next = event.currentTarget.open; setOpen(next); if (!next) setConfirmedRevision(null); }}>
      <summary className="cursor-pointer underline underline-offset-4">Manage attachment</summary>
      {open && <div className="mt-2 space-y-2 rounded-2xl border border-white/[.09] bg-white/[.035] p-3 backdrop-blur-xl">
        {retention === undefined ? <p className="text-white/60">Checking retention…</p> : retention === null ? <p className="text-white/60">Attachment unavailable.</p> : <>
          <p className="text-white/70">{retention.needsReview ? "Retention review needed" : retention.openCases > 0 ? `${retention.openCases} open case · file protected` : retention.caseArchived ? "Case chat archived" : "No open cases"}</p>
          {retention.holdReason && <p className="text-amber-100/75">On hold · {retention.holdReason}</p>}
          <p className="text-white/60">{expiryLabel}</p>
          <label className="block">Reason<textarea className="mt-1 block w-full rounded border border-current/20 bg-black/30 p-2" maxLength={500} value={reason} disabled={busy} onChange={event => { setReason(event.target.value); setConfirmedRevision(null); }} /></label>
          <label className="flex items-start gap-2 text-white/70"><input type="checkbox" checked={confirmed} disabled={busy} onChange={event => setConfirmedRevision(event.target.checked ? retention.holdRevision : null)} /><span>Confirm file removal or retention change.</span></label>
          <div className="flex flex-wrap gap-2"><button type="button" disabled={busy || !confirmed || reason.trim().length < 10} onClick={() => void run(retention.holdReason ? "release" : "hold")} className="rounded-xl border border-white/15 bg-white/[.045] px-3 py-2 text-white/80 disabled:opacity-40">{retention.holdReason ? "Release hold" : "Place hold"}</button><button type="button" disabled={busy || !confirmed || reason.trim().length < 10 || !!retention.holdReason || retention.needsReview || retention.openCases > 0} onClick={() => void run("remove")} className="rounded-xl border border-red-200/25 bg-red-200/[.06] px-3 py-2 text-red-100 disabled:opacity-40">Remove file</button></div>
        </>}
        {message && <p role="status">{message}</p>}
      </div>}
    </details>
  );
}
