"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { SiteHeader } from "@/components/SiteHeader";
import { useCart } from "@/components/cart/CartProvider";
import { Reveal } from "@/components/Reveal";

const SHOOTS = ["Interview", "Music video", "Documentary", "Event", "Product", "Wedding", "Other"];
const SIZES = ["Solo", "Small crew", "Large production"];

export default function AssemblePage() {
  const router = useRouter();
  const cart = useCart();

  const [shootType, setShootType] = useState("Interview");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [budget, setBudget] = useState(500);
  const [cameras, setCameras] = useState(1);
  const [size, setSize] = useState("Small crew");
  const [note, setNote] = useState("");

  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<any>(null);
  const [sel, setSel] = useState<Record<string, any>>({});
  const [err, setErr] = useState<string | null>(null);

  const selList = Object.values(sel);
  const total = selList.reduce((n, c: any) => n + (c.total || 0), 0);
  const overBudget = total > budget;

  async function build() {
    if (!start || !end) {
      setErr("Pick your rental dates first.");
      return;
    }
    setErr(null);
    setLoading(true);
    setData(null);
    try {
      const r = await fetch("/api/assemble", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ shootType, start, end, budget, cameras, size, note }),
      });
      setData(await r.json());
    } catch {
      setErr("Something went wrong — try again.");
    } finally {
      setLoading(false);
    }
  }

  function toggle(card: any) {
    setSel((s) => {
      const n = { ...s };
      if (n[card.listingId]) delete n[card.listingId];
      else n[card.listingId] = card;
      return n;
    });
  }

  function addAll() {
    for (const c of selList as any[])
      cart.add({
        listingId: c.listingId,
        slug: c.slug,
        title: c.title,
        heroImage: c.image ?? null,
        start: c.start,
        end: c.end,
        days: c.days,
        perDay: c.perDay,
        total: c.total,
        deposit: c.deposit ?? 0,
      });
    router.push("/cart");
  }

  const chip = (active: boolean) =>
    `rounded-full px-4 py-1.5 text-sm transition-colors ${active ? "bg-accent-500 text-white" : "glass text-white/55 hover:text-white"}`;

  return (
    <>
      <SiteHeader />
      <main className="section-window mx-auto max-w-5xl px-6 py-12 pb-28">
        <div className="mb-2 text-xs uppercase tracking-widest text-accent-400">AI item assembly</div>
        <h1 className="font-display text-4xl font-bold text-white/90">
          Build the perfect <span className="gradient-text">kit</span>
        </h1>
        <p className="mt-2 max-w-xl text-white/40">
          Tell us about your shoot and budget — we'll assemble an available, compatible kit you can fine-tune and book.
        </p>

        {/* brief controls */}
        <section className="mt-8 rounded-3xl glass gradient-border p-6">
          <div className="grid gap-6 md:grid-cols-2">
            <div>
              <label className="text-xs uppercase tracking-wide text-white/40">Shoot type</label>
              <div className="mt-2 flex flex-wrap gap-2">
                {SHOOTS.map((s) => (
                  <button key={s} onClick={() => setShootType(s)} className={chip(shootType === s)}>{s}</button>
                ))}
              </div>
            </div>
            <div>
              <label className="text-xs uppercase tracking-wide text-white/40">Crew size</label>
              <div className="mt-2 flex flex-wrap gap-2">
                {SIZES.map((s) => (
                  <button key={s} onClick={() => setSize(s)} className={chip(size === s)}>{s}</button>
                ))}
              </div>
            </div>
            <div className="flex gap-4">
              <div className="flex-1">
                <label className="text-xs uppercase tracking-wide text-white/40">From</label>
                <input type="date" value={start} onChange={(e) => setStart(e.target.value)} className="mt-2 w-full rounded-lg bg-white/[0.05] px-3 py-2 text-sm text-white/80 outline-none [color-scheme:dark]" />
              </div>
              <div className="flex-1">
                <label className="text-xs uppercase tracking-wide text-white/40">To</label>
                <input type="date" value={end} onChange={(e) => setEnd(e.target.value)} className="mt-2 w-full rounded-lg bg-white/[0.05] px-3 py-2 text-sm text-white/80 outline-none [color-scheme:dark]" />
              </div>
            </div>
            <div>
              <label className="text-xs uppercase tracking-wide text-white/40">Cameras needed</label>
              <div className="mt-2 flex items-center gap-3">
                <button onClick={() => setCameras((n) => Math.max(1, n - 1))} className="h-9 w-9 rounded-full glass text-white/70">–</button>
                <span className="w-8 text-center font-display text-lg text-white/90">{cameras}</span>
                <button onClick={() => setCameras((n) => Math.min(6, n + 1))} className="h-9 w-9 rounded-full glass text-white/70">+</button>
              </div>
            </div>
            <div className="md:col-span-2">
              <label className="flex justify-between text-xs uppercase tracking-wide text-white/40">
                <span>Budget</span>
                <span className="text-accent-300">£{budget}</span>
              </label>
              <input type="range" min={100} max={3000} step={50} value={budget} onChange={(e) => setBudget(Number(e.target.value))} className="mt-2 w-full accent-accent-500" />
            </div>
            <div className="md:col-span-2">
              <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Anything else? (e.g. low light, handheld, two presenters)" className="w-full rounded-lg bg-white/[0.05] px-4 py-2.5 text-sm text-white/80 outline-none placeholder:text-white/30" />
            </div>
          </div>
          {err && <div className="mt-3 text-sm text-red-300">{err}</div>}
          <button onClick={build} disabled={loading} className="press mt-5 rounded-full bg-accent-500 px-7 py-3 font-medium text-white hover:bg-accent-600 disabled:opacity-40">
            {loading ? "Designing your kit…" : "✨ Build my kit"}
          </button>
        </section>

        {/* result */}
        {data && (
          <div className="mt-10">
            <Reveal>
              <p className="text-white/70">{data.reply}</p>
            </Reveal>
            {data.sections?.map((sec: any, i: number) => (
              <Reveal key={i} delay={i * 40}>
                <section className={`mt-7 rounded-2xl p-4 ${sec.upsell ? "border border-amber-400/30 bg-amber-500/[0.05]" : ""}`}>
                  <div className="flex items-baseline gap-2">
                    <h3 className="font-display text-lg font-semibold text-white/85">{sec.label}</h3>
                    {sec.upsell && <span className="rounded-full bg-amber-400/20 px-2 py-0.5 text-[11px] text-amber-300">🔥 upgrade</span>}
                  </div>
                  {sec.note && <p className="mt-0.5 text-sm text-white/40">{sec.note}</p>}
                  <div className="mt-3 flex gap-3 overflow-x-auto pb-2">
                    {sec.options.map((o: any) => {
                      const on = !!sel[o.listingId];
                      return (
                        <button
                          key={o.listingId}
                          onClick={() => toggle(o)}
                          className={`relative w-40 shrink-0 overflow-hidden rounded-xl border text-left transition-all ${on ? "border-emerald-400 ring-2 ring-emerald-400/40" : "border-white/10 hover:border-white/25"}`}
                        >
                          {on && <span className="absolute right-2 top-2 z-10 flex h-6 w-6 items-center justify-center rounded-full bg-emerald-500 text-xs text-white">✓</span>}
                          <div className="aspect-[4/3] bg-charcoal-800">
                            {o.image && /* eslint-disable-next-line @next/next/no-img-element */ (
                              <img src={o.image} alt="" className="h-full w-full object-cover" />
                            )}
                          </div>
                          <div className="p-2">
                            <div className="line-clamp-2 text-xs font-medium text-white/85">{o.title}</div>
                            <div className="mt-1 text-[11px] text-white/45">£{o.total} · {o.days}d</div>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </section>
              </Reveal>
            ))}

            {data.compatibility?.length > 0 && (
              <section className="mt-8 rounded-2xl glass p-5">
                <h3 className="font-display font-semibold text-white/80">Compatibility &amp; notes</h3>
                <ul className="mt-3 space-y-1.5 text-sm text-white/55">
                  {data.compatibility.map((n: string, i: number) => (
                    <li key={i} className="flex gap-2"><span className="text-accent-400">✓</span> {n}</li>
                  ))}
                </ul>
              </section>
            )}
          </div>
        )}
      </main>

      {/* sticky kit summary */}
      {selList.length > 0 && (
        <div className="fixed inset-x-0 bottom-0 z-40 border-t border-white/10 bg-charcoal-900/95 backdrop-blur-xl">
          <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-6 py-3">
            <div className="min-w-0">
              <div className="text-sm text-white/80">
                {selList.length} item{selList.length > 1 ? "s" : ""} · <span className={overBudget ? "text-red-300" : "text-emerald-300"}>£{total}</span>
                <span className="text-white/35"> / £{budget} budget</span>
              </div>
              <div className="mt-1 h-1.5 w-48 overflow-hidden rounded-full bg-white/10">
                <div className={`h-full ${overBudget ? "bg-red-400" : total > budget * 0.9 ? "bg-amber-400" : "bg-emerald-400"}`} style={{ width: `${Math.min(100, (total / budget) * 100)}%` }} />
              </div>
            </div>
            <button onClick={addAll} className="press shrink-0 rounded-full bg-accent-500 px-6 py-3 font-medium text-white hover:bg-accent-600">
              Add {selList.length} to kit →
            </button>
          </div>
        </div>
      )}
    </>
  );
}
