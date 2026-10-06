"use client";
import { useState } from "react";
import Link from "next/link";
import { useConvex, useQuery } from "convex/react";
import { api } from "@cvx/_generated/api";
import { dayMs } from "@/lib/dates";
import { formatGbp } from "@/lib/pricing";
import { useCart, type CartItem } from "./CartProvider";

export function CartReplacements({ item }: { item: CartItem }) {
  const cart = useCart(), convex = useConvex();
  const [visible, setVisible] = useState(2);
  const args = { items: cart.items.map(i => ({ key: i.key, listingId: i.listingId as any, start: dayMs(i.start), end: dayMs(i.end) })), limit: visible + 1 };
  const choices = useQuery(api.cartReplacements.forCart, args)?.[item.key];
  const [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null);
  async function switchTo(listingId: string) {
    setBusy(true); setError(null);
    try {
      const current = await convex.query(api.cartReplacements.forCart, args);
      const choice = current[item.key]?.find(c => c.listingId === listingId);
      if (!choice) throw Error("That alternative is no longer available. Choose another option.");
      cart.switchItem(item.key, { ...choice, start: item.start, end: item.end });
    } catch (e) { setError(e instanceof Error ? e.message : "Could not switch gear. Please try again."); }
    finally { setBusy(false); }
  }
  return <div data-testid="cart-replacements" className="rounded-2xl border border-accent-400/20 bg-accent-500/[0.04] p-4" aria-busy={busy}>
    <p className="text-sm font-medium text-white/85">Available alternatives for your dates</p>
    <p className="mt-1 text-xs text-white/50">{item.start} → {item.end} · {item.days}d · dates stay selected</p>
    {choices === undefined ? <p role="status" className="mt-3 text-sm text-white/50">Checking alternatives…</p> : choices.length === 0 ? <p className="mt-3 text-sm text-white/60">No suitable replacement is available for this period. Change dates or remove this item.</p> : <div className="mt-3 flex flex-col gap-3">{choices.slice(0, visible).map((choice, index) => <div key={choice.listingId} data-testid="replacement-card" className="grid grid-cols-[56px_minmax(0,1fr)] gap-3 rounded-xl border border-white/10 bg-charcoal-900 p-3 sm:grid-cols-[64px_minmax(0,1fr)_auto]">
      <Link href={`/gear/${choice.slug}`} className="h-14 w-14 overflow-hidden rounded-lg bg-charcoal-800 sm:h-16 sm:w-16">{choice.heroImage && <img src={choice.heroImage} alt={choice.title} className="h-full w-full object-cover" />}</Link>
      <div className="min-w-0"><p className="text-[11px] text-accent-300">{index === 0 ? "Closest available match" : "Another available option"}</p><Link href={`/gear/${choice.slug}`} className="mt-1 block text-sm text-white/90">{choice.title}</Link><p className="mt-1 text-xs text-emerald-300">Available · {formatGbp(choice.total)} for {choice.days} days</p></div>
      <button type="button" disabled={busy} onClick={() => switchTo(choice.listingId)} className="btn-primary col-span-2 px-4 py-2 text-sm disabled:opacity-50 sm:col-span-1 sm:self-center" aria-label={`Switch ${item.title} to ${choice.title}`}>Switch to this</button>
    </div>)}</div>}
    {choices && choices.length > visible && <button type="button" className="btn-secondary mt-3 w-full py-2 text-sm" onClick={() => setVisible(n => Math.min(100, n + 2))}>Show more replacements</button>}
    {error && <p role="alert" className="mt-3 text-sm text-red-300">{error}</p>}
  </div>;
}
