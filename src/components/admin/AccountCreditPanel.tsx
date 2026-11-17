"use client";

import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@cvx/_generated/api";
import { AccountCreditReceipts } from "../account/AccountCreditReceipts";
import { formatGbp } from "@/lib/pricing";

type SavedGrant = { id: string; digest: string; amount: string; expectedRevision?: number };

export function AccountCreditPanel({ token, accountId }: { token: string; accountId: string }) {
  return <CreditPanel key={JSON.stringify([token, accountId])} token={token} accountId={accountId} />;
}

function CreditPanel({ token, accountId }: { token: string; accountId: string }) {
  const grant = useMutation(api.accountCredits.grantAdmin);
  const storageKey = `dbc-credit-request:${accountId}`;
  const busyRef = useRef(false);
  const [saved, setSaved] = useState<SavedGrant | null>(null);
  const [ready, setReady] = useState(false);
  const [amount, setAmount] = useState("10");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [messageTone, setMessageTone] = useState<"success" | "attention">("attention");
  const grantState = useQuery(api.accountCredits.grantStatus, saved
    ? { token, accountId: accountId as any, requestId: saved.id }
    : { token, accountId: accountId as any });

  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(storageKey);
      if (raw) {
        const request = JSON.parse(raw) as SavedGrant;
        if (typeof request.id === "string" && /^(?:[a-f0-9-]{36}|[a-f0-9]{64})$/.test(request.id)
          && typeof request.digest === "string" && /^[a-f0-9]{64}$/.test(request.digest)
          && typeof request.amount === "string"
          && (request.expectedRevision === undefined || (Number.isSafeInteger(request.expectedRevision) && request.expectedRevision >= 0))) {
          setSaved(request);
          setAmount(request.amount);
        } else {
          sessionStorage.removeItem(storageKey);
        }
      }
    } catch {
      setMessage("Retry protection is available for this open tab only.");
      setMessageTone("attention");
    } finally {
      setReady(true);
    }
  }, [storageKey]);

  useEffect(() => {
    if (!ready || !saved || !grantState) return;
    const receipt = grantState.receipt;
    if (receipt?.requestId === saved.id) {
      try { sessionStorage.removeItem(storageKey); } catch {}
      setSaved(null);
      setMessage(`${formatGbp(receipt.amount)} added · available until ${new Date(receipt.expiresAt).toLocaleDateString("en-GB", { timeZone: "Europe/London" })}.`);
      setMessageTone("success");
      return;
    }
    if (saved.expectedRevision !== undefined && grantState.revision > saved.expectedRevision) {
      try { sessionStorage.removeItem(storageKey); } catch {}
      setSaved(null);
      setMessage("Account credit changed in another tab. Review the latest balance, then try again.");
      setMessageTone("attention");
    }
  }, [ready, saved, grantState, storageKey]);

  async function submit() {
    const numericAmount = Number(amount);
    if (busyRef.current || !ready || !grantState || !Number.isFinite(numericAmount) || numericAmount <= 0
      || Math.round(numericAmount * 100) / 100 !== numericAmount) return;

    busyRef.current = true;
    setBusy(true);
    setMessage("");
    setMessageTone("attention");
    try {
      const reason = note.trim() || "Administrator account credit";
      const digestInput = JSON.stringify([accountId, numericAmount, reason]);
      const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(digestInput));
      const digest = Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, "0")).join("");
      if (saved && saved.digest !== digest) {
        setMessage("Request may have completed. Retry with the saved amount and same note.");
        return;
      }

      const request = saved
        ? { ...saved, expectedRevision: saved.expectedRevision ?? grantState.revision }
        : {
            id: Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify([accountId, grantState.revision, numericAmount, reason])))), byte => byte.toString(16).padStart(2, "0")).join(""),
            digest,
            amount,
            expectedRevision: grantState.revision,
          };
      setSaved(request);
      try { sessionStorage.setItem(storageKey, JSON.stringify(request)); }
      catch { setMessage("Issuing now. Keep this tab open until the result appears."); setMessageTone("attention"); }

      const result = await grant({ token, accountId: accountId as any, amount: numericAmount, reason, requestId: request.id, expectedRevision: request.expectedRevision! });
      try { sessionStorage.removeItem(storageKey); } catch {}
      setSaved(null);
      setMessage(`${formatGbp(result.amount)} added · available until ${new Date(result.expiresAt).toLocaleDateString("en-GB", { timeZone: "Europe/London" })}.`);
      setMessageTone("success");
    } catch (error: any) {
      setMessage(error?.data?.message ?? error.message ?? "Credit was not confirmed. Retry the saved request safely.");
      setMessageTone("attention");
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  const validAmount = Number.isFinite(Number(amount)) && Number(amount) > 0
    && Math.round(Number(amount) * 100) / 100 === Number(amount);

  return (
    <section aria-label="Account credit controls" className="relative isolate space-y-3 overflow-hidden rounded-2xl border border-white/10 bg-[linear-gradient(145deg,rgba(255,255,255,.055),rgba(21,23,25,.96)_45%,rgba(87,61,37,.18))] p-3.5 shadow-[0_14px_42px_rgba(0,0,0,.2)] backdrop-blur-2xl">
      <div className="flex items-center gap-2.5">
        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-xl border border-amber-100/15 bg-amber-100/[.07] text-amber-100">
          <svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><rect x="3.5" y="6" width="17" height="12" rx="2.5"/><path d="M3.5 10h17M7 14h3"/><circle cx="16.5" cy="14" r="1.5"/></svg>
        </span>
        <div className="min-w-0">
          <h3 className="text-sm font-semibold tracking-tight text-white">Issue account credit</h3>
          <p className="text-[11px] text-white/50">Added to balance · expires in 1 year</p>
        </div>
        <div aria-label="Available account credit" className="ml-auto shrink-0 text-right">
          <p className="text-[9px] font-medium uppercase tracking-[.11em] text-white/40">Available</p>
          <p className="text-sm font-semibold tabular-nums text-amber-50">{grantState && Number.isSafeInteger(grantState.availablePence) ? formatGbp(grantState.availablePence / 100) : "—"}</p>
        </div>
      </div>

      {saved && <div role="status" className="rounded-xl border border-sky-200/15 bg-sky-200/[.06] px-3 py-2 text-xs text-sky-50"><strong className="font-medium">Request saved</strong><span className="ml-2 text-sky-100/70">{formatGbp(Number(saved.amount))} · retry with the same note</span></div>}

      <div className="grid gap-2 sm:grid-cols-[minmax(6rem,.38fr)_minmax(0,1fr)]">
        <label className="text-[10px] font-medium uppercase tracking-[.1em] text-white/45">Amount (£)
          <input aria-label="Credit amount" type="number" min="0.01" step="0.01" value={amount} disabled={busy || !!saved} onChange={event => setAmount(event.target.value)} className="mt-1.5 block w-full rounded-xl border border-white/10 bg-black/20 px-3 py-2.5 text-sm font-medium text-white outline-none transition focus:border-amber-100/35 focus:ring-2 focus:ring-amber-100/[.06] disabled:opacity-60" />
        </label>
        <label className="text-[10px] font-medium uppercase tracking-[.1em] text-white/45">Reason
          <input aria-label="Credit note" required value={note} maxLength={500} disabled={busy} onChange={event => setNote(event.target.value)} placeholder="Why this credit?" className="mt-1.5 block w-full rounded-xl border border-white/10 bg-black/20 px-3 py-2.5 text-sm text-white outline-none transition placeholder:text-white/25 focus:border-amber-100/35 focus:ring-2 focus:ring-amber-100/[.06] disabled:opacity-60" />
        </label>
      </div>

      <button type="button" data-testid="account-credit-submit" disabled={busy || !ready || !grantState || !validAmount || !note.trim()} onClick={() => void submit()} className="inline-flex min-h-9 items-center gap-2 rounded-xl border border-amber-100/20 bg-gradient-to-r from-amber-200 via-amber-100 to-orange-200 px-3.5 py-2 text-xs font-semibold text-zinc-950 shadow-[0_8px_22px_rgba(207,158,102,.16)] transition hover:-translate-y-px hover:shadow-[0_10px_26px_rgba(207,158,102,.24)] disabled:translate-y-0 disabled:opacity-45">
        <svg aria-hidden="true" viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M12 5v14M5 12h14"/></svg>
        {busy ? "Adding…" : saved ? `Retry ${formatGbp(Number(saved.amount))}` : `Add ${formatGbp(Number(amount) || 0)}`}
      </button>
      {message && <p role="status" className={`rounded-xl border px-3 py-2 text-xs leading-relaxed ${messageTone === "success" ? "border-emerald-200/15 bg-emerald-200/[.06] text-emerald-50" : "border-amber-200/15 bg-amber-200/[.06] text-amber-50"}`}>{message}</p>}

      <AccountCreditReceipts token={token} accountId={accountId} />
    </section>
  );
}
