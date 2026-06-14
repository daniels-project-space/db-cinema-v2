/**
 * Top-of-gear-page banner: the gear-station loop playing full-bleed behind the
 * page title. Its first frame is the turn transition's last frame, so arriving
 * from the Home->Gear turn is seamless.
 */
export function GearLoopBanner() {
  return (
    <section className="section-window relative h-[46vh] min-h-[320px] w-full overflow-hidden">
      {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
      <video
        className="absolute inset-0 h-full w-full object-cover object-center"
        src="/gear-loop.mp4"
        poster="/gear-loop-poster.jpg"
        autoPlay
        muted
        loop
        playsInline
        preload="auto"
        tabIndex={-1}
        aria-hidden
      />
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "linear-gradient(to top, #05050a 5%, rgba(5,5,10,0.55) 42%, rgba(5,5,10,0.32) 100%)",
        }}
        aria-hidden
      />
      <div className="absolute inset-x-0 bottom-0">
        <div className="mx-auto max-w-7xl px-6 pb-8">
          <div className="page-in">
            <div className="flex items-center gap-3">
              <span className="hidden h-px w-8 bg-accent-400/60 sm:block" aria-hidden />
              <span className="hud-label !text-accent-400/90">The catalogue</span>
            </div>
            <h1 className="mt-3 font-display text-4xl font-bold tracking-tight text-white sm:text-6xl">
              Rent <span className="serif-accent gradient-text pr-1 text-[1.06em]">cinema gear</span>
            </h1>
            <p className="mt-3 max-w-xl text-balance leading-relaxed text-white/60">
              Professional cameras, lenses, lighting, audio and more. Delivered across London.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
