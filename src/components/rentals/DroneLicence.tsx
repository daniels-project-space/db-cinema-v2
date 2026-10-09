"use client";
import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@cvx/_generated/api";

export function DroneLicenceUpload({ bookingId, token, checkoutSessionId, status, note }: { bookingId: string; token?: string; checkoutSessionId?: string; status: string; note?: string | null }) {
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  async function upload(file?: File) {
    if (!file || busy) return;
    setBusy(true); setError("");
    try {
      if (file.size > 10 * 1024 * 1024) throw Error("Choose a file up to 10 MB.");
      const origin = process.env.NEXT_PUBLIC_CONVEX_URL!.replace(".convex.cloud", ".convex.site");
      const response = await fetch(`${origin}/renter-drone-document?bookingId=${encodeURIComponent(bookingId)}`, {
        method: "POST", headers: { "Content-Type": file.type, ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(checkoutSessionId ? { "X-Checkout-Session": checkoutSessionId } : {}) }, body: file,
      });
      if (!response.ok) throw Error(await response.text() || "Upload failed. Please try again.");
    } catch (e) { setError(e instanceof Error ? e.message : "Upload failed."); }
    finally { setBusy(false); }
  }
  return <section className="rounded-2xl border border-[#b98b64]/30 bg-[#b98b64]/[.06] p-5">
    <p className="text-xs uppercase tracking-widest text-[#d6b393]">Drone rental · additional verification</p>
    <h3 className="mt-2 text-lg font-semibold text-white">Operator licence</h3>
    <p role="status" className="mt-2 text-sm leading-6 text-white/65">{status === "approved" ? "Your operator licence has been approved by our team." : status === "review" ? "Licence uploaded. Our team must assess it before drone handover." : "Upload your drone operator licence or registration evidence. Our team checks this separately from your identity documents before approving drone handover."}</p>
    {note && <p className="mt-3 text-sm text-[#d6b393]">Team review: {note}</p>}
    {status !== "approved" && <label className="mt-4 block text-xs text-white/60">PDF, JPG, PNG or WebP · up to 10 MB<input disabled={busy} type="file" accept="application/pdf,image/jpeg,image/png,image/webp" onChange={e => { const file=e.target.files?.[0]; e.target.value=""; void upload(file); }} className="mt-2 block w-full text-sm file:mr-4 file:rounded-lg file:border-0 file:bg-white file:px-4 file:py-2 file:text-black" /></label>}
    {busy && <p role="status" className="mt-3 text-sm text-white/60">Uploading licence…</p>}
    {error && <p role="alert" className="mt-3 text-sm text-rose-200">{error}</p>}
  </section>;
}

