import { LoopingBannerVideo } from "./LoopingBannerVideo";

export function GearLoopBanner({
  eyebrow = "The catalogue",
  lead = "Rent",
  accent = "cinema gear",
  sub = "Professional cameras, lenses, lighting, audio and more. Delivered across London.",
  motion = false,
  compact = false,
  mobileTight = false,
  browseCompact = false,
}: {
  eyebrow?: string;
  lead?: string;
  accent?: string;
  sub?: string;
  motion?: boolean;
  compact?: boolean;
  mobileTight?: boolean;
  browseCompact?: boolean;
} = {}) {
  return (
    <section className={`section-window relative w-full overflow-hidden ${browseCompact ? "h-[16svh] min-h-[136px] max-h-[160px] md:h-[36svh] md:min-h-[300px] md:max-h-[360px] lg:h-[46vh] lg:min-h-[320px] lg:max-h-none" : compact ? mobileTight ? "h-[28svh] min-h-[210px] max-h-[280px] md:h-[36svh] md:min-h-[300px] md:max-h-[360px] lg:h-[46vh] lg:min-h-[320px] lg:max-h-none" : "h-[36svh] min-h-[240px] sm:h-[46vh] sm:min-h-[320px]" : "h-[46vh] min-h-[320px]"}`}>
      {motion ? <LoopingBannerVideo src="/gear-loop.mp4" mobileSrc="/gear-loop-mobile.mp4" mobileAutoplay poster="/gear-loop-poster.jpg" /> : <img
        className="absolute inset-0 h-full w-full object-cover object-center"
        src="/gear-loop-poster.jpg"
        alt=""
        aria-hidden
      />}
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "linear-gradient(to top, #05050a 5%, rgba(5,5,10,0.55) 42%, rgba(5,5,10,0.32) 100%)",
        }}
        aria-hidden
      />
      <div className="absolute inset-x-0 bottom-0">
        <div className={`mx-auto max-w-7xl px-6 ${browseCompact ? "pb-3 md:pb-6 lg:pb-8" : mobileTight ? "pb-5 md:pb-6 lg:pb-8" : "pb-8"}`}>
          <div className="page-in">
            <div className="flex items-center gap-3">
              <span className="hidden h-px w-8 bg-accent-400/60 sm:block" aria-hidden />
              <span className="hud-label !text-accent-400/90">{eyebrow}</span>
            </div>
            <h1 className={`font-display font-bold tracking-tight text-white ${browseCompact ? "mt-1 text-2xl md:mt-3 md:text-5xl lg:text-6xl" : mobileTight ? "mt-3 text-3xl md:text-5xl lg:text-6xl" : "mt-3 text-4xl sm:text-6xl"}`}>
              {lead} <span className="serif-accent gradient-text pr-1 text-[1.06em]">{accent}</span>
            </h1>
            <p className={`max-w-xl text-balance leading-relaxed text-white/70 ${browseCompact ? "mt-1 text-xs leading-snug md:mt-3 md:text-base md:leading-relaxed" : mobileTight ? "mt-2 md:mt-3" : "mt-3"}`}>{sub}</p>
          </div>
        </div>
      </div>
    </section>
  );
}
