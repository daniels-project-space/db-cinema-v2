"use client";

import Link from "next/link";

export function SiteHeader() {
  return (
    <header className="sticky top-0 z-40 glass border-b border-white/5">
      <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-3">
        <Link href="/" className="font-display text-lg font-bold tracking-tight">
          <span className="text-white/90">DB</span>{" "}
          <span className="gradient-text">CINEMA</span>
        </Link>
        <nav className="flex items-center gap-6 text-sm text-white/50">
          <Link href="/gear" className="transition-colors hover:text-white">
            Gear
          </Link>
          <Link href="/#how" className="transition-colors hover:text-white">
            How it works
          </Link>
          <Link
            href="/gear"
            className="rounded-full bg-accent-500 px-4 py-1.5 font-medium text-white transition-colors hover:bg-accent-600"
          >
            Browse
          </Link>
        </nav>
      </div>
    </header>
  );
}
