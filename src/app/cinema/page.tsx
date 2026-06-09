"use client";

import { useState } from "react";
import { CinemaStage } from "@/components/cinema/CinemaStage";
import { SCENES, FLOW, type SceneKey } from "@/components/cinema/scenes";

// Self-contained demo of the seamless video-to-video experience.
// Proves the mechanics (fullscreen → top dock, checkout overlay, scene stepper)
// with placeholders; real wiring just swaps state changes for route changes.
export default function CinemaDemo() {
  const [scene, setScene] = useState<SceneKey>("home");
  const [from, setFrom] = useState<SceneKey | undefined>(undefined);
  const [transitioning, setTransitioning] = useState(false);
  const dock = SCENES[scene].layout === "dock";

  function go(target: SceneKey) {
    if (target === scene || transitioning) return;
    setFrom(scene);
    setTransitioning(true);
    // simulates the transition clip running; real version waits for video.ended
    window.setTimeout(() => setScene(target), 380);
    window.setTimeout(() => setTransitioning(false), 820);
  }

  return (
    <div className="relative min-h-[100svh] overflow-hidden bg-charcoal-950 text-white">
      <CinemaStage scene={scene} transitioning={transitioning} fromScene={from} />

      {/* CONTENT — overlays the fullscreen scenes, sits below the docked ones */}
      <div
        className="relative z-10"
        style={{ paddingTop: dock ? "36vh" : "0", transition: "padding-top 0.8s cubic-bezier(0.16,1,0.3,1)" }}
      >
        {scene === "home" && <Home onEnter={() => go("gear")} />}
        {scene === "gear" && <Panel title="Browse gear" go={go} next="assembly" nextLabel="Build a kit →" />}
        {scene === "assembly" && <Panel title="AI item assembly" go={go} next="checkout" nextLabel="Proceed to checkout →" assembly />}
        {scene === "done" && <Done onRestart={() => go("home")} />}
      </div>

      {/* CHECKOUT — overlay (Stripe embedded checkout mounts here, no redirect) */}
      {scene === "checkout" && <CheckoutOverlay onPaid={() => go("done")} onBack={() => go("assembly")} />}

      {/* scene stepper — the "3D space" map */}
      <SceneNav scene={scene} go={go} transitioning={transitioning} />
    </div>
  );
}

function Home({ onEnter }: { onEnter: () => void }) {
  return (
    <div className="flex min-h-[100svh] flex-col items-center justify-center px-6 text-center">
      <div className="mb-3 text-xs uppercase tracking-[0.3em] text-white/50">London cinema rental</div>
      <h1 className="font-display text-5xl font-bold md:text-7xl">
        <span className="gradient-text">db cinema</span> rentals
      </h1>
      <p className="mt-4 max-w-md text-white/55">Pro film gear, professionally kept. Step into the studio.</p>
      <button onClick={onEnter} className="press glow mt-8 rounded-full bg-gradient-to-r from-accent-500 to-indigo-500 px-8 py-3.5 font-medium text-white">
        Enter the studio →
      </button>
    </div>
  );
}

function Panel({
  title,
  go,
  next,
  nextLabel,
  assembly,
}: {
  title: string;
  go: (s: SceneKey) => void;
  next: SceneKey;
  nextLabel: string;
  assembly?: boolean;
}) {
  return (
    <div className="mx-auto max-w-5xl px-6 pb-28 pt-6">
      <div className="rounded-3xl border border-white/10 bg-charcoal-900/80 p-6 backdrop-blur-xl">
        <h2 className="font-display text-2xl font-bold text-white/90">{title}</h2>
        <p className="mt-1 text-sm text-white/45">
          {assembly ? "The assistant walks you through the build — video docked above stays in the same space." : "Content lives here on a translucent panel; the studio footage stays docked up top."}
        </p>
        <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="aspect-[4/3] rounded-xl border border-white/10 bg-white/[0.03]" />
          ))}
        </div>
        <button onClick={() => go(next)} className="press mt-6 rounded-full bg-accent-500 px-6 py-3 font-medium text-white hover:bg-accent-600">
          {nextLabel}
        </button>
      </div>
    </div>
  );
}

function CheckoutOverlay({ onPaid, onBack }: { onPaid: () => void; onBack: () => void }) {
  const [paying, setPaying] = useState(false);
  return (
    <div className="fixed inset-0 z-30 flex items-end justify-center sm:items-center">
      <div className="absolute inset-0 bg-charcoal-950/60 backdrop-blur-sm" onClick={onBack} />
      <div className="toast-in relative z-10 m-4 w-full max-w-md rounded-3xl border border-white/10 bg-charcoal-900/95 p-6 shadow-2xl">
        <h3 className="font-display text-xl font-bold text-white/90">Secure checkout</h3>
        <p className="mt-1 text-xs text-white/45">Stripe Embedded Checkout mounts here — no redirect, the counter footage keeps playing behind.</p>
        <div className="mt-4 grid h-44 place-items-center rounded-xl border border-dashed border-white/15 bg-white/[0.02] text-center text-xs text-white/35">
          {paying ? (
            <div className="flex flex-col items-center gap-2">
              <div className="h-6 w-6 animate-spin rounded-full border-2 border-white/20 border-t-accent-400" />
              processing…
            </div>
          ) : (
            <span>[ Stripe embedded payment form ]</span>
          )}
        </div>
        <div className="mt-5 flex gap-2">
          <button onClick={onBack} className="rounded-full glass px-5 py-2.5 text-sm text-white/60 hover:text-white">← Back</button>
          <button
            onClick={() => { setPaying(true); window.setTimeout(onPaid, 1400); }}
            disabled={paying}
            className="press flex-1 rounded-full bg-emerald-500 px-6 py-2.5 font-medium text-white hover:bg-emerald-600 disabled:opacity-50"
          >
            {paying ? "Processing…" : "Pay (test) →"}
          </button>
        </div>
      </div>
    </div>
  );
}

function Done({ onRestart }: { onRestart: () => void }) {
  return (
    <div className="flex min-h-[100svh] flex-col items-center justify-center px-6 text-center">
      <div className="text-5xl">🎬</div>
      <h1 className="mt-4 font-display text-4xl font-bold text-white/90">Approved — enjoy the shoot</h1>
      <p className="mt-3 max-w-sm text-white/55">Box + gear bags in hand, out the door. Your kit is booked.</p>
      <button onClick={onRestart} className="press mt-8 rounded-full glass px-7 py-3 text-white/70 hover:text-white">↻ Replay the journey</button>
    </div>
  );
}

function SceneNav({ scene, go, transitioning }: { scene: SceneKey; go: (s: SceneKey) => void; transitioning: boolean }) {
  return (
    <div className="fixed bottom-4 left-1/2 z-40 -translate-x-1/2">
      <div className="flex items-center gap-1 rounded-full border border-white/10 bg-charcoal-900/80 px-2 py-1.5 backdrop-blur-xl">
        {FLOW.map((k) => {
          const on = k === scene;
          return (
            <button
              key={k}
              onClick={() => go(k)}
              disabled={transitioning}
              className={`rounded-full px-3 py-1 text-[11px] capitalize transition-colors ${on ? "bg-accent-500 text-white" : "text-white/45 hover:text-white"}`}
            >
              {k}
            </button>
          );
        })}
      </div>
    </div>
  );
}
