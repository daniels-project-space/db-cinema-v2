import Link from "next/link";
import { SiteHeader } from "@/components/SiteHeader";

export default function Home() {
  return (
    <>
      <SiteHeader />
      <main className="section-window relative flex min-h-[calc(100vh-57px)] flex-col items-center justify-center overflow-hidden px-6">
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
          <p className="mt-8 max-w-md text-white/30">
            Professional cinema cameras, lenses, lighting, audio and drones —
            bookable online, delivered across London.
          </p>
          <div className="mt-10 flex gap-4">
            <Link
              href="/gear"
              className="rounded-full bg-accent-500 px-7 py-3 font-medium text-white transition-colors hover:bg-accent-600"
            >
              Browse Gear
            </Link>
            <Link
              href="/#how"
              className="glass glass-hover rounded-full px-7 py-3 font-medium text-white/80"
            >
              How it works
            </Link>
          </div>
        </div>
      </main>
    </>
  );
}
