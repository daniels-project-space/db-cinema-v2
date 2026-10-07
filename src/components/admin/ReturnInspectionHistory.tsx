"use client";
import { useState } from "react";
import { useQuery, useMutation } from "convex/react";
import { api } from "@cvx/_generated/api";

export function ReturnInspectionHistory({ token, bookingId }: { token: string; bookingId: string }) {
  const data = useQuery(api.returnInspections.schedule, { token, bookingId: bookingId as any });
  const close = useMutation(api.returnInspections.closeCase);
  const [selected, setSelected] = useState<string | null>(null), [reason, setReason] = useState(""), [busy, setBusy] = useState(false), [error, setError] = useState("");
  if (!data || (!data.inspection.length && !data.cases.length)) return null;
  return <details className="mt-4 rounded-lg border border-white/10 p-3 text-xs text-white/65"><summary className="cursor-pointer font-medium text-white/85">Return inspection & cases · {data.cases.filter(c => c.status === "open").length} open</summary>
    {data.inspection.map(item => <div key={item.key} className="mt-3 border-t border-white/10 pt-3"><strong className="text-white/80">{item.title}</strong><p className="mt-1">{item.condition === "good" ? "Good condition" : "Issue found"}{item.details ? ` · ${item.details}` : ""}</p></div>)}
    {data.cases.map(record => <section key={record._id} className="mt-3 rounded-lg bg-white/5 p-3"><p className="font-medium">Damage case · {record.title} · {record.status}</p><p className="mt-1">{record.details}</p>{record.resolution && <p className="mt-2 text-emerald-200">Resolution: {record.resolution}</p>}{record.status === "open" && <><p className="mt-2 text-amber-100/70">Verification copies are preserved while this case is open. Closing it resumes the normal retention rule and does not change money already settled.</p>{selected !== record._id ? <button onClick={() => { setSelected(record._id); setReason(""); setError(""); }} className="mt-2 text-accent-300">Resolve case</button> : <div className="mt-2"><label>Resolution<textarea rows={3} maxLength={2000} value={reason} onChange={e => setReason(e.target.value)} className="input mt-1 w-full" /></label><button disabled={busy || reason.trim().length < 10} onClick={async () => { setBusy(true); setError(""); try { await close({ token, caseId: record._id, resolution: reason }); setSelected(null); } catch (e) { setError(e instanceof Error ? e.message : "Case could not be resolved."); } finally { setBusy(false); } }} className="mt-2 text-accent-300 disabled:opacity-40">{busy ? "Saving…" : "Save resolution and close case"}</button></div>}</>}</section>)}
    {error && <p role="alert" className="mt-2 text-rose-200">{error}</p>}
  </details>;
}
