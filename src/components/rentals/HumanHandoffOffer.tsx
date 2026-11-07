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
  return <div data-testid="human-handoff-offer" className="mt-3 rounded-xl border border-[#d5a474]/25 bg-[#1c1b19]/90 p-3 text-xs shadow-[0_8px_24px_#0002] backdrop-blur-lg">
    <div className="flex items-center gap-2"><span aria-hidden="true" className="grid h-8 w-8 shrink-0 place-items-center rounded-lg border border-[#d5a474]/25 bg-[#d5a474]/10 text-[#e8bb84]"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" className="h-4 w-4"><circle cx="12" cy="8" r="3.25"/><path d="M5.5 20v-1.5a6.5 6.5 0 0 1 13 0V20"/></svg></span><p className="font-semibold text-[#f2e5d6]">Need a team member?</p></div>
    {sent ? <p role="status" className="mt-2 leading-5 text-[#dfc9ac]">Your request was recorded in this conversation.</p> : <button type="button" onClick={() => void request()} disabled={busy} className="mt-3 min-h-11 rounded-lg bg-[#c89b6d] px-4 font-semibold text-[#21170e] disabled:opacity-50">{busy ? "Sending…" : "Request a human"}</button>}
    {error && <p role="alert" className="mt-2 leading-5 text-rose-200">The request could not be confirmed. Please try again.</p>}
  </div>;
}
