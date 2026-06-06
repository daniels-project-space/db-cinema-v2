"use client";

import Link from "next/link";
import { useState } from "react";
import { useCart } from "@/components/cart/CartProvider";
import { useAccount } from "@/components/account/AccountProvider";

export function SiteHeader() {
  const { count, open } = useCart();
  const account = useAccount();
  const me = account.me;
  const [menu, setMenu] = useState(false);

  // logged-in: warm cream pastel bar with dark text; logged-out: dark glass
  const shell = me
    ? "sticky top-0 z-40 border-b border-black/5 bg-[#f4ecd8]/95 backdrop-blur-md"
    : "sticky top-0 z-40 glass border-b border-white/5";
  const linkBase = me ? "text-charcoal-900/60 hover:text-charcoal-900" : "text-white/50 hover:text-white";
  const logoDb = me ? "text-charcoal-900" : "text-white/90";
  const avatar = me ? `https://i.pravatar.cc/80?u=${encodeURIComponent(me.email)}` : "";

  return (
    <header className={shell}>
      <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-3">
        <Link href="/" className="font-display text-lg font-bold tracking-tight">
          <span className={logoDb}>DB</span> <span className="gradient-text">CINEMA</span>
        </Link>
        <nav className="flex items-center gap-4 text-sm sm:gap-5">
          <Link href="/gear" className={`transition-colors ${linkBase}`}>Gear</Link>
          <Link href="/how-it-works" className={`hidden transition-colors sm:inline ${linkBase}`}>How it works</Link>
          <Link href="/about" className={`hidden transition-colors sm:inline ${linkBase}`}>About</Link>

          {me ? (
            <div className="relative">
              <button
                onClick={() => setMenu((m) => !m)}
                className="flex items-center gap-2 rounded-full bg-white/60 py-1 pl-1 pr-3 ring-1 ring-black/5 transition hover:bg-white"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={avatar} alt="" className="h-7 w-7 rounded-full object-cover" />
                <span className="max-w-[90px] truncate text-sm text-charcoal-900/80">
                  {me.name || me.email.split("@")[0]}
                </span>
              </button>
              {menu && (
                <div className="absolute right-0 mt-2 w-56 overflow-hidden rounded-2xl border border-black/5 bg-white text-charcoal-900 shadow-xl">
                  <div className="flex items-center gap-3 border-b border-black/5 p-4">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={avatar} alt="" className="h-10 w-10 rounded-full object-cover" />
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium">{me.name || "Account"}</div>
                      <div className="truncate text-xs text-charcoal-900/50">{me.email}</div>
                    </div>
                  </div>
                  <Link href="/account" onClick={() => setMenu(false)} className="block px-4 py-2.5 text-sm hover:bg-black/5">
                    My account &amp; bookings
                  </Link>
                  <button
                    onClick={() => { setMenu(false); account.signOut(); }}
                    className="block w-full px-4 py-2.5 text-left text-sm text-red-600 hover:bg-black/5"
                  >
                    Sign out
                  </button>
                </div>
              )}
            </div>
          ) : (
            <Link href="/account" className={`transition-colors ${linkBase}`}>Account</Link>
          )}

          <button
            onClick={open}
            className={`relative flex items-center gap-1.5 rounded-full px-4 py-1.5 transition-colors ${
              me ? "bg-charcoal-900 text-white hover:bg-charcoal-800" : "glass text-white/80 hover:text-white"
            }`}
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
