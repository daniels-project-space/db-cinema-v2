"use client";
import { useEffect, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@cvx/_generated/api";
import { AccountDocuments } from "./AccountDocuments";

const LEVELS = [
  ["automatic", "Automatic · subscription / existing grant"],
  ["standard", "Standard"], ["plus", "Starter"], ["pro", "Pro"], ["studio", "Studio"],
] as const;
const label = (value: string) => LEVELS.find(([key]) => key === value)?.[1] ?? value;
type Level = typeof LEVELS[number][0];

export function AccountAdmin({ token }: { token: string }) {
  const [input, setInput] = useState(""), [email, setEmail] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [level, setLevel] = useState<Level>("automatic"), [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false), [confirmBlock, setConfirmBlock] = useState(false);
  const [message, setMessage] = useState("");
  useEffect(() => { const timer = setTimeout(() => setEmail(input), 200); return () => clearTimeout(timer); }, [input]);
  const result = useQuery(api.accountAdmin.search, { token, email });
  const searchPending = input !== email || !result;
  const selected = result?.items.find(a => a.id === selectedId) ?? result?.items[0];
  const history = useQuery(api.accountAdmin.history, selected ? { token, accountId: selected.id } : "skip");
  const setAccountLevel = useMutation(api.accountAdmin.setLevel);
  const setBlocked = useMutation(api.accountAdmin.setBlocked);
  useEffect(() => {
    setLevel((selected?.override ?? "automatic") as Level);
    setReason(""); setConfirmBlock(false);
  }, [selected?.id, selected?.override, selected?.blocked]);
  useEffect(() => setMessage(""), [selected?.id]);
  async function apply(kind: "level" | "block") {
    if (!selected || busy || searchPending) return;
    setBusy(true); setMessage("");
    try {
      if (kind === "level") await setAccountLevel({ token, accountId: selected.id, level, reason });
      else await setBlocked({ token, accountId: selected.id, blocked: !selected.blocked, reason });
      setMessage(kind === "level" ? "Account level updated." : selected.blocked ? "Account unblocked. They can sign in again." : "Account blocked. Sessions and sign-in links revoked.");
      setConfirmBlock(false);
    } catch (error) { setMessage(error instanceof Error ? error.message : "Could not update this account."); }
    finally { setBusy(false); }
  }
  return <section data-testid="admin-accounts" className="mt-6">
    <div className="mb-6"><p className="hud-label">People & access</p><h2 className="mt-2 font-display text-3xl text-white">Accounts</h2></div>
    <label className="block max-w-xl text-xs text-white/60">Search by email address
      <input type="search" maxLength={254} value={input} onChange={e => { setInput(e.target.value); setSelectedId(null); }} placeholder="Full email or the beginning of an email…" data-testid="account-email-search" className="input mt-2 w-full" />
    </label>
    <p className="mt-2 text-[11px] text-white/40">{result?.more ? "Showing the first 50 matches. Refine the email to find a specific account." : email ? `${result?.items.length ?? 0} matches` : "Latest accounts · search to find an older account"}</p>
    <div className="mt-5 grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
      <div className="max-h-[650px] space-y-2 overflow-auto">
        {!result ? <p className="text-sm text-white/40">Loading accounts…</p> : !result.authorized ? <p className="text-sm text-rose-300">Admin access required.</p> : !result.items.length ? <p className="text-sm text-white/40">No accounts match that email.</p> : result.items.map(account => <button type="button" key={account.id} data-testid="admin-account-row" onClick={() => setSelectedId(account.id)} className={`flex w-full items-center gap-3 rounded-2xl border p-4 text-left transition-colors ${selected?.id === account.id ? "border-accent-300/40 bg-accent-300/[.06]" : "border-white/10 hover:bg-white/5"}`}>
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-white/15 bg-white/5 font-display text-accent-200">{(account.name || account.email).slice(0,1).toUpperCase()}</span>
          <span className="min-w-0 flex-1"><span className="block truncate text-sm text-white">{account.name || "DB Cinema renter"}</span><span className="block truncate text-xs text-white/50">{account.email}</span></span>
          <span className={`shrink-0 text-[10px] uppercase tracking-wider ${account.blocked ? "text-rose-300" : "text-accent-200"}`}>{account.blocked ? "Blocked" : label(account.tier)}</span>
        </button>)}
      </div>
      {selected && <div className="self-start rounded-2xl border border-white/10 bg-white/[.025] p-5" data-testid="admin-account-editor">
        <h3 className="font-display text-xl text-white">{selected.name || "Account access"}</h3><p className="mt-1 break-all text-sm text-white/55">{selected.email}</p>
        <AccountDocuments key={selected.id} token={token} accountId={selected.id} />
        {selected.blocked && <p className="mt-3 rounded-xl bg-rose-500/10 p-3 text-xs text-rose-200">Blocked · {selected.blockedReason}</p>}
        <label className="mt-5 block text-xs text-white/65">Membership access level<select value={level} onChange={e => { setLevel(e.target.value as Level); setMessage(""); }} data-testid="admin-account-level" className="input mt-2 w-full">{LEVELS.map(([key, name]) => <option key={key} value={key}>{name}</option>)}</select></label>
        <p className="mt-2 text-[11px] leading-5 text-white/45">Promote or demote access without starting or changing a paid subscription. Grants do not issue monthly credit or the paid security waiver. Standard removes membership access; Automatic restores the subscription or existing grant.</p>
        {selected.hasSubscription && <p className="mt-3 rounded-xl border border-amber-300/20 bg-amber-300/[.04] p-3 text-xs leading-5 text-amber-100/80">This account has a {label(selected.subscriptionTier ?? "paid")} Stripe subscription. Access changes and blocking do not cancel its billing. Manage that subscription separately.</p>}
        <label className="mt-4 block text-xs text-white/65">Reason for this change<textarea value={reason} maxLength={500} onChange={e => setReason(e.target.value)} data-testid="admin-account-reason" className="input mt-2 min-h-20 w-full" placeholder="Recorded in the account’s admin history" /></label>
        <div className="mt-4 flex flex-wrap gap-2">
          <button type="button" data-testid="admin-account-save-level" disabled={busy || searchPending || !reason.trim() || level === selected.override} onClick={() => apply("level")} className="btn-primary px-5 py-2 text-xs disabled:opacity-40">{busy ? "Saving…" : "Apply level"}</button>
          <button type="button" data-testid="admin-account-block" disabled={busy || searchPending || !reason.trim()} onClick={() => selected.blocked ? apply("block") : setConfirmBlock(true)} className="rounded-full border border-rose-300/25 px-5 py-2 text-xs text-rose-200 disabled:opacity-40">{selected.blocked ? "Unblock account" : "Block account"}</button>
        </div>
        {confirmBlock && <div className="mt-4 rounded-xl border border-rose-300/25 p-4 text-xs leading-5 text-white/65"><p>Block {selected.email}? They will be signed out and cannot create new bookings. Existing rentals, balances and owner refund controls are retained.</p><div className="mt-3 flex gap-3"><button type="button" data-testid="admin-account-confirm-block" onClick={() => apply("block")} disabled={busy} className="text-rose-200">Confirm block</button><button type="button" onClick={() => setConfirmBlock(false)}>Cancel</button></div></div>}
        {message && <p role="status" className="mt-4 text-xs text-accent-200">{message}</p>}
        {!!history?.length && <div className="mt-6 border-t border-white/10 pt-4"><h4 className="text-xs text-white/65">Recent admin changes</h4><ul className="mt-3 space-y-3">{history.map(change => <li key={change._id} className="text-[11px] leading-5 text-white/45"><span className="text-white/70">{change.kind === "level" ? `${label(change.before)} → ${label(change.after)}` : change.after === "blocked" ? "Account blocked" : "Account unblocked"}</span><span className="ml-2">{new Date(change.at).toLocaleDateString("en-GB")}</span><p>{change.reason}</p></li>)}</ul></div>}
      </div>}
    </div>
  </section>;
}
