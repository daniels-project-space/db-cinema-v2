"use client";
import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@cvx/_generated/api";
import type { Id } from "@cvx/_generated/dataModel";

type Draft = { marketingOnly: boolean | null; expectedUpdatedAt?: number };
export function MarketingListingsAdmin({ token }: { token: string }) {
  const result = useQuery(api.marketingAdmin.list, { token });
  const saveTags = useMutation(api.marketingAdmin.save);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("all");
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const items = result?.items ?? [];
  const visible = items.filter(l => l.title.toLowerCase().includes(search.toLowerCase()) &&
    (filter === "all" || (filter === "marketing" ? l.marketingOnly : !l.marketingOnly)));
  const dirty = Object.keys(drafts).length;
  async function save() {
    setBusy(true); setError(""); setMessage("");
    try {
      const saved = await saveTags({ token, changes: Object.entries(drafts).map(([id, d]) => ({
        listingId: id as Id<"listings">, ...d,
      })) });
      setDrafts({}); setMessage(`Saved ${saved.saved} ${saved.saved === 1 ? "listing" : "listings"}. Baskets update immediately.`);
    } catch (e) { setError(e instanceof Error ? e.message : "Could not save tags."); }
    finally { setBusy(false); }
  }
  if (!result) return <p className="mt-6 text-sm text-white/50">Loading listings…</p>;
  if (!result.authorized) return <p className="mt-6 text-sm text-rose-300">Unlock the admin panel to manage listings.</p>;
  return <section data-testid="marketing-admin" className="mt-6 space-y-4">
    <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-4 sm:p-5">
      <h2 className="text-xl font-semibold text-white">Marketing-only listings</h2>
      <p className="mt-2 max-w-3xl text-sm leading-6 text-white/55">Keep these listings visible for browsing, then show them as unavailable in the basket with available alternatives. Saved changes update open baskets immediately.</p>
      <p className="mt-2 text-xs leading-5 text-white/45">New listings appear here automatically. Known marketing models are tagged automatically; your manual choices survive imports. Untagging still checks actual stock and rental dates.</p>
      <p data-testid="marketing-count" className="mt-3 text-xs text-accent-300">{items.filter(l => l.marketingOnly).length} tagged · {items.length} listings</p>
    </div>
    <div className="sticky top-20 z-10 flex flex-wrap items-center gap-3 rounded-2xl border border-white/10 bg-[#141414] p-3">
      <input aria-label="Search listings" placeholder="Search any listing…" value={search} onChange={e => setSearch(e.target.value)} className="min-w-0 flex-1 rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-white outline-none" />
      <select aria-label="Filter listings" value={filter} onChange={e => setFilter(e.target.value)} className="rounded-lg border border-white/10 bg-[#141414] px-3 py-2 text-sm text-white">
        <option value="all">All listings</option><option value="marketing">Marketing only</option><option value="other">Not marketing only</option>
      </select>
      <button data-testid="save-marketing-tags" disabled={!dirty || busy} onClick={save} className="btn-primary px-4 py-2 text-sm disabled:opacity-40">{busy ? "Saving…" : `Save${dirty ? ` ${dirty} ${dirty === 1 ? "change" : "changes"}` : " changes"}`}</button>
      {dirty > 0 && <button disabled={busy} onClick={() => { setDrafts({}); setError(""); }} className="text-xs text-white/60 underline">Discard changes</button>}
    </div>
    {message && <p role="status" className="text-sm text-emerald-300">{message}</p>}
    {error && <p role="alert" className="text-sm text-rose-300">{error}</p>}
    <div className="space-y-2">
      {visible.map(l => {
        const draft = drafts[l._id];
        const selected = draft ? (draft.marketingOnly ?? l.automaticMatch) : l.marketingOnly;
        return <div key={l._id} data-marketing-listing={l._id} className="flex flex-wrap items-center gap-3 rounded-xl border border-white/10 bg-white/[0.02] p-4">
          <label className="flex w-full min-w-0 cursor-pointer items-start gap-3 sm:w-auto sm:flex-1">
            <input data-testid="marketing-toggle" type="checkbox" aria-label={`Marketing only: ${l.title}`} checked={selected} disabled={busy} onChange={e => {
              setMessage(""); setDrafts(prev => ({ ...prev, [l._id]: { marketingOnly: e.target.checked, expectedUpdatedAt: prev[l._id] ? prev[l._id].expectedUpdatedAt : l.updatedAt } }));
            }} className="mt-1 h-5 w-5 shrink-0 accent-[#ff7a00]" />
            <span className="min-w-0"><span className="block break-words text-sm text-white/85">{l.title}</span><span className="mt-1 block text-xs text-white/45">{l.category} · {l.source === "admin" ? "Manual choice" : "Automatic"}{!l.active ? " · Inactive listing" : ""}{draft ? " · Unsaved" : ""}</span></span>
          </label>
          <span className={`rounded-full px-3 py-1 text-xs ${selected ? "bg-amber-500/10 text-amber-300" : "bg-white/5 text-white/45"}`}>{selected ? "Marketing only" : "Not marketing only"}</span>
          {l.source === "admin" && <button disabled={busy} onClick={() => setDrafts(prev => ({ ...prev, [l._id]: { marketingOnly: null, expectedUpdatedAt: prev[l._id] ? prev[l._id].expectedUpdatedAt : l.updatedAt } }))} className="text-xs text-white/55 underline">Use automatic tagging</button>}
        </div>;
      })}
      {!visible.length && <p className="p-4 text-sm text-white/45">No listings match this search.</p>}
    </div>
  </section>;
}
