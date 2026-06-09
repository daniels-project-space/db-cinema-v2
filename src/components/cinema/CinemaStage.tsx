"use client";

import { SCENES, TRANSITION, transitionKey, type SceneKey } from "./scenes";

/**
 * Persistent cinema video layer. One fixed element that animates between
 * fullscreen (home/done) and a top-third dock (inner pages) — so the same
 * footage "slots in" rather than the page feeling separate. Drop real clips
 * in scenes.ts and this renders <video>; until then, an animated placeholder.
 */
export function CinemaStage({
  scene,
  transitioning,
  fromScene,
}: {
  scene: SceneKey;
  transitioning: boolean;
  fromScene?: SceneKey;
}) {
  const s = SCENES[scene];
  const dock = s.layout === "dock";
  const tClip = fromScene ? TRANSITION[transitionKey(fromScene, scene)] : null;

  return (
    <div
      aria-hidden
      className={`pointer-events-none fixed left-0 right-0 top-0 z-0 overflow-hidden ${
        dock ? "h-[34vh] rounded-b-[2rem] shadow-[0_30px_80px_-20px_rgba(0,0,0,0.8)] ring-1 ring-white/5 md:h-[38vh]" : "h-[100svh]"
      }`}
      style={{ transition: "height 0.8s cubic-bezier(0.16,1,0.3,1), border-radius 0.8s cubic-bezier(0.16,1,0.3,1)" }}
    >
      {/* idle loop (or placeholder) */}
      {s.idle ? (
        <video key={scene} src={s.idle} poster={s.poster ?? undefined} muted loop autoPlay playsInline className="h-full w-full object-cover" />
      ) : (
        <Placeholder scene={scene} />
      )}

      {/* transition clip plays over the top while moving between scenes */}
      {transitioning && tClip && (
        <video key={tClip} src={tClip} muted autoPlay playsInline className="absolute inset-0 h-full w-full object-cover" />
      )}

      {/* readability scrim — stronger at the bottom of a dock so nav/text stays legible */}
      <div
        className={`absolute inset-0 bg-gradient-to-b ${
          dock ? "from-black/10 via-transparent to-charcoal-950" : "from-charcoal-950/40 via-transparent to-charcoal-950/80"
        }`}
      />

      {/* soft crossfade veil during the cut, hides any frame mismatch */}
      <div
        className={`absolute inset-0 bg-charcoal-950 transition-opacity duration-300 ${transitioning ? "opacity-40" : "opacity-0"}`}
      />
    </div>
  );
}

function Placeholder({ scene }: { scene: SceneKey }) {
  const s = SCENES[scene];
  return (
    <div className={`relative h-full w-full bg-gradient-to-br ${s.tint}`}>
      <div className="cinema-pan absolute inset-0 opacity-40 [background:radial-gradient(60%_50%_at_50%_30%,rgba(255,255,255,0.18),transparent_70%)]" />
      <div className="cinema-grain absolute inset-0 opacity-[0.06]" />
      <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 px-6 text-center">
        <span className="rounded-full border border-white/15 px-3 py-1 text-[10px] uppercase tracking-[0.2em] text-white/45">▶ Higgsfield clip</span>
        <span className="max-w-md font-display text-xl font-semibold text-white/85">{s.label}</span>
        <span className="max-w-sm text-xs leading-relaxed text-white/40">{s.hint}</span>
        <span className="mt-1 text-[10px] text-white/25">placeholder — set scenes.ts → idle</span>
      </div>
    </div>
  );
}
