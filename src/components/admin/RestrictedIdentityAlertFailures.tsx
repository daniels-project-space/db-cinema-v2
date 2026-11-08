"use client";

import { useRef, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@cvx/_generated/api";

export function RestrictedIdentityAlertFailures({ token, onOpen }: { token: string; onOpen: (bookingId: string) => void }) {
  const jobs = useQuery(api.restrictedIdentityAlerts.attention, { token });
  const rechecks = useQuery(api.restrictedIdentityAlerts.recheckAttention, { token });
  const retry = useMutation(api.restrictedIdentityAlerts.retry);
  const retryRecheck = useMutation(api.restrictedIdentityAlerts.retryRecheck);
  const [pending, setPending] = useState<{ scope: { token: string }; id: string } | null>(null);
  const [failure, setFailure] = useState<{ scope: { token: string }; message: string } | null>(null);
  const scope = useRef({ token });
  if (scope.current.token !== token) scope.current = { token };
  if (!jobs?.length && !rechecks?.length) return null;
  async function retryJob(id: NonNullable<typeof jobs>[number]["id"]) {
    const originalToken = token, originalScope = scope.current;
    setPending({ scope: originalScope, id });
    setFailure(null);
    try { await retry({ token: originalToken, id }); }
    catch { if (scope.current === originalScope) setFailure({ scope: originalScope, message: "The identity check could not be retried. Please try again." }); }
    finally { if (scope.current === originalScope) setPending(null); }
  }
  async function retryAccount(id: NonNullable<typeof rechecks>[number]["id"]) {
    const originalToken=token,originalScope=scope.current;setPending({scope:originalScope,id});setFailure(null);
    try{await retryRecheck({token:originalToken,id});}catch{if(scope.current===originalScope)setFailure({scope:originalScope,message:"The account recheck could not be retried. Please try again."});}finally{if(scope.current===originalScope)setPending(null);}
  }
  const total = (jobs?.length ?? 0) + (rechecks?.length ?? 0);
  const retryClass = "inline-flex min-h-11 items-center justify-center rounded-lg border border-[#d6aa77]/35 bg-[#d6aa77]/10 px-3 text-xs font-medium text-[#f5d4aa] transition-colors hover:bg-[#d6aa77]/20 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#f5d4aa] disabled:cursor-not-allowed disabled:opacity-50";
  return <section aria-label="Identity check delivery failures" className="mb-4 overflow-hidden rounded-2xl border border-[#d6aa77]/25 bg-[#191613] text-sm shadow-[0_16px_40px_rgba(0,0,0,0.18)]">
    <div className="flex items-start gap-3 border-b border-white/[0.07] bg-gradient-to-r from-[#d6aa77]/10 to-transparent px-4 py-4 sm:px-5">
      <span aria-hidden="true" className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-[#e4b782]/25 bg-[#e4b782]/10 text-[#f0c18a]">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="h-5 w-5"><path d="M12 3.5 20 7v5c0 4.1-3.1 7-8 8.5C7.1 19 4 16.1 4 12V7l8-3.5Z"/><path d="M12 8v4.5m0 3h.01" strokeLinecap="round"/></svg>
      </span>
      <div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><h2 className="text-sm font-semibold text-[#faead8]">Identity checks need attention</h2><span className="rounded-full border border-[#d6aa77]/25 bg-[#d6aa77]/10 px-2 py-0.5 text-[10px] font-semibold tracking-wide text-[#efc699]">{total >= 20 ? "20+" : total} pending</span></div>
        <p className="mt-1 max-w-2xl text-xs leading-5 text-[#e5d2be]/70">The possible-match check could not finish. Verification was not stopped; retry the check and review the rental.</p></div>
    </div>
    <div className="space-y-2 p-3 sm:p-4">{jobs?.map(job => <div key={job.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-white/[0.08] bg-white/[0.025] px-3 py-3 sm:px-4">
      <div className="min-w-0"><div className="text-xs font-semibold text-white/90">Rental {String(job.bookingId).slice(-8).toUpperCase()}</div><div className="mt-1 text-[11px] text-white/50">Possible-match check · {job.attempts} {job.attempts === 1 ? "attempt" : "attempts"}</div></div>
      <div className="flex flex-wrap gap-2"><button type="button" onClick={() => onOpen(job.bookingId)} className="inline-flex min-h-11 items-center justify-center rounded-lg border border-white/15 px-3 text-xs font-medium text-white/80 transition-colors hover:bg-white/[0.06] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#f5d4aa]">Open rental</button>
      <button type="button" disabled={pending?.scope === scope.current} onClick={() => void retryJob(job.id)} className={retryClass}>{pending?.scope === scope.current && pending.id === job.id ? "Retrying…" : "Retry check"}</button></div>
    </div>)}{rechecks?.map(job=><div key={job.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-white/[0.08] bg-white/[0.025] px-3 py-3 sm:px-4"><div className="min-w-0"><div className="text-xs font-semibold text-white/90">Restricted account {String(job.accountId).slice(-8).toUpperCase()}</div><div className="mt-1 text-[11px] text-white/50">Account recheck · {job.attempts} {job.attempts === 1 ? "attempt" : "attempts"}</div></div><button type="button" disabled={pending?.scope===scope.current} onClick={()=>void retryAccount(job.id)} className={retryClass}>{pending?.scope===scope.current&&pending.id===job.id?"Retrying…":"Retry account check"}</button></div>)}</div>
    {failure?.scope === scope.current && <p role="alert" className="mx-4 mb-4 rounded-lg border border-red-300/20 bg-red-400/10 px-3 py-2 text-xs text-red-100">{failure.message}</p>}
  </section>;
}