export function AdminDroneLicence({ token, bookingId }: { token: string; bookingId: string }) {
  const details = useQuery(api.droneLicences.adminDetails, { token, bookingId: bookingId as any });
  const review = useMutation(api.droneLicences.review);
  const archiveExisting = useMutation(api.droneLicences.archiveExisting);
  const [note, setNote] = useState(""), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const [preview,setPreview]=useState<{url:string;type:string}|null>(null);
  const previewUrl=useRef<string|null>(null),request=useRef<AbortController|null>(null);
  const documentId=details?.documentId;
  useEffect(()=>{
    request.current?.abort();setPreview(null);setBusy(false);setNote("");setError("");
    if(previewUrl.current)URL.revokeObjectURL(previewUrl.current);previewUrl.current=null;
    return ()=>{request.current?.abort();if(previewUrl.current)URL.revokeObjectURL(previewUrl.current);previewUrl.current=null;};
  },[bookingId,token,documentId]);
  async function view(){
    if(!documentId || busy)return;
    const controller=new AbortController();request.current?.abort();request.current=controller;
    setBusy(true);setError("");
    try{
      const origin=process.env.NEXT_PUBLIC_CONVEX_URL!.replace(".convex.cloud",".convex.site");
      const response=await fetch(`${origin}/admin-verification-document`,{method:"POST",headers:{Authorization:`Bearer ${token}`,"Content-Type":"application/json"},body:JSON.stringify({documentId}),signal:controller.signal});
      if(!response.ok)throw Error("This document is unavailable or its retention period has ended.");
      const blob=await response.blob();if(controller.signal.aborted)return;
      if(previewUrl.current)URL.revokeObjectURL(previewUrl.current);
      previewUrl.current=URL.createObjectURL(blob);setPreview({url:previewUrl.current,type:blob.type});
    }catch(e){if(!controller.signal.aborted)setError(e instanceof Error?e.message:"Document could not be opened.");}
    finally{if(request.current===controller)setBusy(false);}
  }
  useEffect(()=>{
    if(!preview || details?.expiresAt==null)return;
    let timer:ReturnType<typeof setTimeout>;
    const check=()=>{const remaining=details.expiresAt!-Date.now();if(remaining<=0){request.current?.abort();if(previewUrl.current)URL.revokeObjectURL(previewUrl.current);previewUrl.current=null;setPreview(null);setBusy(false);}else timer=setTimeout(check,Math.min(remaining,86400000));};
    check();return()=>clearTimeout(timer);
  },[preview,details?.expiresAt]);
  if (!details) return null;
  async function decide(decision: "approved" | "requires_input") {
    setBusy(true); setError("");
    try { if(!documentId)throw Error("Open the uploaded document first."); await review({ token, bookingId: bookingId as any, documentId, decision, note }); setNote(""); }
    catch (e) { setError(e instanceof Error ? e.message : "Review failed."); }
    finally { setBusy(false); }
  }
  return <section className="mt-5 rounded-2xl border border-[#b98b64]/30 p-5">
    <h3 className="text-sm font-semibold text-[#d6b393]">Drone operator licence · {details.status.replaceAll("_", " ")}</h3>
    <p className="mt-2 text-xs leading-5 text-white/50">Manual approval is required before handover. Check the operator’s evidence and its suitability for the requested drone.</p>
    {details.documentId && <button disabled={busy} onClick={() => void view()} className="mt-3 inline-block text-sm text-white underline disabled:opacity-30">View uploaded licence</button>}
    {preview && <div className="mt-3"><button onClick={()=>{if(previewUrl.current)URL.revokeObjectURL(previewUrl.current);previewUrl.current=null;setPreview(null);}} className="mb-2 text-xs text-white/60">Close document</button>{preview.type==="application/pdf"?<iframe title="Drone operator licence" src={preview.url} className="h-96 w-full rounded-lg bg-white"/>:<img alt="Drone operator licence" src={preview.url} className="max-h-96 w-full rounded-lg object-contain"/>}</div>}
    {details.note && <p className="mt-3 text-xs text-white/60">Recorded decision: {details.note}</p>}
    {details.legacy && <button disabled={busy} onClick={async()=>{setBusy(true);setError("");try{await archiveExisting({token,bookingId:bookingId as any});}catch(e){setError(e instanceof Error?e.message:"Archive could not be queued.");}finally{setBusy(false);}}} className="mt-3 text-sm text-white underline disabled:opacity-30">Archive existing licence for private review</button>}
    {details.documentId && details.canReview && <><label className="mt-4 block text-xs text-white/60">Review evidence / replacement reason<textarea value={note} onChange={e => setNote(e.target.value)} className="input mt-2 w-full" rows={3} /></label><div className="mt-3 flex flex-wrap gap-2">{(["approved", "requires_input"] as const).map(decision => <button key={decision} disabled={busy || note.trim().length < 10} onClick={() => void decide(decision)} className="rounded-lg border border-white/15 px-3 py-2 text-xs text-white disabled:opacity-30">{decision === "approved" ? "Approve licence" : "Request replacement"}</button>)}</div></>}
    {error && <p role="alert" className="mt-3 text-sm text-rose-200">{error}</p>}
  </section>;
}
