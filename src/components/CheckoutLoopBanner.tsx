/**
 * Top-of-checkout banner: the payment-terminal idle loop with a perpetual
 * "Processing" spinner overlaid on the terminal (crisp CSS, not baked into the
 * video). Its first frame is the checkout turn's last frame for a seamless
 * hand-off.
 */
export function CheckoutLoopBanner() {
  return (
    <section className="section-window relative h-[46vh] min-h-[320px] w-full overflow-hidden">
      {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
      <video
        className="absolute inset-0 h-full w-full object-cover object-center"
        src="/checkout-loop.mp4"
        poster="/checkout-loop-poster.jpg"
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
            "linear-gradient(to top, #05050a 5%, rgba(5,5,10,0.5) 42%, rgba(5,5,10,0.3) 100%)",
        }}
        aria-hidden
      />
      {/* perpetual processing indicator over the terminal */}
      <div
        className="pointer-events-none absolute left-[45%] top-[52%] flex -translate-x-1/2 -translate-y-1/2 items-center gap-2.5 rounded-full border border-accent-400/40 bg-[#05050a]/70 px-4 py-2 backdrop-blur-sm"
        aria-hidden
      >
        <span
          className="h-4 w-4 animate-spin rounded-full border-2 border-accent-400/25 border-t-accent-400"
          aria-hidden
        />
        <span className="font-mono text-xs uppercase tracking-[0.25em] text-accent-300/90">
          Processing
        </span>
      </div>
      <div className="absolute inset-x-0 bottom-0">
        <div className="mx-auto max-w-7xl px-6 pb-8">
          <div className="page-in">
            <div className="flex items-center gap-3">
              <span className="hidden h-px w-8 bg-accent-400/60 sm:block" aria-hidden />
              <span className="hud-label !text-accent-400/90">Final step</span>
            </div>
            <h1 className="mt-3 font-display text-4xl font-bold tracking-tight text-white sm:text-6xl">
              Check <span className="serif-accent gradient-text pr-1 text-[1.06em]">out</span>
            </h1>
          </div>
        </div>
      </div>
    </section>
  );
}
