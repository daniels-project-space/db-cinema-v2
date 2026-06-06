export default function Home() {
  return (
    <main className="section-window relative flex min-h-screen flex-col items-center justify-center overflow-hidden px-6">
      {/* radial blue glow + anamorphic flare (hero DNA) */}
      <div
        className="pointer-events-none absolute h-[800px] w-[800px] rounded-full bg-accent-500/5 blur-[120px]"
        aria-hidden
      />
      <div className="lens-flare left-1/4 top-1/2 w-1/2" aria-hidden />

      <div className="relative z-10 flex flex-col items-center text-center">
        <h1 className="font-display text-6xl font-bold tracking-[-0.02em] text-white/90 sm:text-8xl">
          DB
        </h1>
        <h2 className="gradient-text font-display text-5xl font-bold tracking-[0.08em] sm:text-7xl">
          CINEMA
        </h2>
        <p className="mt-6 text-sm uppercase tracking-widest text-white/40">
          Pro gear. Daily rates. Delivered.
        </p>
        <p className="mt-10 max-w-md text-white/30">
          The new storefront is being wired up. Cameras, lenses, lighting, audio
          and drones — bookable online soon.
        </p>
      </div>
    </main>
  );
}
