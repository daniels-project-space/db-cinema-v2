"use client";

import { useRef, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@cvx/_generated/api";

export function AdminCaseMatches({ token, bookingId }: { token: string; bookingId: string }) {
  const [cursor, setCursor] = useState<string | null>(null);
  const [history, setHistory] = useState<(string | null)[]>([]);
  const [retryError, setRetryError] = useState("");
  const [retrying, setRetrying] = useState(false);
  const retryPending = useRef(false);
  const result = useQuery((api as any).caseIdentity.matchingCases, { token, bookingId, paginationOpts: { cursor, numItems: 10 } });
  const backfill = useQuery((api as any).caseIdentity.backfillStatus, { token });
  const retry = useMutation((api as any).caseIdentity.retryBackfill);
  if (!result || (!result.page.length && result.isDone && !history.length && !backfill?.needsAttention)) return null;
  return <section aria-label="Possible rental case matches" className="rounded-xl border border-amber-300/30 bg-amber-200/[0.05] p-3 text-sm text-amber-50">
    {backfill?.needsAttention && <div role="alert" className="mb-3 rounded-lg border border-amber-300/30 p-2 text-xs">
      <p>Case history check needs attention.</p>
      <button type="button" disabled={retrying} className="mt-2 underline" onClick={async () => { if (retryPending.current) return; retryPending.current = true; setRetryError(""); setRetrying(true); try { await retry({ token }); } catch { setRetryError("Retry failed. Please contact the team."); } finally { retryPending.current = false; setRetrying(false); } }}>{retrying ? "Retrying…" : "Retry case history check"}</button>
      {retryError && <p role="alert">{retryError}</p>}
    </div>}
    {(result.page.length > 0 || history.length > 0 || !result.isDone) && <>
    <strong>Possible rental case match</strong>
    <p className="mt-1 text-xs text-amber-100/70">Compare manually. A match does not prove identity or block this renter.</p>
    {result.page.map((record: any) => <details key={record.caseId} className="mt-2 rounded-lg border border-white/10 bg-black/20 p-2">
      <summary className="cursor-pointer">{record.title} · {record.status === "open" ? "Open case" : "Closed case"}</summary>
      <p className="mt-2 whitespace-pre-wrap text-xs text-white/80">{record.details}</p>
      {record.resolution && <p className="mt-2 whitespace-pre-wrap text-xs text-white/65">Resolution: {record.resolution}</p>}
      <a className="mt-2 inline-block text-xs underline" href={`/admin?rental=${encodeURIComponent(record.bookingId)}`}>Open case rental ↗</a>
    </details>)}
    <div className="mt-2 flex gap-4 text-xs">
      {history.length > 0 && <button type="button" onClick={() => { setCursor(history.at(-1) ?? null); setHistory(history.slice(0, -1)); }}>Previous</button>}
      {!result.isDone && <button type="button" onClick={() => { setHistory([...history, cursor]); setCursor(result.continueCursor); }}>More cases</button>}
    </div>
    </>}
  </section>;
}
