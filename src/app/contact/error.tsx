"use client";

import Link from "next/link";
import { EmailLink } from "@/components/EmailLink";

export default function ContactError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main className="section-window mx-auto flex min-h-[70vh] max-w-3xl items-center px-6 py-14">
      <section role="alert" className="w-full rounded-3xl border border-white/10 bg-gradient-to-br from-white/[.07] via-[#171819]/95 to-amber-950/10 p-7 shadow-[0_18px_48px_rgba(0,0,0,.25)] backdrop-blur-2xl sm:p-10">
        <p className="text-xs font-semibold uppercase tracking-[.18em] text-accent-200">DB Cinema support</p>
        <h1 className="mt-3 font-display text-2xl font-semibold text-white">The contact page didn’t load.</h1>
        <p className="mt-3 max-w-xl text-sm leading-relaxed text-white/65">Your message hasn’t been sent. Try the page again or contact the team directly.</p>
        <div className="mt-6 flex flex-wrap gap-3">
          <button type="button" onClick={reset} className="rounded-full bg-[#d3aa7c] px-5 py-3 text-sm font-semibold text-[#17130f] transition hover:bg-[#e0bc92]">Try again</button>
          <EmailLink label="Email support" className="inline-flex items-center rounded-full border border-white/15 px-5 py-3 text-sm text-white/80 transition hover:border-white/30 hover:bg-white/[.06]" />
          <Link href="/" className="inline-flex items-center rounded-full border border-white/10 px-5 py-3 text-sm text-white/60 transition hover:bg-white/[.04]">Back to home</Link>
        </div>
      </section>
    </main>
  );
}
