import { IconLock } from "./icons";

/** Compact checkout header keeps the membership offer and form easy to find. */
export function CheckoutLoopBanner() {
  return (
    <section className="section-window relative h-[24vh] min-h-[200px] max-h-[280px] sm:h-[30vh] sm:max-h-[320px] w-full overflow-hidden">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        className="absolute inset-0 h-full w-full object-cover object-center"
        src="/checkout-loop-poster.jpg"
        alt=""
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
      {/* Security indicator; no processing claim before a payment starts. */}
      <div
        className="pointer-events-none absolute left-[45%] top-[28%] flex -translate-x-1/2 -translate-y-1/2 items-center gap-2.5 rounded-full border border-accent-400/40 bg-[#05050a]/70 px-4 py-2 backdrop-blur-sm"
        aria-hidden
      >
        <IconLock className="h-4 w-4 text-accent-300" />
        <span className="font-mono text-xs uppercase tracking-[0.25em] text-accent-300/90">
          Secure checkout
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
