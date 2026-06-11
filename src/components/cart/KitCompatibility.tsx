"use client";

import { useEffect, useState } from "react";
import { useCart } from "@/components/cart/CartProvider";
import { IconSpark } from "@/components/icons";

export function KitCompatibility() {
  const cart = useCart();
  const [data, setData] = useState<any>(null);
  const key = cart.items.map((i) => i.listingId).join(",");

  useEffect(() => {
    if (cart.items.length < 1) { setData(null); return; }
    let cancelled = false;
    const t = setTimeout(async () => {
      try {
        const r = await fetch("/api/compat", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            items: cart.items.map((i) => ({ listingId: i.listingId, title: i.title, total: i.total, start: i.start, end: i.end })),
          }),
        });
        const d = await r.json();
        if (!cancelled) setData(d);
      } catch {
        if (!cancelled) setData(null);
      }
    }, 400);
    return () => { cancelled = true; clearTimeout(t); };
  }, [key]);

  if (!data || (!data.warnings?.length && !data.upgrades?.length)) return null;
  const tone = (l: string) =>
    l === "error" ? "border-red-400/40 bg-red-500/[0.08] text-red-200"
    : l === "warn" ? "border-amber-400/40 bg-amber-500/[0.07] text-amber-200"
    : "border-accent-400/30 bg-accent-500/[0.06] text-accent-200";

  return (
    <section className="spot mb-6 rounded-2xl p-4">
      <h3 className="flex items-center gap-2 font-display text-sm font-semibold text-white/80">
        <IconSpark className="h-4 w-4 text-accent-400" /> Kit compatibility
      </h3>
      <div className="mt-3 space-y-2">
        {data.warnings?.map((w: any, i: number) => (
          <div key={i} className={`flex gap-2 rounded-xl border px-3 py-2 text-xs ${tone(w.level)}`}>
            <span>{w.level === "error" ? "✕" : w.level === "warn" ? "!" : "ℹ"}</span>
            <span>{w.text}</span>
          </div>
        ))}
      </div>
      {data.upgrades?.length > 0 && (
        <div className="mt-3">
          <div className="mb-2 text-[11px] uppercase tracking-wide text-white/40">Suggested upgrades</div>
          <div className="flex gap-3 overflow-x-auto pb-1">
            {data.upgrades.map((u: any) => {
              const add = () =>
                cart.add({ listingId: u.listingId, slug: u.slug, title: u.title, heroImage: u.image ?? null, start: u.start, end: u.end, days: u.days, perDay: u.perDay, total: u.total, deposit: u.deposit ?? 0 });
              const isSwap = !!u.replaceListingId;
              const swap = () => {
                const hit = cart.items.find((i) => i.listingId === u.replaceListingId);
                if (hit) cart.remove(hit.key);
                add();
              };
              return (
                <div key={u.listingId} className="flex w-64 shrink-0 gap-3 rounded-xl border border-amber-400/30 bg-amber-500/[0.05] p-2">
                  {u.image && /* eslint-disable-next-line @next/next/no-img-element */ <img src={u.image} alt="" className="h-14 w-14 rounded object-cover" />}
                  <div className="min-w-0 flex-1">
                    <div className="line-clamp-2 text-xs font-medium text-white/85">{u.title}</div>
                    <div className="text-[11px] font-medium text-amber-300">{isSwap ? `+£${u.diffPerDay}/day vs your lens` : `£${u.total} · ${u.days}d`}</div>
                    <div className="line-clamp-1 text-[10px] text-white/35">{u.reason}</div>
                    <button onClick={isSwap ? swap : add} className="press mt-1 rounded-full bg-amber-400 px-3 py-1 text-[11px] font-medium text-black hover:bg-amber-300">
                      {isSwap ? "Swap to this" : "Add upgrade"}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </section>
  );
}
