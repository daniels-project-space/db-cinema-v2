"use client";

import Link from "next/link";
import { useCart } from "@/components/cart/CartProvider";

export function SiteHeader() {
  const { count, open } = useCart();
  return (
    <header className="sticky top-0 z-40 glass border-b border-white/5">
      <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-3">
        <Link href="/" className="font-display text-lg font-bold tracking-tight">
          <span className="text-white/90">DB</span>{" "}
          <span className="gradient-text">CINEMA</span>
        </Link>
        <nav className="flex items-center gap-4 text-sm text-white/50 sm:gap-5">
          <Link href="/gear" className="transition-colors hover:text-white">
            Gear
          </Link>
          <Link href="/how-it-works" className="hidden transition-colors hover:text-white sm:inline">
            How it works
          </Link>
          <Link href="/about" className="hidden transition-colors hover:text-white sm:inline">
            About
          </Link>
          <Link href="/account" className="transition-colors hover:text-white">
            Account
          </Link>
          <button
            onClick={open}
            className="relative flex items-center gap-1.5 rounded-full glass px-4 py-1.5 text-white/80 transition-colors hover:text-white"
            aria-label="Open kit"
          >
            <span>Kit</span>
            {count > 0 && (
              <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-accent-500 px-1 text-xs font-semibold text-white">
                {count}
              </span>
            )}
          </button>
        </nav>
      </div>
    </header>
  );
}
