"use client";

import { useState, useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";
import { SiteHeader } from "@/components/SiteHeader";
import { useCart } from "@/components/cart/CartProvider";
import { useAccount } from "@/components/account/AccountProvider";
import { tierByKey } from "@/lib/membership";

const SHOOTS = ["Interview", "Music video", "Documentary", "Event", "Product", "Wedding", "Other"];
const SIZES = ["Solo", "Small crew", "Large production"];

// camera-mount ↔ lens-mount compatibility
function lensFits(lensMount: string, camMounts: string[]) {
  if (camMounts.length === 0) return true;
  if (camMounts.every((m) => m === "fixed")) return false;
  return camMounts.some(
    (m) => m === "any" || lensMount === "any" || m === lensMount || (lensMount === "EF" && (m === "E" || m === "RF")),
  );
}

export default function AssemblePage() {
  const router = useRouter();
  const cart = useCart();
  const account = useAccount();
  const tier = account.me?.membershipActive ? tierByKey(account.me.membershipTier) : null;
  const memberPct = tier?.pct ?? 0;

  const [shootType, setShootType] = useState("Interview");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [budget, setBudget] = useState(600);
  const [cameras, setCameras] = useState(1);
  const [size, setSize] = useState("Small crew");
  const [note, setNote] = useState("");

  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<any>(null);
  const [stageIdx, setStageIdx] = useState(0);
  const [sel, setSel] = useState<Record<string, any>>({});
  const [err, setErr] = useState<string | null>(null);

  const selList = Object.values(sel) as any[];
  const cams = selList.filter((x) => x.role === "camera");
  const camMounts = cams.map((c) => c.mount);
  const actionOnly = camMounts.length > 0 && camMounts.every((m) => m === "fixed");

  const subtotal = selList.reduce((n, c) => n + (c.total || 0), 0);
  const memberDiscount = Math.round((subtotal * memberPct) / 100);
  const finalTotal = subtotal - memberDiscount;
  const overBudget = finalTotal > budget;

  // prune lenses that no longer fit the chosen camera(s) (e.g. switched to a GoPro)
  const camKey = cams.map((c) => `${c.listingId}:${c.mount}`).join(",");
  useEffect(() => {
    setSel((prev) => {
      const n = { ...prev };
      let changed = false;
      for (const x of Object.values(prev) as any[]) {
        if (x.role === "lens" && !lensFits(x.mount, camMounts)) {
          delete n[x.listingId];
          changed = true;
        }
      }
      return changed ? n : prev;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [camKey]);

  async function build() {
    if (!start || !end) {
      setErr("Pick your rental dates first.");
      return;
    }
    setErr(null);
    setLoading(true);
    try {
      const r = await fetch("/api/assemble", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ shootType, start, end, budget, cameras, size, note }),
      });
      const d = await r.json();
      setData(d);
      setStageIdx(0);
    } catch {
      setErr("Something went wrong — try again.");
    } finally {
      setLoading(false);
    }
  }

  function toggle(card: any, stage: any) {
    setSel((prev) => {
      const n = { ...prev };
      if (n[card.listingId]) {
        delete n[card.listingId];
        return n;
      }
      const same = (Object.values(n) as any[]).filter((x) => x.stageKey === stage.key);
      if (stage.key === "camera") {
        if (same.length >= cameras && same[0]) delete n[same[0].listingId];
      } else if (!stage.multi) {
        for (const s of same) delete n[s.listingId];
      }
      n[card.listingId] = { ...card, stageKey: stage.key };
      return n;
    });
  }

  function addAll() {
    for (const c of selList)
      cart.add({
        listingId: c.listingId, slug: c.slug, title: c.title, heroImage: c.image ?? null,
        start: c.start, end: c.end, days: c.days, perDay: c.perDay, total: c.total, deposit: c.deposit ?? 0,
      });
    router.push("/cart");
  }

  const chip = (a: boolean) =>
    `rounded-full px-4 py-1.5 text-sm transition-colors ${a ? "bg-accent-500 text-white" : "glass text-white/55 hover:text-white"}`;

  const stages = data?.stages ?? [];
  const onReview = data && stageIdx >= stages.length;
  const stage = !onReview ? stages[stageIdx] : null;

  // visible options for the current stage (lens stage = compatibility-filtered)
  const visibleOpts = useMemo(() => {
    if (!stage) return [];
    if (stage.key === "lens" && camMounts.length) return stage.options.filter((o: any) => lensFits(o.mount, camMounts));
    return stage.options;
  }, [stage, camKey]);
  const lensSkipped = stage?.key === "lens" && actionOnly;

  // compatibility warnings for the review
  const warnings = useMemo(() => {
    const w: string[] = [];
    if (cams.length === 0) w.push("No camera selected yet — add one to anchor your kit.");
    for (const l of selList.filter((x) => x.role === "lens")) {
      for (const cam of cams) {
        if (l.mount === "EF" && (cam.mount === "E" || cam.mount === "RF"))
          w.push(`${l.title.slice(0, 28)} is EF mount — we'll include an EF→${cam.mount} adapter for your ${cam.title.slice(0, 24)}.`);
      }
    }
    return w;
  }, [selList, cams]);

  return (
    <>
      <SiteHeader />
      <main className="section-window mx-auto max-w-5xl px-6 py-12 pb-32">
        <div className="mb-2 text-xs uppercase tracking-widest text-accent-400">AI item assembly</div>
        <h1 className="font-display text-4xl font-bold text-white/90">
          Build the perfect <span className="gradient-text">kit</span>
        </h1>

        {/* ── BRIEF ── */}
        {!data && (
          <section className="mt-8 rounded-3xl glass gradient-border p-6">
            <div className="grid gap-6 md:grid-cols-2">
              <div>
                <label className="text-xs uppercase tracking-wide text-white/40">Shoot type</label>
                <div className="mt-2 flex flex-wrap gap-2">
                  {SHOOTS.map((s) => <button key={s} onClick={() => setShootType(s)} className={chip(shootType === s)}>{s}</button>)}
                </div>
              </div>
              <div>
                <label className="text-xs uppercase tracking-wide text-white/40">Crew size</label>
                <div className="mt-2 flex flex-wrap gap-2">
                  {SIZES.map((s) => <button key={s} onClick={() => setSize(s)} className={chip(size === s)}>{s}</button>)}
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
                  <span>Budget</span><span className="text-accent-300">£{budget}</span>
                </label>
                <input type="range" min={100} max={3000} step={50} value={budget} onChange={(e) => setBudget(Number(e.target.value))} className="mt-2 w-full accent-accent-500" />
              </div>
              <div className="md:col-span-2">
                <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Anything else? (low light, handheld, two presenters…)" className="w-full rounded-lg bg-white/[0.05] px-4 py-2.5 text-sm text-white/80 outline-none placeholder:text-white/30" />
              </div>
            </div>
            {err && <div className="mt-3 text-sm text-red-300">{err}</div>}
            <button onClick={build} disabled={loading} className="press glow mt-5 rounded-full bg-gradient-to-r from-accent-500 to-indigo-500 px-7 py-3 font-medium text-white disabled:opacity-40">
              {loading ? "Designing your kit…" : "✨ Start building"}
            </button>
          </section>
        )}

        {/* ── STAGES ── */}
        {data && !onReview && stage && (
          <section className="mt-8">
            {/* progress */}
            <div className="mb-4 flex flex-wrap items-center gap-1.5">
              {stages.map((s: any, i: number) => (
                <button key={i} onClick={() => setStageIdx(i)} className={`h-1.5 rounded-full transition-all ${i === stageIdx ? "w-8 bg-accent-400" : i < stageIdx ? "w-4 bg-emerald-400/60" : "w-4 bg-white/15"}`} title={s.label} />
              ))}
              <span className="ml-2 text-[11px] text-white/40">Step {stageIdx + 1} of {stages.length}</span>
            </div>

            <div className="flex items-baseline gap-2">
              <h2 className="font-display text-2xl font-bold text-white/90">{stage.label}</h2>
              {stage.upsell && <span className="rounded-full bg-amber-400/20 px-2 py-0.5 text-[11px] text-amber-300">🔥 upgrade</span>}
            </div>
            {stage.note && <p className="mt-1 text-sm text-white/45">{stage.note}</p>}

            {lensSkipped ? (
              <div className="mt-6 rounded-2xl glass p-6 text-center text-sm text-white/55">
                Your action camera has a fixed lens — no interchangeable lenses needed. Skipping ahead.
              </div>
            ) : stage.key === "lens" && camMounts.length === 0 ? (
              <div className="mt-4 rounded-xl border border-amber-400/20 bg-amber-500/[0.05] p-3 text-xs text-amber-200">
                Tip: pick a camera first and we'll only show lenses that fit its mount.
              </div>
            ) : null}

            {!lensSkipped && (
              <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
                {visibleOpts.map((o: any) => {
                  const on = !!sel[o.listingId];
                  return (
                    <button key={o.listingId} onClick={() => toggle(o, stage)}
                      className={`relative overflow-hidden rounded-xl border text-left transition-all ${on ? "border-emerald-400 ring-2 ring-emerald-400/40" : "border-white/10 hover:border-white/25"}`}>
                      {on && <span className="absolute right-2 top-2 z-10 flex h-6 w-6 items-center justify-center rounded-full bg-emerald-500 text-xs text-white">✓</span>}
                      <div className="aspect-[4/3] bg-charcoal-800">
                        {o.image && /* eslint-disable-next-line @next/next/no-img-element */ <img src={o.image} alt="" className="h-full w-full object-cover" />}
                      </div>
                      <div className="p-2">
                        <div className="line-clamp-2 text-xs font-medium text-white/85">{o.title}</div>
                        <div className="mt-1 flex items-center gap-1 text-[11px] text-white/45">
                          £{o.total} · {o.days}d {o.mount && o.mount !== "any" && o.mount !== "fixed" && <span className="rounded bg-white/10 px-1 text-[9px] uppercase text-white/50">{o.mount}</span>}
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}

            <div className="mt-6 flex justify-between">
              <button onClick={() => setStageIdx((i) => Math.max(0, i - 1))} disabled={stageIdx === 0} className="rounded-full glass px-5 py-2 text-sm text-white/60 hover:text-white disabled:opacity-30">← Back</button>
              <button onClick={() => setStageIdx((i) => i + 1)} className="press rounded-full bg-accent-500 px-6 py-2 text-sm font-medium text-white hover:bg-accent-600">
                {stageIdx >= stages.length - 1 ? "Review kit →" : "Next →"}
              </button>
            </div>
          </section>
        )}

        {/* ── REVIEW ── */}
        {onReview && (
          <section className="mt-8">
            <h2 className="font-display text-2xl font-bold text-white/90">Your kit</h2>
            <p className="mt-1 text-sm text-white/45">{data.reply}</p>

            <div className="mt-5 flex flex-col gap-2">
              {selList.length === 0 && <div className="text-sm text-white/40">Nothing selected yet — go back and pick some gear.</div>}
              {selList.map((c) => (
                <div key={c.listingId} className="flex items-center gap-3 rounded-xl glass p-2">
                  {c.image && /* eslint-disable-next-line @next/next/no-img-element */ <img src={c.image} alt="" className="h-12 w-12 rounded object-cover" />}
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm text-white/85">{c.title}</div>
                    <div className="text-[11px] text-white/40">£{c.total} · {c.stageKey}</div>
                  </div>
                  <button onClick={() => setSel((p) => { const n = { ...p }; delete n[c.listingId]; return n; })} className="rounded-full px-3 py-1 text-xs text-white/35 hover:text-red-300">remove</button>
                </div>
              ))}
            </div>

            {(warnings.length > 0 || data.compatibility?.length > 0) && (
              <div className="mt-6 rounded-2xl glass p-5">
                <h3 className="font-display font-semibold text-white/80">Compatibility check</h3>
                <ul className="mt-3 space-y-1.5 text-sm text-white/55">
                  {warnings.map((w, i) => <li key={`w${i}`} className="flex gap-2"><span className="text-amber-400">!</span> {w}</li>)}
                  {(data.compatibility || []).map((n: string, i: number) => <li key={`c${i}`} className="flex gap-2"><span className="text-accent-400">✓</span> {n}</li>)}
                </ul>
              </div>
            )}

            <div className="mt-6 flex justify-between">
              <button onClick={() => setStageIdx(stages.length - 1)} className="rounded-full glass px-5 py-2 text-sm text-white/60 hover:text-white">← Back to gear</button>
            </div>
          </section>
        )}
      </main>

      {/* sticky live budget bar */}
      {data && (
        <div className="fixed inset-x-0 bottom-0 z-40 border-t border-white/10 bg-charcoal-900/95 backdrop-blur-xl">
          <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-6 py-3">
            <div className="min-w-0">
              <div className="text-sm">
                <span className="text-white/70">{selList.length} item{selList.length !== 1 ? "s" : ""} · </span>
                {memberDiscount > 0 && <span className="text-white/35 line-through">£{subtotal} </span>}
                <span className={overBudget ? "font-semibold text-red-400" : "font-semibold text-emerald-300"}>£{finalTotal}</span>
                <span className="text-white/35"> / £{budget}{memberDiscount > 0 ? ` · ${tier?.name} −${memberPct}%` : ""}</span>
                {overBudget && <span className="ml-2 text-red-400">over budget</span>}
              </div>
              <div className="mt-1 h-1.5 w-56 overflow-hidden rounded-full bg-white/10">
                <div className={`h-full transition-all ${overBudget ? "bg-red-400" : finalTotal > budget * 0.9 ? "bg-amber-400" : "bg-emerald-400"}`} style={{ width: `${Math.min(100, (finalTotal / budget) * 100)}%` }} />
              </div>
            </div>
            <button onClick={addAll} disabled={selList.length === 0} className="press shrink-0 rounded-full bg-accent-500 px-6 py-3 font-medium text-white hover:bg-accent-600 disabled:opacity-40">
              Add {selList.length || ""} to kit →
            </button>
          </div>
        </div>
      )}
    </>
  );
}
