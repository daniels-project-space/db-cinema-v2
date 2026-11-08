"use client";

import { useRef, useState } from "react";

export function HumanHandoffOffer({ onRequest }: { onRequest: () => Promise<void> }) {
  const pending = useRef(false);
  const [busy, setBusy] = useState(false), [sent, setSent] = useState(false), [error, setError] = useState(false);
  async function request() {
    if (pending.current || sent) return;
    pending.current = true; setBusy(true); setError(false);
    try { await onRequest(); setSent(true); }
    catch { setError(true); }
    finally { pending.current = false; setBusy(false); }
  }
  return <div data-testid="human-handoff-offer" aria-busy={busy} className="relative mt-3 overflow-hidden rounded-2xl border border-amber-100/15 bg-gradient-to-br from-white/[0.09] via-white/[0.055] to-amber-100/[0.035] p-3 text-xs shadow-[0_12px_28px_#0004,inset_0_1px_0_#ffffff12] backdrop-blur-2xl">
    <span aria-hidden="true" className="pointer-events-none absolute -right-5 -top-8 h-20 w-20 rounded-full bg-amber-100/[0.08] blur-2xl" />
    <div className="relative flex items-center gap-2.5">
      <span aria-hidden="true" className="grid h-9 w-9 shrink-0 place-items-center rounded-xl border border-amber-100/20 bg-amber-100/[0.08] text-amber-100 shadow-[0_0_18px_#e6c99512]"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.55" strokeLinecap="round" strokeLinejoin="round" className="h-[18px] w-[18px]"><path d="M4 6.5A2.5 2.5 0 0 1 6.5 4h8A2.5 2.5 0 0 1 17 6.5v4a2.5 2.5 0 0 1-2.5 2.5H9l-3.5 2v-2.3A2.5 2.5 0 0 1 4 10.5z"/><path d="M9 16.5A2.5 2.5 0 0 0 11.5 19h4l3 1.5v-2.2a2.5 2.5 0 0 0 1.5-2.3v-2.5"/><path d="M7.5 8h5.5M7.5 10.5h3.5"/></svg></span>
      <div className="min-w-0"><p className="font-semibold text-white">Want our team to join?</p><p className="mt-0.5 text-[11px] leading-4 text-white/55">Gaffer will pause while they reply.</p></div>
    </div>
    {sent ? <p role="status" className="relative mt-3 rounded-xl border border-emerald-200/15 bg-emerald-200/[0.06] px-3 py-2 text-emerald-100/85">Your request is in this chat.</p> : <button type="button" onClick={() => void request()} disabled={busy} className="relative mt-3 inline-flex min-h-10 w-full items-center justify-between rounded-xl border border-amber-100/25 bg-amber-100/[0.12] px-3.5 font-semibold text-amber-50 transition-[background-color,border-color,transform] duration-200 hover:-translate-y-px hover:border-amber-100/40 hover:bg-amber-100/[0.18] disabled:translate-y-0 disabled:opacity-50"><span>{busy ? "Connecting…" : "Ask the team"}</span><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4" aria-hidden="true"><path d="M5 12h13m-5-6 6 6-6 6"/></svg></button>}
    {error && <p role="alert" className="relative mt-2 leading-5 text-rose-200">Couldn’t confirm that. Try again.</p>}
  </div>;
}
