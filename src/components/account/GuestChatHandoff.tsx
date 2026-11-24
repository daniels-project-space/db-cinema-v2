"use client";
import { useEffect, useRef, useState } from "react";
import { useMutation } from "convex/react";
import { api } from "@cvx/_generated/api";

export const GUEST_CHAT_HANDOFF_KEY = "dbc_guest_chat_handoff_v1";
type Handoff = { requestId: string; transcript: string };

export function GuestChatHandoff({ token, email }: { token: string; email: string }) {
  const [handoff, setHandoff] = useState<Handoff | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const currentToken = useRef(token);
  const mounted = useRef(false);
  currentToken.current = token;
  const transfer = useMutation(api.chat.importGuestHistory);
  useEffect(() => {
    mounted.current = true;
    try {
      const saved = JSON.parse(localStorage.getItem(GUEST_CHAT_HANDOFF_KEY) || "null");
      if (saved && /^guest_[a-zA-Z0-9_-]{16,80}$/.test(saved.requestId) && typeof saved.transcript === "string" && saved.transcript.length <= 8000) setHandoff(saved);
    } catch {}
    return () => { mounted.current = false; };
  }, [token]);
  if (!handoff) return null;
  async function save() {
    if (!handoff || busy) return;
    const requestedToken = token;
    setBusy(true); setError("");
    try {
      await transfer({ token: requestedToken, ...handoff });
      if (!mounted.current || currentToken.current !== requestedToken) return;
      const current = JSON.parse(localStorage.getItem(GUEST_CHAT_HANDOFF_KEY) || "null");
      if (current?.requestId === handoff.requestId && current?.transcript === handoff.transcript) localStorage.removeItem(GUEST_CHAT_HANDOFF_KEY);
      setHandoff(null);
      window.dispatchEvent(new Event("dbc:open-renter-notifications"));
    } catch {
      if (mounted.current && currentToken.current === requestedToken) setError("Couldn’t save the conversation. Try again.");
    } finally { if (mounted.current && currentToken.current === requestedToken) setBusy(false); }
  }
  return <section aria-label="Save guest conversation" className="fixed bottom-4 right-4 z-[100] w-[min(24rem,calc(100vw-2rem))] rounded-2xl border border-amber-100/20 bg-[#211d19] p-4 text-sm text-white/80 shadow-xl">
    <strong className="text-white">Save your guest chat?</strong>
    <p className="mt-1">Add a copy to {email}. It will be marked as unverified guest history. You can then enable alerts.</p>
    <details className="mt-2"><summary className="cursor-pointer text-amber-100/80">Preview conversation</summary><p className="mt-2 max-h-36 overflow-auto whitespace-pre-wrap break-words text-white/65">{handoff.transcript}</p></details>
    <div className="mt-3 flex flex-wrap gap-3"><button type="button" disabled={busy} onClick={() => void save()} className="rounded-xl bg-[#d2a878] px-4 py-2 font-semibold text-black">{busy ? "Saving…" : "Save and set up alerts"}</button><button type="button" disabled={busy} onClick={() => setHandoff(null)} className="px-2 py-2 text-white/65">Not now</button></div>
    {error && <p role="alert" className="mt-2 text-amber-100">{error}</p>}
  </section>;
}
