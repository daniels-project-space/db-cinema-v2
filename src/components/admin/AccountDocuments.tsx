"use client";
import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@cvx/_generated/api";

export function AccountDocuments({ token, accountId }: { token: string; accountId: string }) {
  const archives = useQuery(api.verificationArchive.accountDocuments, { token, accountId: accountId as any });
  const retry = useMutation(api.verificationArchive.retry);
  const backfill = useMutation(api.verificationArchive.backfillAccount);
  const retentionHold = useMutation(api.verificationArchive.retentionHold);
  const [preview, setPreview] = useState<{ url: string; type: string; title: string } | null>(null), [error, setError] = useState(""), [busy, setBusy] = useState(false);
  const activeUrl = useRef<string | null>(null);
  useEffect(() => { setPreview(null); setError(""); if (activeUrl.current) URL.revokeObjectURL(activeUrl.current); activeUrl.current = null; }, [accountId]);
  useEffect(() => () => { if (activeUrl.current) URL.revokeObjectURL(activeUrl.current); }, []);
  async function view(document: { id: string; kind: string; contentType: string }) {
    setBusy(true); setError("");
    try {
      const site = process.env.NEXT_PUBLIC_CONVEX_SITE_URL;
      if (!site) throw Error("Document service configuration is missing.");
      const response = await fetch(`${site}/admin-verification-document`, { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ documentId: document.id }), cache: "no-store" });
      if (!response.ok) throw Error("Document could not be opened. Please retry or check admin access.");
      const blob = await response.blob();
      if (activeUrl.current) URL.revokeObjectURL(activeUrl.current);
      const url = URL.createObjectURL(blob); activeUrl.current = url;
      setPreview({ url, type: document.contentType, title: document.kind });
    } catch (e) { setError(e instanceof Error ? e.message : "Could not open document."); }
    finally { setBusy(false); }
  }
  return <section className="mt-6 border-t border-white/10 pt-5" aria-label="Account documents">
    <h4 className="text-sm font-semibold text-white">Documents · retained verification copies</h4>
    <p className="mt-2 text-xs leading-5 text-white/50">Copies saved in DB Cinema storage and linked to this account and rental. Every document view requires admin access and is logged.</p>
    <p className="mt-2 text-xs text-white/50">Retained during the rental and for 30 days after closure. Open insurance cases can preserve copies until the hold is removed.</p>
    <button onClick={() => backfill({ token, accountId: accountId as any }).catch(e => setError(e.message))} className="mt-3 text-xs text-accent-300">Archive existing verifications</button>
    {archives === undefined ? <p className="mt-3 text-xs text-white/50">Loading documents…</p> : !archives.length ? <p className="mt-3 text-xs text-amber-200">No archived verification documents yet.</p> : archives.map(archive => <div key={archive._id} className="mt-4 rounded-xl border border-white/10 p-3">
      <p className="text-xs text-white/70">Rental {archive.bookingId.slice(-8)} · {archive.status === "deleted" ? "Files deleted after retention period" : archive.status === "complete" ? "Archive complete" : archive.status === "attention" ? "Archive needs attention" : "Saving documents"}</p>
      {archive.status !== "deleted" && <button onClick={() => { const reason = archive.retentionHoldReason ? "" : window.prompt("Reason for preserving documents for an open insurance/damage case (at least 10 characters)"); if (reason != null) retentionHold({ token, archiveId: archive._id, reason }).catch(e => setError(e.message)); }} className="mt-2 text-xs text-white/60">{archive.retentionHoldReason ? "Remove insurance retention hold" : "Preserve for open insurance case"}</button>}
      {!["complete", "deleted"].includes(archive.status) && <><p className="mt-2 text-xs text-amber-200">{archive.error ?? "Provider documents are being copied. Do not rely on this archive until it is complete."}</p><button onClick={() => retry({ token, archiveId: archive._id }).catch(e => setError(e.message))} className="mt-2 text-xs text-accent-300">Retry document archive</button></>}
      <ul className="mt-3 space-y-2">{archive.documents.map(document => <li key={document.id} className="flex items-center justify-between gap-3 text-xs"><span className="text-white/60">{document.kind.replaceAll("_", " ")} · {Math.ceil(document.size / 1024)} KB</span>{archive.status !== "deleted" && <button disabled={busy} onClick={() => void view(document)} className="text-accent-300 disabled:opacity-30">View document ↗</button>}</li>)}</ul>
    </div>)}
    {error && <p role="alert" className="mt-3 text-xs text-rose-200">{error}</p>}
    {preview && <div className="mt-4 rounded-xl border border-white/15 p-3"><div className="flex justify-between text-xs text-white"><span>{preview.title}</span><button onClick={() => { setPreview(null); if (activeUrl.current) URL.revokeObjectURL(activeUrl.current); activeUrl.current = null; }}>Close</button></div>{preview.type === "application/pdf" ? <iframe src={preview.url} title={preview.title} className="mt-3 h-96 w-full" /> : <img src={preview.url} alt={preview.title} className="mt-3 max-h-96 w-full object-contain" />}<a href={preview.url} download={preview.title} className="mt-3 inline-block text-xs text-accent-300">Download retained copy</a></div>}
  </section>;
}
