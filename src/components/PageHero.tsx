/** Consistent inner-page hero: HUD eyebrow + display headline with a
 * serif-italic accent word + optional subcopy, over a soft glow. */
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
      <div className="page-in relative z-10">
        <div className={`flex items-center gap-3 ${center ? "justify-center" : ""}`}>
          <span className="hidden h-px w-8 bg-accent-400/60 sm:block" aria-hidden />
          <span className="hud-label !text-accent-400/90">{eyebrow}</span>
        </div>
        <h1 className="mt-3 font-display text-4xl font-bold tracking-tight text-white sm:text-6xl">
          {lead}{" "}
          <span className="serif-accent gradient-text pr-1 text-[1.06em]">{accent}</span>
        </h1>
        {sub && (
          <p className={`mt-4 max-w-xl text-balance leading-relaxed text-white/50 ${center ? "mx-auto" : ""}`}>
            {sub}
          </p>
        )}
      </div>
    </div>
  );
}
