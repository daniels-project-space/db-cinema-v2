import Link from "next/link";
import { SiteHeader } from "@/components/SiteHeader";
import { IconArrowRight } from "@/components/icons";

export default function NotFound() {
  return (
    <>
      <SiteHeader />
      <main className="section-window relative flex min-h-[70vh] flex-col items-center justify-center overflow-hidden px-6 py-20 text-center">
        <div className="hero-grid" aria-hidden />
        <span className="meteor" style={{ top: "14%", left: "70%", animationDelay: "0.8s", animationDuration: "8s" }} aria-hidden />
        <span className="meteor" style={{ top: "24%", left: "30%", animationDelay: "4.6s", animationDuration: "11s" }} aria-hidden />
        <div
          className="pointer-events-none absolute left-1/2 top-1/2 h-[420px] w-[420px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-accent-500/[0.06] blur-[100px]"
          aria-hidden
        />
        <div className="page-in relative">
          <div className="hud-label flex items-center justify-center gap-2">
            <span className="rec-dot" /> Scene missing
          </div>
          <div className="font-poster mt-4 text-[8rem] leading-none sm:text-[11rem]">
            <span className="text-white">4</span>
            <span className="gradient-text">0</span>
            <span className="text-white">4</span>
          </div>
          <p className="serif-accent mt-2 text-2xl text-white/70 sm:text-3xl">this reel doesn&apos;t exist.</p>
          <p className="mx-auto mt-4 max-w-sm text-sm leading-relaxed text-white/40">
            The page you&apos;re after was cut in the edit. The gear, however, is
            very much still here.
          </p>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
            <Link href="/" className="btn-ghost px-7 py-3">
              Back home
            </Link>
            <Link href="/gear" className="btn-primary px-7 py-3">
              Browse the kit
              <IconArrowRight className="h-4 w-4" />
            </Link>
          </div>
          <div className="hud-label mt-10">
            TC 00:00:00:00 <span className="tick">/</span> nothing on this track
          </div>
        </div>
      </main>
    </>
  );
}
