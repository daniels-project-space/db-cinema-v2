"use client";

import { useEffect, useRef, useState } from "react";
import { useAction } from "convex/react";
import { api } from "@cvx/_generated/api";

export function AdminGaffer({ token, accountId, bookingId }: { token: string; accountId: string; bookingId: string }) {
  const ask = useAction((api as any).adminGaffer.answer);
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const scope = `${token}:${accountId}:${bookingId}`;
  const currentScope = useRef(scope);
  currentScope.current = scope;
  useEffect(() => { setQuestion(""); setAnswer(""); setError(""); setBusy(false); }, [scope]);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (busy || !question.trim()) return;
    setBusy(true);
    setError("");
    setAnswer("");
    try {
      const result = await ask({ token, accountId, bookingId, question: question.trim() });
      if (currentScope.current === scope) setAnswer(result.answer);
    } catch {
      if (currentScope.current === scope) setError("Gaffer couldn't check this rental. Please try again.");
    } finally {
      if (currentScope.current === scope) setBusy(false);
    }
  }

  return <section aria-label="Private Gaffer assistant" className="rounded-2xl border border-amber-200/20 bg-white/[0.04] p-4">
    <h3 className="font-semibold text-amber-100">Ask Gaffer</h3>
    <p className="mt-1 text-xs text-neutral-400">Private to the team · read-only · check important details</p>
    <form onSubmit={submit} className="mt-3 flex gap-2">
      <input aria-label="Question for Gaffer" value={question} onChange={event => setQuestion(event.target.value)} maxLength={1000} placeholder="Ask about this rental…" className="min-w-0 flex-1 rounded-xl border border-white/15 bg-black/20 px-3 py-2 text-sm text-white" />
      <button type="submit" disabled={busy || !question.trim()} className="rounded-xl bg-amber-200 px-3 py-2 text-sm font-semibold text-black disabled:opacity-40">{busy ? "Checking…" : "Ask"}</button>
    </form>
    {error && <p role="alert" className="mt-3 text-sm text-red-300">{error}</p>}
    {answer && <p aria-live="polite" className="mt-3 whitespace-pre-wrap text-sm text-neutral-100">{answer}</p>}
  </section>;
}
