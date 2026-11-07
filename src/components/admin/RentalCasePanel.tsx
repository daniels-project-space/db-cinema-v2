"use client";

import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@cvx/_generated/api";

export function RentalCasePanel({ token, bookingId }: { token: string; bookingId: string }) {
  return <RentalCaseForm key={JSON.stringify([token, bookingId])} token={token} bookingId={bookingId}/>;
}

function RentalCaseForm({ token, bookingId }: { token: string; bookingId: string }) {
  const schedule = useQuery(api.returnInspections.schedule, { token, bookingId: bookingId as any });
  const openCase = useMutation(api.returnInspections.openCase);
  const [itemKey, setItemKey] = useState(""), [details, setDetails] = useState(""), [confirm, setConfirm] = useState(false), [busy, setBusy] = useState(false), [message, setMessage] = useState("");
  const [matches, setMatches] = useState<Array<{id:string;status:string;openedAt:number}>>([]);
  const storageKey = `dbc-case-recovery:${bookingId}`;
  const pending = useRef<{ fingerprint: string; requestId: string } | null>(null), submitLock = useRef(false);
  const [storageReady, setStorageReady] = useState(false), [recovering, setRecovering] = useState(false);
  useEffect(() => {
    try {
      const saved = sessionStorage.getItem(storageKey);
      if (saved) {
        const value = JSON.parse(saved);
        if (!/^[a-f0-9]{64}$/.test(value.fingerprint) || !/^[a-zA-Z0-9-]{16,80}$/.test(value.requestId)) throw Error("Invalid recovery record");
        pending.current = { fingerprint: value.fingerprint, requestId: value.requestId };
        setRecovering(true);
      }
      setStorageReady(true);
    } catch { setMessage("Case recovery is unavailable in this browser. Do not submit another case until the team checks the existing records."); }
  }, [storageKey]);
  useEffect(() => {
    if (!storageReady || !pending.current || !schedule?.cases.some(record => record.requestId === pending.current?.requestId)) return;
    try { sessionStorage.removeItem(storageKey); } catch { setMessage("The case was opened, but its recovery record could not be cleared. Check the existing case before proceeding."); setStorageReady(false); return; }
    pending.current = null; setRecovering(false); setConfirm(false); setItemKey(""); setDetails("");
    setMessage("Internal case opened. Review its status under Return inspection & cases.");
  }, [schedule, storageKey, storageReady]);
  const ready = storageReady && !!itemKey && details.trim().length >= 10 && details.trim().length <= 2000;
  async function submit(reviewedMatches?: Array<{id:string;status:string;openedAt:number}>) {
    if (!confirm || !ready || busy || submitLock.current) return;
    submitLock.current = true;
    setBusy(true); setMessage("");
    try {
      const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify([itemKey, details.trim()])));
      const fingerprint = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
      if (pending.current && pending.current.fingerprint !== fingerprint) throw Error("An earlier case request is unresolved. Re-enter its exact item and details to retry, or check the existing case records before proceeding.");
      if (!pending.current) {
        const next = { fingerprint, requestId: crypto.randomUUID() };
        sessionStorage.setItem(storageKey, JSON.stringify(next));
        pending.current = next; setRecovering(true);
      }
      await openCase({ token, bookingId: bookingId as any, itemKey, details: details.trim(), requestId: pending.current.requestId, confirmed: true, ...(reviewedMatches ? { reviewedMatches: reviewedMatches as any } : {}) });
      sessionStorage.removeItem(storageKey);
      setConfirm(false); setDetails(""); setItemKey(""); pending.current = null;
      setRecovering(false); setMatches([]);
      setMessage("Internal case opened. Review its status under Return inspection & cases.");
    } catch (error: any) {
      if (error?.data?.code === "CASE_MATCH_REVIEW" && Array.isArray(error.data.matches) && error.data.matches.length && error.data.matches.every((match:any) => typeof match.id === "string" && ["open", "closed"].includes(match.status) && Number.isFinite(match.openedAt))) {
        setMatches(error.data.matches); setMessage("");
      } else { setMatches([]); setMessage(error?.data?.code === "CASE_MATCH_REVIEW" ? "The matching case history changed. Check the existing case records before retrying." : error instanceof Error ? error.message : "The case outcome is unknown. Check the existing case before retrying."); }
    }
    finally { submitLock.current = false; setBusy(false); }
  }
  return <details data-testid="admin-rental-case" className="group mt-3 overflow-hidden rounded-2xl border border-[#b48a5e]/30 bg-[#171717] text-sm shadow-[0_12px_35px_#0003]">
    <summary className="flex min-h-16 cursor-pointer items-center gap-3 bg-[#c8986510] px-4 py-3 text-left text-[#f2e7da] [&::-webkit-details-marker]:hidden"><span aria-hidden="true" className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-[#d5a474]/25 bg-[#d5a474]/10 text-[#e8bb84]"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" className="h-5 w-5"><path d="M12 3 4.5 6v5.5c0 4.4 2.8 7.7 7.5 9.5 4.7-1.8 7.5-5.1 7.5-9.5V6L12 3Z"/><path d="M12 8v4m0 3h.01"/></svg></span><span className="min-w-0 flex-1"><span className="block text-[10px] font-semibold uppercase tracking-[.16em] text-[#d8a66f]">Rental protection</span><span className="mt-1 block font-semibold leading-5">Open an internal damage or insurance case</span></span><span aria-hidden="true" className="text-lg text-[#d8a66f] transition-transform group-open:rotate-45">＋</span></summary>
    <div className="space-y-4 border-t border-white/10 p-4">
      <p className="rounded-xl border border-[#d5a474]/15 bg-[#d5a474]/[.06] p-3 text-xs leading-5 text-[#d8c5ad]">Records an internal case and protects available verification copies during the investigation. This does not submit a claim to an insurer or charge the customer; expired or deleted copies are not restored.</p>
      {recovering && matches.length === 0 && <p className="rounded-xl border border-amber-300/25 bg-amber-300/5 p-3 text-xs leading-5 text-amber-100">A previous case request is being checked. If it is not listed yet, re-enter the exact item and details and review before retrying. Do not start a different case until its outcome is known.</p>}
      <label className="block text-xs font-medium text-white/75">Affected item<select aria-label="Affected case item" value={itemKey} disabled={busy || !schedule} onChange={event => { setItemKey(event.target.value); setConfirm(false); setMatches([]); }} className="input mt-2 min-h-11 w-full"><option value="">{schedule ? "Select an item" : "Loading rental items…"}</option>{schedule?.items.map(item => <option key={item.key} value={item.key}>{item.title}</option>)}</select></label>
      <label className="block text-xs font-medium text-white/75">Issue and evidence<textarea aria-label="Case issue and evidence" value={details} maxLength={2000} rows={3} disabled={busy} onChange={event => { setDetails(event.target.value); setConfirm(false); setMatches([]); }} className="input mt-2 min-h-24 w-full" placeholder="Describe the issue and evidence"/></label>
      {matches.length > 0 && <div aria-label="Matching cases" className="overflow-hidden rounded-xl border border-[#b48a5e]/35 bg-[#1d1b18]"><div className="flex items-start gap-3 border-b border-white/10 p-4"><span aria-hidden="true" className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-[#d5a474]/25 bg-[#d5a474]/10 text-[#e8bb84]"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" className="h-5 w-5"><circle cx="11" cy="11" r="6.5"/><path d="m16 16 4 4M11 8v3m0 3h.01"/></svg></span><div className="min-w-0"><p className="text-[10px] font-semibold uppercase tracking-[.14em] text-[#d8a66f]">Check existing records</p><h5 className="mt-1 text-sm font-semibold text-[#f6eee4]">A matching case already exists</h5><p className="mt-1 text-xs leading-5 text-[#c5b4a0]">Same item and issue. Review Return inspection &amp; cases before opening a separate record.</p></div></div><div className="space-y-2 p-4"><p className="break-words text-xs font-semibold text-white">{schedule?.items.find(item => item.key === itemKey)?.title}</p><p className="whitespace-pre-wrap break-words text-xs leading-5 text-white/70">{details.trim()}</p><ul className="space-y-2">{matches.map(match => <li key={match.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-white/[0.07] bg-black/20 px-3 py-2.5 text-xs"><span className="font-medium text-[#e9ddce]">Case · {match.id.slice(-6)}</span><span className="text-[#c9b29a]">{match.status === "open" ? "Open" : "Closed"} · {new Date(match.openedAt).toLocaleDateString("en-GB", { timeZone:"Europe/London" })}</span></li>)}</ul><div className="flex flex-wrap gap-2 pt-1"><button type="button" disabled={busy || !confirm || !ready} onClick={() => void submit(matches)} className="min-h-11 rounded-lg bg-[#c89b6d] px-4 text-xs font-semibold text-[#21170e] disabled:bg-white/10 disabled:text-white/55">Confirm separate case</button><button type="button" disabled={busy} onClick={() => { setMatches([]); setConfirm(false); }} className="min-h-11 rounded-lg border border-white/20 px-4 text-xs text-white/80 disabled:opacity-50">Cancel</button></div></div></div>}
      {matches.length === 0 && (confirm ? <div aria-label="Review internal case" className="space-y-3 rounded-xl border border-[#d5a474]/25 bg-[#d5a474]/[.05] p-3"><p className="text-[10px] font-semibold uppercase tracking-[.14em] text-[#d8a66f]">Review before opening</p><p className="text-xs font-semibold text-white">{schedule?.items.find(item => item.key === itemKey)?.title}</p><p className="whitespace-pre-wrap break-words text-xs leading-5 text-white/70">{details.trim()}</p><div className="flex flex-wrap gap-2"><button type="button" disabled={busy || !ready} onClick={() => void submit()} className="min-h-11 rounded-lg bg-[#c89b6d] px-4 text-xs font-semibold text-[#21170e] disabled:opacity-50">{busy ? "Opening…" : "Confirm internal case"}</button><button type="button" disabled={busy} onClick={() => setConfirm(false)} className="min-h-11 rounded-lg border border-white/20 px-4 text-xs text-white/80 disabled:opacity-50">Cancel</button></div></div> : <button type="button" disabled={!ready || busy} onClick={() => { setConfirm(true); setMessage(""); }} className="min-h-11 rounded-lg border border-[#d5a474]/35 bg-[#d5a474]/10 px-4 text-xs font-semibold text-[#edc89f] disabled:opacity-50">Review case</button>)}
      {message && <p role="status" className="text-xs leading-5 text-amber-100">{message}</p>}
    </div>
  </details>;
}
