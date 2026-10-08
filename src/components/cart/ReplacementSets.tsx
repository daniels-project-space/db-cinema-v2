"use client";
import { useState } from "react";
import { useConvex, useQuery } from "convex/react";
import { api } from "@cvx/_generated/api";
import { dayMs } from "@/lib/dates";
import { formatGbp } from "@/lib/pricing";
import { SmartImage } from "@/components/SmartImage";
import { useCart, type CartItem } from "./CartProvider";

export function ReplacementSets({ item }: { item: CartItem }) {
  const cart = useCart(), convex = useConvex();
  const [limit, setLimit] = useState(2), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const args = { items: cart.items.map(i => ({ key: i.key, listingId: i.listingId as any, start: dayMs(i.start), end: dayMs(i.end),pickupTime:i.pickupTime,returnTime:i.returnTime })), sourceKey: item.key, limit: Math.min(20, limit + 1) };
  const data = useQuery(api.cartReplacements.sets, args);
  // Repeated cart rows share one quantity-aware replacement panel.
  if (data && data.keys[0] !== item.key) return null;
  async function apply(optionId: string, index?: number, single = false) {
    if (busy) return;
    const expected = JSON.stringify(cart.items);
    setBusy(true); setError("");
    try {
      const fresh = await convex.query(api.cartReplacements.sets, args);
      const option = fresh?.options.find(o => o.id === optionId);
      const choices = single ? fresh?.singles.filter(c => c.listingId === optionId) : index == null ? option?.items : option && [option.items[index]];
      if (!fresh || !choices?.length) throw Error("Stock changed. Choose a currently available replacement.");
      if (choices.some(c => !c)) throw Error("This replacement changed. Try again.");
      if (single || index != null) cart.addReplacement(expected, item.key, { ...choices[0], start: item.start, end: item.end,pickupTime:item.pickupTime,returnTime:item.returnTime });
      else cart.switchSet(expected, fresh.keys, choices.map(c => ({ ...c, start: item.start, end: item.end,pickupTime:item.pickupTime,returnTime:item.returnTime })));
    } catch (e) { setError(e instanceof Error ? e.message : "Could not add replacements."); }
    finally { setBusy(false); }
  }
  return <section aria-busy={busy} className="min-w-0 rounded-2xl border border-accent-400/20 bg-accent-500/[.04] p-4">
    <h3 className="text-sm font-semibold text-white">Available replacement {data?.requested === 1 ? "options" : "sets"}</h3>
    <p className="mt-1 text-xs text-white/55">{item.start} → {item.end} · {data?.requested ?? "Checking"} requested · same rental period</p>
    <p className="mt-2 text-xs leading-5 text-white/55">Add all switches the unavailable request to the complete set. Add separately keeps your original request visible; remove it once you have chosen your alternatives.</p>
    {!data ? <p role="status" className="mt-3 text-sm text-white/50">Checking shared stock and alternatives…</p> : !data.options.length ? <p className="mt-3 text-sm text-white/60">{data.searchLimited ? "We haven’t found a complete set within the automatic search. Ask our team to check this larger kit." : "No complete suitable replacement set is available for these dates. Add available items separately, change the dates or ask our team."}</p> : data.options.slice(0, limit).map((option, setIndex) => <div key={option.id} className="mt-4 rounded-xl border border-white/10 p-3">
      <p className="mb-3 text-xs text-accent-300">{setIndex === 0 ? "Closest available set" : "Another available set"} · {formatGbp(option.total)}</p>
      <div className="flex gap-3 overflow-x-auto pb-2">{option.items.map((choice, index) => <article key={`${choice.listingId}-${index}`} className="w-40 shrink-0 rounded-xl border border-white/10 bg-charcoal-900 p-2">
        <SmartImage src={choice.heroImage} alt={choice.title} className="aspect-[4/3] w-full rounded-lg" />
        <p className="mt-2 line-clamp-2 text-xs leading-5 text-white/85">{choice.title}</p>
        <p className="mt-1 text-xs text-white/60">{formatGbp(choice.total)}</p>
        <button disabled={busy} onClick={() => void apply(option.id, index)} className="mt-3 w-full rounded-lg border border-white/15 px-2 py-2 text-xs text-white disabled:opacity-40">Add separately</button>
      </article>)}</div>
      <button disabled={busy} onClick={() => void apply(option.id)} className="btn-primary mt-3 w-full py-2.5 text-sm disabled:opacity-40">{option.items.length === 1 ? "Switch to this" : `Add all ${option.items.length} replacements`}</button>
    </div>)}
    {data && !data.options.length && !!data.singles.length && <div className="mt-4 flex gap-3 overflow-x-auto pb-2">{data.singles.slice(0, limit).map(choice => <article key={choice.listingId} className="w-40 shrink-0 rounded-xl border border-white/10 bg-charcoal-900 p-2"><SmartImage src={choice.heroImage} alt={choice.title} className="aspect-[4/3] w-full rounded-lg" /><p className="mt-2 text-xs leading-5 text-white/85">{choice.title}</p><p className="mt-1 text-xs text-white/60">{formatGbp(choice.total)}</p><button disabled={busy} onClick={() => void apply(choice.listingId, undefined, true)} className="mt-3 w-full rounded-lg border border-white/15 px-2 py-2 text-xs text-white disabled:opacity-40">Add separately</button></article>)}</div>}
    {data && (data.options.length > limit || (!data.options.length && data.singles.length > limit)) && limit < 20 && <button onClick={() => setLimit(n => Math.min(20, n + 2))} className="btn-secondary mt-3 w-full py-2 text-sm">Show more replacements</button>}
    {error && <p role="alert" className="mt-3 text-sm text-red-300">{error}</p>}
  </section>;
}
