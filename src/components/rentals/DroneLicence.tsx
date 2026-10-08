"use client";
import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@cvx/_generated/api";

export function DroneLicenceUpload({ bookingId, token, checkoutSessionId, status, note }: { bookingId: string; token?: string; checkoutSessionId?: string; status: string; note?: string | null }) {
  const uploadUrl = useMutation(api.droneLicences.uploadUrl);
  const submit = useMutation(api.droneLicences.submit);
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  async function upload(file?: File) {
    if (!file || busy) return;
    setBusy(true); setError("");
    try {
      if (file.size > 10 * 1024 * 1024) throw Error("Choose a file up to 10 MB.");
      const args = { bookingId: bookingId as any, token, checkoutSessionId };
      const url = await uploadUrl(args);
      const response = await fetch(url, { method: "POST", headers: { "Content-Type": file.type }, body: file });
      if (!response.ok) throw Error("Upload failed. Please try again.");
      const { storageId } = await response.json();
      await submit({ ...args, storageId });
    } catch (e) { setError(e instanceof Error ? e.message : "Upload failed."); }
    finally { setBusy(false); }
  }
  return <section className="rounded-2xl border border-[#b98b64]/30 bg-[#b98b64]/[.06] p-5">
    <p className="text-xs uppercase tracking-widest text-[#d6b393]">Drone rental · additional verification</p>
    <h3 className="mt-2 text-lg font-semibold text-white">Operator licence</h3>
    <p role="status" className="mt-2 text-sm leading-6 text-white/65">{status === "approved" ? "Your operator licence has been approved by our team." : status === "review" ? "Licence uploaded. Our team must assess it before drone handover." : "Upload your drone operator licence or registration evidence. Our team checks this separately from your identity documents before approving drone handover."}</p>
    {note && <p className="mt-3 text-sm text-[#d6b393]">Team review: {note}</p>}
    {status !== "approved" && <label className="mt-4 block text-xs text-white/60">PDF, JPG, PNG or WebP · up to 10 MB<input disabled={busy} type="file" accept="application/pdf,image/jpeg,image/png,image/webp" onChange={e => void upload(e.target.files?.[0])} className="mt-2 block w-full text-sm file:mr-4 file:rounded-lg file:border-0 file:bg-white file:px-4 file:py-2 file:text-black" /></label>}
    {busy && <p role="status" className="mt-3 text-sm text-white/60">Uploading licence…</p>}
    {error && <p role="alert" className="mt-3 text-sm text-rose-200">{error}</p>}
  </section>;
}

export function AdminDroneLicence({ token, bookingId }: { token: string; bookingId: string }) {
  const details = useQuery(api.droneLicences.adminDetails, { token, bookingId: bookingId as any });
  const review = useMutation(api.droneLicences.review);
  const [note, setNote] = useState(""), [busy, setBusy] = useState(false), [error, setError] = useState("");
  if (!details) return null;
  async function decide(decision: "approved" | "requires_input") {
    setBusy(true); setError("");
    try { await review({ token, bookingId: bookingId as any, decision, note }); setNote(""); }
    catch (e) { setError(e instanceof Error ? e.message : "Review failed."); }
    finally { setBusy(false); }
  }
  return <section className="mt-5 rounded-2xl border border-[#b98b64]/30 p-5">
    <h3 className="text-sm font-semibold text-[#d6b393]">Drone operator licence · {details.status.replaceAll("_", " ")}</h3>
    <p className="mt-2 text-xs leading-5 text-white/50">Manual approval is required before handover. Check the operator’s evidence and its suitability for the requested drone.</p>
    {details.url && <a href={details.url} target="_blank" rel="noreferrer" className="mt-3 inline-block text-sm text-white underline">View uploaded licence ↗</a>}
    {details.note && <p className="mt-3 text-xs text-white/60">Recorded decision: {details.note}</p>}
    {details.url && <><label className="mt-4 block text-xs text-white/60">Review evidence / replacement reason<textarea value={note} onChange={e => setNote(e.target.value)} className="input mt-2 w-full" rows={3} /></label><div className="mt-3 flex flex-wrap gap-2">{(["approved", "requires_input"] as const).map(decision => <button key={decision} disabled={busy || note.trim().length < 10} onClick={() => void decide(decision)} className="rounded-lg border border-white/15 px-3 py-2 text-xs text-white disabled:opacity-30">{decision === "approved" ? "Approve licence" : "Request replacement"}</button>)}</div></>}
    {error && <p role="alert" className="mt-3 text-sm text-rose-200">{error}</p>}
  </section>;
}
