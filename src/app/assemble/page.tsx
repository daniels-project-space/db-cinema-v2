"use client";

import { useState, useEffect, useMemo, useRef } from "react";
import { IconSliders, IconBolt, IconCheck, IconX, IconChevronLeft, IconArrowRight } from "@/components/icons";
import { BotAvatarBadge, type BotMood } from "@/components/chat/BotAvatar";
import { Stream, TypingIndicator } from "@/components/chat/ChatKit";
import { useRouter } from "next/navigation";
import { SiteHeader } from "@/components/SiteHeader";
import { useCart } from "@/components/cart/CartProvider";
import { useAccount } from "@/components/account/AccountProvider";
import { tierByKey } from "@/lib/membership";

const SHOOTS = ["Interview", "Music video", "Documentary", "Event", "Product", "Wedding", "Other"];
const SIZES = ["Solo", "Small crew", "Large production"];
const FOCAL_THREAD: Record<string, number> = { "28-70": 67, "24-70": 82, "16-35": 72, "24-105": 77, "70-200": 77 };

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
  const [intake, setIntake] = useState(0); // conversational onboarding step
  const endRef = useRef<HTMLDivElement>(null);

  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<any>(null);
  const [stageIdx, setStageIdx] = useState(0);
  const [sel, setSel] = useState<Record<string, any>>({});
  const [err, setErr] = useState<string | null>(null);

  const selList = Object.values(sel) as any[];
  const cams = selList.filter((x) => x.role === "camera");
  const camMounts = cams.map((c) => c.mount);
  const actionOnly = camMounts.length > 0 && camMounts.every((m) => m === "fixed");
  const camBatts = cams.map((c) => c.specs?.batteryType).filter(Boolean);
  const camIncludesLens = cams.some((c) => c.specs?.includesLens);
  const battOk = (cb: string, x: string) => cb === x || cb.includes(x) || x.includes(cb);
  const lensThreads = [
    ...selList.filter((x) => x.role === "lens").map((x) => x.specs?.filterThreadMm).filter(Boolean),
    ...cams.filter((c) => c.specs?.includesLens && c.specs?.lensFocal && FOCAL_THREAD[c.specs.lensFocal]).map((c) => FOCAL_THREAD[c.specs.lensFocal]),
  ];

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

  // keep the conversation scrolled to the newest message/stage
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [intake, stageIdx, data]);

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

  // per-stage compatibility-filtered options (works for any stage, not just current)
  const visibleFor = (s: any): any[] => {
    if (!s) return [];
    if (s.key === "lens" && camMounts.length) return s.options.filter((o: any) => lensFits(o.mount, camMounts));
    if (s.key === "nd-filter" && lensThreads.length) return s.options.filter((o: any) => !o.specs?.filterThreadMm || lensThreads.includes(o.specs.filterThreadMm));
    if (s.key === "battery" && camBatts.length) return s.options.filter((o: any) => !o.specs?.batteryType || camBatts.some((cb: string) => battOk(cb, o.specs.batteryType)));
    return s.options;
  };
  const skipped = (s: any) => s?.key === "lens" && actionOnly;

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
        <div className="page-in">
          <div className="flex items-center gap-3">
            <span className="hidden h-px w-8 bg-accent-400/60 sm:block" aria-hidden />
            <span className="hud-label !text-accent-400/90">AI item assembly</span>
          </div>
          <div className="mt-3 flex items-center gap-4">
            <BotAvatarBadge mood={loading ? "thinking" : "idle"} size={52} className="hidden sm:flex" />
            <h1 className="font-display text-4xl font-bold tracking-tight text-white sm:text-5xl">
              Build the perfect <span className="serif-accent gradient-text text-[1.06em]">kit</span>
            </h1>
          </div>
          <p className="mt-2 text-sm text-white/40">
            <span className="font-medium text-white/60">Gaffer</span> picks compatible gear for your shoot, priced
            for your dates — you approve every item.
          </p>
        </div>

        {/* ── CONVERSATIONAL ONBOARDING ── */}
        {!data && (
          <section className="mt-8 space-y-3">
            <Ai>Hi! I'm your kit builder. Let's start — what are you shooting?</Ai>
            {intake === 0 ? (
              <Controls>
                {SHOOTS.map((s) => (
                  <button key={s} onClick={() => { setShootType(s); setIntake(1); }} className={chip(false)}>{s}</button>
                ))}
              </Controls>
            ) : (
              <UserMsg>{shootType}</UserMsg>
            )}

            {intake >= 1 && <Ai>Nice — how big is the crew?</Ai>}
            {intake === 1 ? (
              <Controls>
                {SIZES.map((s) => (
                  <button key={s} onClick={() => { setSize(s); setIntake(2); }} className={chip(false)}>{s}</button>
                ))}
              </Controls>
            ) : intake > 1 ? (
              <UserMsg>{size}</UserMsg>
            ) : null}

            {intake >= 2 && <Ai>When do you need the gear?</Ai>}
            {intake === 2 ? (
              <Controls>
                <div className="flex flex-wrap items-end gap-3">
                  <div>
                    <label className="text-[11px] text-white/40">From</label>
                    <input type="date" value={start} onChange={(e) => setStart(e.target.value)} className="mt-1 block rounded-lg bg-white/[0.06] px-3 py-2 text-sm text-white/80 outline-none [color-scheme:dark]" />
                  </div>
                  <div>
                    <label className="text-[11px] text-white/40">To</label>
                    <input type="date" value={end} onChange={(e) => setEnd(e.target.value)} className="mt-1 block rounded-lg bg-white/[0.06] px-3 py-2 text-sm text-white/80 outline-none [color-scheme:dark]" />
                  </div>
                  <button onClick={() => start && end && setIntake(3)} disabled={!start || !end} className="btn-primary px-5 py-2 text-sm">Next →</button>
                </div>
              </Controls>
            ) : intake > 2 ? (
              <UserMsg>{start} → {end}</UserMsg>
            ) : null}

            {intake >= 3 && <Ai>Last bit — your budget, how many cameras, and anything else I should know?</Ai>}
            {intake >= 3 && (
              <Controls>
                <div className="space-y-4">
                  <div>
                    <label className="flex justify-between text-[11px] text-white/40"><span>Budget</span><span className="text-accent-300">£{budget}</span></label>
                    <input type="range" min={100} max={3000} step={50} value={budget} onChange={(e) => setBudget(Number(e.target.value))} className="mt-1 w-full accent-accent-500" />
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-[11px] text-white/40">Cameras</span>
                    <button onClick={() => setCameras((n) => Math.max(1, n - 1))} className="h-8 w-8 rounded-full glass text-white/70">–</button>
                    <span className="w-6 text-center font-display text-white/90">{cameras}</span>
                    <button onClick={() => setCameras((n) => Math.min(6, n + 1))} className="h-8 w-8 rounded-full glass text-white/70">+</button>
                  </div>
                  <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. low light, handheld, two presenters…" className="w-full rounded-lg bg-white/[0.06] px-4 py-2.5 text-sm text-white/80 outline-none placeholder:text-white/30" />
                  {err && <div className="text-sm text-red-300">{err}</div>}
                  <button onClick={build} disabled={loading} className="btn-primary px-7 py-3">
                    <IconSliders className="h-[18px] w-[18px]" />
                    {loading ? "Designing your kit…" : "Build my kit"}
                  </button>
                </div>
              </Controls>
            )}
            {loading && <TypingIndicator label="designing your kit…" />}
          </section>
        )}

        {/* ── BOT-DRIVEN BUILD THREAD ── */}
        {data && (
          <section className="mt-6 space-y-4">
            <div className="flex flex-wrap items-center gap-1.5 pl-12">
              {stages.map((s: any, i: number) => (
                <button
                  key={i}
                  onClick={() => i <= stageIdx && setStageIdx(i)}
                  aria-label={`Step ${i + 1}: ${s.label}`}
                  className={`h-1.5 rounded-full transition-all duration-500 ${
                    i === stageIdx && !onReview
                      ? "accent-glow w-9 bg-accent-400"
                      : i < stageIdx || onReview
                        ? "w-4 bg-emerald-400/60 hover:bg-emerald-400"
                        : "w-4 bg-white/15"
                  }`}
                  title={s.label}
                />
              ))}
              <span className="ml-2 font-mono text-[10px] uppercase tracking-[0.14em] text-white/40">
                {onReview ? "Review" : `Step ${stageIdx + 1} / ${stages.length}`}
              </span>
            </div>

            <Ai mood="talking"><Stream text={data.reply || "Let's build your kit."} /></Ai>

            {stages.slice(0, onReview ? stages.length : stageIdx + 1).map((s: any, si: number) => {
              const opts = visibleFor(s);
              const isSkip = skipped(s);
              return (
                <div key={si} className="stage-in space-y-2">
                  <div className="msg-left flex items-start gap-3">
                    <BotAvatarBadge mood={si === stageIdx && !onReview ? "talking" : "idle"} size={34} />
                    <div className="rounded-2xl rounded-tl-md border border-white/[0.07] bg-white/[0.045] px-4 py-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-display font-semibold text-white/90">{s.label}</span>
                        {s.upsell && <span className="inline-flex items-center gap-1 rounded-full bg-amber-400/15 px-2 py-0.5 text-[11px] text-amber-300"><IconBolt className="h-3 w-3" />upgrade</span>}
                      </div>
                      {s.note && <p className="mt-1 text-sm leading-relaxed text-white/60"><Stream text={s.note} /></p>}
                      {s.key === "lens" && camIncludesLens && !isSkip && <p className="mt-1 text-xs text-amber-300">Your camera already includes a lens — these are optional extras/upgrades.</p>}
                    </div>
                  </div>

                  {isSkip ? (
                    <div className="pl-12 text-sm text-white/50">Action camera has a fixed lens — skipping ahead.</div>
                  ) : (
                    <div className="flex gap-3 overflow-x-auto pb-2 pl-12">
                      {[...opts].sort((a: any, b: any) => (a.listingId === s.recommendedId ? -1 : 0) - (b.listingId === s.recommendedId ? -1 : 0)).map((o: any, i: number) => {
                        const on = !!sel[o.listingId];
                        const rec = o.listingId === s.recommendedId;
                        return (
                          <button key={o.listingId} onClick={() => toggle(o, s)} style={{ animationDelay: `${Math.min(i, 10) * 55}ms` }} className={`card-in lift relative w-40 shrink-0 overflow-hidden rounded-xl border text-left transition-all ${on ? "border-emerald-400 ring-2 ring-emerald-400/40" : rec ? "border-amber-400/70 ring-2 ring-amber-400/30" : "border-white/10 hover:border-white/25"}`}>
                            {rec && !on && <span className="absolute left-2 top-2 z-10 rounded-full bg-amber-400 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-black">Pick</span>}
                            {on && <span className="absolute right-2 top-2 z-10 flex h-6 w-6 items-center justify-center rounded-full bg-emerald-500 text-white"><IconCheck className="h-3 w-3" /></span>}
                            <div className="aspect-[4/3] bg-charcoal-800">
                              {o.image && /* eslint-disable-next-line @next/next/no-img-element */ <img src={o.image} alt="" className="h-full w-full object-cover" />}
                            </div>
                            <div className="p-2">
                              <div className="line-clamp-2 text-xs font-medium text-white/85">{o.title}</div>
                              <div className="mt-1 text-[11px] text-white/45">£{o.total} · {o.days}d {o.mount && o.mount !== "any" && o.mount !== "fixed" && <span className="rounded bg-white/10 px-1 text-[9px] uppercase text-white/50">{o.mount}</span>}</div>
                              {o.tip && <div className="mt-1 line-clamp-2 text-[10px] leading-snug text-white/35">{o.tip}</div>}
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}

            {!onReview ? (
              <div className="flex justify-between pl-12">
                <button onClick={() => setStageIdx((i) => Math.max(0, i - 1))} disabled={stageIdx === 0} className="btn-ghost px-5 py-2 text-sm">
                  <IconChevronLeft className="h-4 w-4" /> Back
                </button>
                <button onClick={() => setStageIdx((i) => i + 1)} className="btn-primary px-6 py-2 text-sm">
                  {stageIdx >= stages.length - 1 ? "Review kit" : "Next"} <IconArrowRight className="h-4 w-4" />
                </button>
              </div>
            ) : (
              <div className="stage-in space-y-3">
                <Ai mood="talking"><Stream text="Here's your kit — check it over, then add it to your basket." /></Ai>
                <div className="flex flex-col gap-2 pl-12">
                  {selList.length === 0 && <div className="text-sm text-white/40">Nothing selected yet — scroll up and pick some gear.</div>}
                  {selList.map((c) => (
                    <div key={c.listingId} className="flex items-center gap-3 rounded-xl glass p-2">
                      {c.image && /* eslint-disable-next-line @next/next/no-img-element */ <img src={c.image} alt="" className="h-12 w-12 rounded object-cover" />}
                      <div className="min-w-0 flex-1"><div className="truncate text-sm text-white/85">{c.title}</div><div className="text-[11px] text-white/40">£{c.total} · {c.stageKey}</div></div>
                      <button onClick={() => setSel((p) => { const n = { ...p }; delete n[c.listingId]; return n; })} className="rounded-full px-3 py-1 text-xs text-white/35 hover:text-red-300">remove</button>
                    </div>
                  ))}
                </div>
                {(warnings.length > 0 || data.compatibility?.length > 0) && (
                  <div className="ml-12 rounded-2xl glass p-5">
                    <h3 className="font-display font-semibold text-white/80">Compatibility check</h3>
                    <ul className="mt-3 space-y-1.5 text-sm text-white/55">
                      {warnings.map((w, i) => <li key={`w${i}`} className="flex gap-2"><span className="text-amber-400">!</span> {w}</li>)}
                      {(data.compatibility || []).map((n: string, i: number) => <li key={`c${i}`} className="flex gap-2"><IconCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-accent-400" /> {n}</li>)}
                    </ul>
                  </div>
                )}
                <div className="pl-12"><button onClick={() => setStageIdx(stages.length - 1)} className="btn-ghost px-5 py-2 text-sm"><IconChevronLeft className="h-4 w-4" /> Back to gear</button></div>
              </div>
            )}
            <div ref={endRef} />
          </section>
        )}

      </main>

      {/* sticky live budget bar */}
      {data && (
        <div className="fixed inset-x-0 bottom-0 z-40 border-t border-white/10 bg-charcoal-900/95 backdrop-blur-xl">
          <div className="mx-auto max-w-5xl px-6 py-3">
            {selList.length > 0 && (
              <div className="mb-2 flex gap-2 overflow-x-auto pb-1">
                {selList.map((c) => (
                  <div key={c.listingId} className="flex shrink-0 items-center gap-2 rounded-full bg-white/[0.06] py-1 pl-1 pr-2 ring-1 ring-emerald-400/20">
                    {c.image && /* eslint-disable-next-line @next/next/no-img-element */ <img src={c.image} alt="" className="h-7 w-7 rounded-full object-cover" />}
                    <span className="max-w-[130px] truncate text-xs text-white/75">{c.title}</span>
                    <button
                      onClick={() => setSel((p) => { const n = { ...p }; delete n[c.listingId]; return n; })}
                      className="flex h-4 w-4 items-center justify-center rounded-full bg-white/10 text-[10px] text-white/50 hover:bg-red-500/40 hover:text-white"
                      aria-label="Remove"
                    >
                      <IconX className="h-2.5 w-2.5" />
                    </button>
                  </div>
                ))}
              </div>
            )}
            <div className="flex items-center justify-between gap-4">
              <div className="min-w-0">
                <div className="text-sm">
                  <span className="text-white/70">{selList.length} item{selList.length !== 1 ? "s" : ""} · </span>
                  {memberDiscount > 0 && <span className="text-white/35 line-through">£{subtotal} </span>}
                  <span className={overBudget ? "font-semibold text-red-400" : "font-semibold text-emerald-300"}>£{finalTotal}</span>
                  <span className="text-white/35"> / £{budget}{memberDiscount > 0 ? ` · ${tier?.name} −${memberPct}%` : ""}</span>
                  {overBudget && <span className="ml-2 text-red-400">over budget</span>}
                </div>
                <div className={`mt-1 h-1.5 w-56 overflow-hidden rounded-full bg-white/10 ${overBudget ? "budget-over" : ""}`}>
                  <div
                    className={`budget-fill h-full w-full rounded-full ${overBudget ? "bg-red-400" : finalTotal > budget * 0.9 ? "bg-amber-400" : "bg-emerald-400"}`}
                    style={{ transform: `scaleX(${Math.min(1, finalTotal / budget)})` }}
                  />
                </div>
              </div>
              <button onClick={addAll} disabled={selList.length === 0} className="btn-primary shrink-0 px-6 py-3">
                Add {selList.length || ""} to kit
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function Ai({ children, mood = "idle" as BotMood }: { children: React.ReactNode; mood?: BotMood }) {
  return (
    <div className="msg-left flex items-end gap-3">
      <BotAvatarBadge mood={mood} size={34} className="mb-0.5" />
      <div className="max-w-[80%] rounded-2xl rounded-bl-md border border-white/[0.07] bg-white/[0.045] px-4 py-2.5 text-sm leading-relaxed text-white/80">
        {children}
      </div>
    </div>
  );
}
function UserMsg({ children }: { children: React.ReactNode }) {
  return (
    <div className="msg-right flex justify-end">
      <div className="rounded-2xl rounded-br-md bg-gradient-to-br from-accent-500 to-accent-600 px-4 py-2 text-sm text-white shadow-[0_6px_20px_-8px_color-mix(in_srgb,var(--color-accent-500)_70%,transparent)]">
        {children}
      </div>
    </div>
  );
}
function Controls({ children }: { children: React.ReactNode }) {
  return <div className="chip-in pl-12">{children}</div>;
}
