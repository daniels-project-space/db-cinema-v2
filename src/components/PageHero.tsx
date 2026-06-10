import { Reveal } from "@/components/Reveal";

/** Consistent inner-page hero: glow accent + large headline + optional subcopy. */
export function PageHero({
  eyebrow,
  lead,
  accent,
  sub,
  center = false,
}: {
  eyebrow: string;
  lead: string;
  accent: string;
  sub?: string;
  center?: boolean;
}) {
  return (
    <div className={`relative ${center ? "text-center" : ""}`}>
      <div
        aria-hidden
        className={`pointer-events-none absolute top-[-3.5rem] z-0 h-52 w-[34rem] max-w-[88vw] rounded-full bg-accent-500/10 blur-[90px] ${center ? "left-1/2 -translate-x-1/2" : "left-[-3rem]"}`}
      />
      <div className="relative z-10">
        <Reveal>
          <div className="text-xs uppercase tracking-[0.3em] text-accent-400">{eyebrow}</div>
          <h1 className="mt-2 font-display text-4xl font-bold tracking-tight text-white/90 sm:text-5xl">
            {lead} <span className="gradient-text">{accent}</span>
          </h1>
          {sub && (
            <p className={`mt-4 max-w-xl text-balance leading-relaxed text-white/50 ${center ? "mx-auto" : ""}`}>{sub}</p>
          )}
        </Reveal>
      </div>
    </div>
  );
}
